-- 0023_mercado_hardening.sql — Correctivos de la auditoría de Mercado (Fase 2).
--
-- 1. Bug #1 (conversión invertida): fin_tasa_usd_para devuelve USD-por-unidad de la
--    moneda (para VES: 1/paralelo). Tres sitios dividían precio_total / tasa_usd, lo
--    que daba cifras absurdas (Bs 1.711,32 → "USD 1.629.348"). La conversión correcta
--    es precio_total * tasa_usd. Se corrige en rpc_mer_movimiento, rpc_mer_precios
--    y rpc_mer_inventario. NO se toca fin_tasa_usd_para: Finanzas usa monto * tasa
--    y está correcto con la semántica actual.
-- 2. Moneda de compra vs moneda de cuenta: rpc_mer_movimiento convertía el egreso
--    con el monto en la moneda de la COMPRA aunque la CUENTA fuera de otra moneda.
--    Ahora convierte el monto a la moneda de la cuenta antes de llamar a
--    fin_registrar_interno (precio * tasa_compra / tasa_cuenta).
-- 3. Idempotencia: mer_movimientos.clave_evento (columna nueva) + índice único
--    parcial; el RPC devuelve el movimiento existente con duplicado:true si la
--    clave se repite (antes el parámetro se aceptaba pero se ignoraba).
-- 4. rpc_mer_producto_upsert acepta p_stock_inicial: crea el producto y registra el
--    ajuste "stock inicial" en la misma operación atómica (los 4 obligatorios de
--    luigi: nombre, unidad, categoría, cantidad). Solo cuando el producto es nuevo.
-- 5. Historial Bs/$ con tasa histórica: mer_movimientos.tasa_ves (Bs por USD al
--    momento de la compra); rpc_mer_precios devuelve precio_usd_historico y
--    precio_bs_historico explícitos (para compras viejas en VES sin tasa_ves, el
--    Bs se deriva directo del precio_total).

-- ── 1. Columnas nuevas ───────────────────────────────────────────────────────
alter table public.mer_movimientos
  add column if not exists clave_evento text,
  add column if not exists tasa_ves numeric(18, 6) check (tasa_ves is null or tasa_ves > 0);

create unique index if not exists mer_movimientos_clave_evento_idx
  on public.mer_movimientos (clave_evento) where clave_evento is not null;

-- ── 2. rpc_mer_producto_upsert + p_stock_inicial ─────────────────────────────
-- La firma vieja (6 args) se elimina: si no, PostgREST devuelve PGRST203
-- (no puede elegir entre las dos sobrecargas).
drop function if exists public.rpc_mer_producto_upsert(uuid, text, text, text, numeric, uuid);

create or replace function public.rpc_mer_producto_upsert(
  p_user_id uuid,
  p_nombre text,
  p_unidad text,
  p_categoria text,
  p_precio_ref numeric default null,
  p_hogar_id uuid default null,
  p_stock_inicial numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.mer_productos%rowtype;
  v_nuevo boolean := false;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  if p_nombre is null or char_length(trim(p_nombre)) = 0 then
    raise exception 'nombre_requerido';
  end if;
  if p_unidad not in ('und', 'kg', 'g', 'L', 'ml', 'paquete', 'caja') then
    raise exception 'unidad_invalida';
  end if;
  if p_categoria is null or char_length(trim(p_categoria)) = 0 then
    raise exception 'categoria_requerida';
  end if;
  if p_stock_inicial is not null and p_stock_inicial < 0 then
    raise exception 'stock_inicial_invalido';
  end if;

  select * into v_prod
  from public.mer_productos
  where user_id = p_user_id and lower(nombre) = lower(trim(p_nombre));

  if v_prod.id is null then
    insert into public.mer_productos
      (user_id, hogar_id, nombre, unidad, categoria, precio_referencia, creado_por)
    values
      (p_user_id, p_hogar_id, trim(p_nombre), p_unidad,
       lower(trim(p_categoria)), p_precio_ref, p_user_id)
    returning * into v_prod;
    v_nuevo := true;

    -- Stock inicial atómico: solo cuando el producto se crea (no en update).
    if p_stock_inicial is not null and p_stock_inicial > 0 then
      insert into public.mer_movimientos (producto_id, tipo, cantidad, nota, creado_por)
      values (v_prod.id, 'ajuste', p_stock_inicial, 'stock inicial', p_user_id);
    end if;
  else
    update public.mer_productos
    set unidad = p_unidad,
        categoria = lower(trim(p_categoria)),
        precio_referencia = coalesce(p_precio_ref, precio_referencia),
        hogar_id = coalesce(p_hogar_id, hogar_id),
        activo = true
    where id = v_prod.id
    returning * into v_prod;
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_prod.id, 'nombre', v_prod.nombre,
    'unidad', v_prod.unidad, 'categoria', v_prod.categoria,
    'nuevo', v_nuevo
  );
