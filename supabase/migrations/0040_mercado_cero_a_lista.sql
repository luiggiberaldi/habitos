-- 0040_mercado_cero_a_lista.sql
-- Regla de luigi (2026-10-03): los productos en 0 NO aparecen en la
-- despensa/alacena; aparecen en la lista de compras.
--   1. rpc_mer_movimiento (copia de 0038 + cambio 0040): al registrar una
--      compra, el producto sale de mer_lista (si estaba pendiente). Si el
--      stock queda en el umbral o por debajo, el punto de reorden lo
--      re-agrega justo después. Así la lista nunca queda con un pendiente
--      obsoleto tras comprar por WhatsApp directo ("compré X").
--   2. Backfill: productos activos con stock <= stock_minimo sin pendiente
--      en la lista pasan a la lista con la misma función de reorden.
-- La UI (Alacena) y el WhatsApp filtran stock > 0 en la vista; el RPC de
-- inventario sigue devolviendo todo para el matcheo de productos.

create or replace function public.rpc_mer_movimiento(
  p_user_id uuid,
  p_producto_id uuid,
  p_tipo text,
  p_cantidad numeric,
  p_precio_total numeric default null,
  p_moneda text default null,
  p_comercio text default null,
  p_cuenta_id text default null,
  p_nota text default null,
  p_clave_evento text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.mer_productos%rowtype;
  v_mov_id uuid;
  v_fin jsonb;
  v_tasa numeric;          -- USD por unidad de moneda, base BCV (lado Mercado)
  v_tasa_par numeric;      -- USD por unidad de moneda, base paralelo (lado Finanzas)
  v_tasa_ves numeric;      -- snapshot BCV (Bs por USD) al momento de la compra
  v_tasa_cuenta numeric;
  v_monto_cuenta numeric;
  v_usd_unit numeric;
  v_cta public.fin_cuentas%rowtype;
  v_dup public.mer_movimientos%rowtype;
  v_stock numeric;
  v_paso boolean := false;
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if p_tipo not in ('compra', 'consumo', 'ajuste', 'danado') then
    raise exception 'tipo_invalido';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'cantidad_invalida';
  end if;

  select * into v_prod from public.mer_productos pr
  where pr.id = p_producto_id
    and (pr.user_id = p_user_id
      or (pr.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)));
  if v_prod.id is null then
    raise exception 'producto_no_encontrado';
  end if;

  -- Fixeo 0029: consumo/dañado no puede dejar el stock negativo.
  if p_tipo in ('consumo', 'danado') then
    select coalesce(sum(case when m.tipo in ('compra', 'ajuste') then m.cantidad
                             else -m.cantidad end), 0)
    into v_stock
    from public.mer_movimientos m
    where m.producto_id = v_prod.id and m.anulado_en is null;
    if p_cantidad > v_stock then
      raise exception 'stock_insuficiente: quedan % % de %',
        trim(trailing '0' from to_char(v_stock, 'FM999999990.000')),
        v_prod.unidad, v_prod.nombre;
    end if;
  end if;

  -- Idempotencia: si la clave ya existe, devolver el movimiento sin duplicar.
  if p_clave_evento is not null then
    select m.* into v_dup
    from public.mer_movimientos m
    join public.mer_productos pr on pr.id = m.producto_id
    where m.clave_evento = p_clave_evento
      and (pr.user_id = p_user_id
        or (pr.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)));
    if v_dup.id is not null then
      return jsonb_build_object(
        'ok', true, 'id', v_dup.id, 'duplicado', true,
        'tipo', v_dup.tipo, 'producto', v_prod.nombre,
        'cantidad', v_dup.cantidad, 'unidad', v_prod.unidad,
        'fin_movimiento_id', v_dup.fin_movimiento_id
      );
    end if;
  end if;

  v_tasa := null;
  v_tasa_par := null;
  v_tasa_ves := null;
  if p_tipo = 'compra' then
    if p_precio_total is null or p_precio_total <= 0 then
      raise exception 'precio_requerido';
    end if;
    -- Regla 2026-10-01: el lado Mercado (precio_usd_unitario, tasa_usd,
    -- tasa_ves guardadas) usa el BCV.
    v_tasa := public.fin_tasa_usd_bcv(coalesce(p_moneda, 'VES'));
    -- El lado Finanzas (conversión del egreso a la moneda de la cuenta)
    -- sigue con el paralelo, como antes.
    v_tasa_par := public.fin_tasa_usd_para(coalesce(p_moneda, 'VES'), null);
    select bcv into v_tasa_ves
    from public.fin_tasas order by fecha desc limit 1;
    v_usd_unit := round((p_precio_total * v_tasa) / p_cantidad, 4);
  end if;

  -- Compra pagada con cuenta → egreso en finanzas (idempotente por clave).
  if p_tipo = 'compra' and p_cuenta_id is not null then
    select * into v_cta from public.fin_cuentas c
    where not c.archivada
      and (c.id::text = p_cuenta_id or lower(c.nombre) = lower(p_cuenta_id))
      and (c.user_id = p_user_id
        or (c.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id)))
    order by (c.user_id = p_user_id) desc, c.creado_en limit 1;
    if v_cta.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
    v_tasa_cuenta := public.fin_tasa_usd_para(v_cta.moneda, v_cta.tasa_usd_manual);
    v_monto_cuenta := round(p_precio_total * v_tasa_par / v_tasa_cuenta, 2);
    v_fin := public.fin_registrar_interno(
      p_user_id, 'egreso', v_monto_cuenta, p_cuenta_id, 'mercado',
      ((now() at time zone 'America/Caracas'))::date,
      trim(coalesce(v_prod.nombre, '') || ' · ' || coalesce(p_comercio, 'mercado')),
      'mer-' || coalesce(p_clave_evento, gen_random_uuid()::text),
      null
    );
  end if;

  insert into public.mer_movimientos
    (producto_id, tipo, cantidad, precio_total, moneda, tasa_usd, tasa_ves,
     comercio, cuenta_id, fin_movimiento_id, nota, creado_por, clave_evento)
  values
    (v_prod.id, p_tipo, p_cantidad,
     case when p_tipo = 'compra' then p_precio_total end,
     case when p_tipo = 'compra' then coalesce(p_moneda, 'VES') end,
     v_tasa, v_tasa_ves,
     nullif(trim(coalesce(p_comercio, '')), ''),
     case when p_cuenta_id is not null
       then (v_fin ->> 'cuenta_id')::uuid end,
     case when v_fin is not null then (v_fin ->> 'id')::uuid end,
     nullif(trim(coalesce(p_nota, '')), ''),
     p_user_id, p_clave_evento)
  returning id into v_mov_id;

  -- 0040: al comprar, el producto sale de la lista de compras (si estaba).
  -- Si el stock sigue en el umbral o por debajo, el reorden lo re-agrega abajo.
  if p_tipo = 'compra' then
    delete from public.mer_lista l
    where l.user_id = p_user_id and l.producto_id = v_prod.id;
  end if;

  -- Punto de reorden (0037): si el stock quedó en el umbral o por debajo,
  -- el producto pasa solo a la lista de compras.
  v_paso := public.mer_pasar_a_lista_si_reorden(p_user_id, v_prod.id);

  return jsonb_build_object(
    'ok', true,
    'id', v_mov_id,
    'tipo', p_tipo,
    'producto', v_prod.nombre,
    'cantidad', p_cantidad,
    'unidad', v_prod.unidad,
    'precio_usd_unitario', v_usd_unit,
    'monto_cuenta', v_monto_cuenta,
    'moneda_cuenta', case when v_cta.id is not null then v_cta.moneda end,
    'fin_movimiento_id', case when v_fin is not null then v_fin ->> 'id' end,
    'paso_a_lista', v_paso
  );
end;
$$;

-- ── Backfill: todo lo que está en el umbral o por debajo va a la lista ──
do $$
declare
  r record;
begin
  for r in
    select pr.user_id, pr.id as producto_id
    from public.mer_productos pr
    where pr.activo
      and coalesce((
        select sum(case when m.tipo in ('compra', 'ajuste') then m.cantidad
                        else -m.cantidad end)
        from public.mer_movimientos m
        where m.producto_id = pr.id
          and m.anulado_en is null
      ), 0) <= pr.stock_minimo
      and not exists (
        select 1 from public.mer_lista l
        where l.user_id = pr.user_id
          and l.producto_id = pr.id
          and l.estado = 'pendiente'
      )
  loop
    perform public.mer_pasar_a_lista_si_reorden(r.user_id, r.producto_id);
  end loop;
end
$$;