end;
$$;

-- ── 3. rpc_mer_movimiento: Bug #1, Bug #2, idempotencia, tasa_ves ─────────────
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
  v_tasa numeric;         -- USD por unidad de p_moneda
  v_tasa_ves numeric;     -- Bs por USD (snapshot al momento de la compra)
  v_tasa_cuenta numeric;  -- USD por unidad de la moneda de la cuenta
  v_monto_cuenta numeric; -- precio convertido a la moneda de la cuenta
  v_usd_unit numeric;
  v_cta public.fin_cuentas%rowtype;
  v_dup public.mer_movimientos%rowtype;
begin
  if not public.rpc_fin_secret_ok() then
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
  v_tasa_ves := null;
  if p_tipo = 'compra' then
    if p_precio_total is null or p_precio_total <= 0 then
      raise exception 'precio_requerido';
    end if;
    v_tasa := public.fin_tasa_usd_para(
      coalesce(p_moneda, 'VES'),
      null
    );
    select paralelo into v_tasa_ves
    from public.fin_tasas order by fecha desc limit 1;
    -- Bug #1: era (p_precio_total / v_tasa); la tasa es USD-por-unidad,
    -- así que la conversión correcta es precio_total * tasa_usd.
    v_usd_unit := round((p_precio_total * v_tasa) / p_cantidad, 4);
  end if;

  -- Compra pagada con cuenta → egreso en finanzas (idempotente por clave).
  if p_tipo = 'compra' and p_cuenta_id is not null then
    -- Bug #2: convertir el precio a la moneda de la cuenta antes del egreso.
    -- Acepta id o nombre de cuenta (igual que fin_registrar_interno).
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
    v_monto_cuenta := round(p_precio_total * v_tasa / v_tasa_cuenta, 2);
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
    'fin_movimiento_id', case when v_fin is not null then v_fin ->> 'id' end
  );
end;
$$;

-- ── 4. rpc_mer_inventario: Bug #1 en usd_unit ─────────────────────────────────
create or replace function public.rpc_mer_inventario(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  return (
    with alcance as (
      select pr.*
      from public.mer_productos pr
      where pr.activo
        and (pr.user_id = p_user_id
          or (pr.hogar_id is not null and exists (
            select 1 from public.hogar_miembros hm
            where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)))
    ),
    movs as (
      select m.*
      from public.mer_movimientos m
      join alcance a on a.id = m.producto_id
      where m.anulado_en is null
    ),
    stock as (
      select producto_id,
        sum(case when tipo = 'compra' then cantidad
                 when tipo = 'ajuste' then cantidad
                 else -cantidad end) as stock
      from movs group by producto_id
    ),
    compras as (
      select producto_id,
        -- Bug #1: era (precio_total / tasa_usd); la tasa es USD-por-unidad.
        (precio_total * tasa_usd) / nullif(cantidad, 0) as usd_unit,
        precio_total / nullif(cantidad, 0) as precio_unit,
        moneda, fecha, comercio, creado_en
      from movs where tipo = 'compra'
    ),
    stats as (
      select producto_id,
        min(usd_unit) as min_usd, max(usd_unit) as max_usd,
        avg(usd_unit) as prom_usd, count(*) as n_compras,
        (array_agg(usd_unit order by creado_en desc))[1] as ultimo_usd,
        (array_agg(precio_unit order by creado_en desc))[1] as ultimo_precio,
        (array_agg(moneda order by creado_en desc))[1] as ultima_moneda,
        (array_agg(comercio order by creado_en desc))[1] as ultimo_comercio
      from compras group by producto_id
    ),
    consumo as (
      select producto_id,
        sum(cantidad) / 30.0 as consumo_diario
      from movs
      where tipo = 'consumo' and fecha >= ((now() at time zone 'America/Caracas'))::date - 30
      group by producto_id
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.nombre), '[]'::jsonb)
    from (
      select a.id, a.nombre, a.unidad, a.categoria,
        coalesce(s.stock, 0) as stock,
        st.ultimo_precio as ultimo_precio,
        st.ultima_moneda as ultima_moneda,
        st.ultimo_comercio as ultimo_comercio,
        round(st.min_usd, 2) as precio_min_usd,
        round(st.max_usd, 2) as precio_max_usd,
        round(st.prom_usd, 2) as precio_prom_usd,
        round(st.ultimo_usd, 2) as precio_usd_unitario,
        case when st.prom_usd > 0
          then round((st.ultimo_usd - st.prom_usd) / st.prom_usd * 100, 1)
        end as variacion_pct,
        round(c.consumo_diario, 3) as consumo_diario,
        round(c.consumo_diario * 30, 2) as consumo_mensual,
        case when c.consumo_diario > 0
          then floor(coalesce(s.stock, 0) / c.consumo_diario)
        end as dias_agotamiento,
        case when c.consumo_diario > 0
          then (((now() at time zone 'America/Caracas'))::date
            + floor(coalesce(s.stock, 0) / c.consumo_diario)::int)::text
        end as fecha_agotamiento,
        case when c.consumo_diario > 0
          then greatest(0, round(c.consumo_diario * 30 - coalesce(s.stock, 0), 2))
        end as sugerido_comprar,
        st.n_compras
      from alcance a
      left join stock s on s.producto_id = a.id
      left join stats st on st.producto_id = a.id
      left join consumo c on c.producto_id = a.id
    ) t
  );
end;
$$;

-- ── 5. rpc_mer_precios: Bug #1 + historial Bs/$ explícito ─────────────────────
create or replace function public.rpc_mer_precios(p_user_id uuid, p_producto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  return (
    select coalesce(jsonb_agg(row_to_json(t) order by t.fecha desc), '[]'::jsonb)
    from (
      select m.fecha,
        m.comercio,
        round(m.precio_total / m.cantidad, 2) as precio_unitario,
        m.moneda,
        -- Bug #1: era (precio_total / tasa_usd) / cantidad.
        round((m.precio_total * m.tasa_usd) / m.cantidad, 2) as precio_usd_unitario,
        round((m.precio_total * m.tasa_usd) / m.cantidad, 2) as precio_usd_historico,
        case
          when m.moneda = 'VES' then round(m.precio_total / m.cantidad, 2)
          else round((m.precio_total * m.tasa_usd * m.tasa_ves) / m.cantidad, 2)
        end as precio_bs_historico,
        m.tasa_ves as tasa_bs_historica,
        m.cantidad
      from public.mer_movimientos m
      join public.mer_productos pr on pr.id = m.producto_id
      where m.producto_id = p_producto_id
        and m.tipo = 'compra' and m.anulado_en is null
        and (pr.user_id = p_user_id
          or (pr.hogar_id is not null and exists (
            select 1 from public.hogar_miembros hm
            where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)))
    ) t
  );
end;
$$;
