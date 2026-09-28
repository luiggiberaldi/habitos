-- 0029_mercado_fixeo.sql — Plan de fixeo del módulo Mercado (Alacena).
--
-- 1. mer_productos: horizonte_compra_dias (defecto 14) + consumo_semanal_estim
--    (fallback para calibrar sin anotar cada consumo).
-- 2. rpc_mer_movimiento: el consumo/dañado no puede dejar el stock negativo
--    (raise 'stock_insuficiente' con lo que queda).
-- 3. rpc_mer_inventario: consumo_diario usa el estimado semanal/7 cuando no hay
--    consumos reales en 30 días (marca consumo_estimado); sugerido_comprar usa
--    el horizonte del producto en vez de 30 días fijos.
-- 4. Nuevos RPC: rpc_mer_producto_actualizar, rpc_mer_anular (toggle),
--    rpc_mer_recientes, rpc_mer_lista_comprar (compra atómica + sale de lista).
-- Auth dual via rpc_mer_llamada_ok (mismo patrón que 0028).

-- ── 1. Columnas nuevas ──────────────────────────────────────────────────────
alter table public.mer_productos
  add column if not exists horizonte_compra_dias int not null default 14
    check (horizonte_compra_dias between 1 and 90),
  add column if not exists consumo_semanal_estim numeric(18, 3)
    check (consumo_semanal_estim is null or consumo_semanal_estim >= 0);

-- ── 2. rpc_mer_movimiento con guard de stock ─────────────────────────────────
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
  v_tasa numeric;
  v_tasa_ves numeric;
  v_tasa_cuenta numeric;
  v_monto_cuenta numeric;
  v_usd_unit numeric;
  v_cta public.fin_cuentas%rowtype;
  v_dup public.mer_movimientos%rowtype;
  v_stock numeric;
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

  -- Fixeo: consumo/dañado no puede dejar el stock negativo.
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
  v_tasa_ves := null;
  if p_tipo = 'compra' then
    if p_precio_total is null or p_precio_total <= 0 then
      raise exception 'precio_requerido';
    end if;
    v_tasa := public.fin_tasa_usd_para(coalesce(p_moneda, 'VES'), null);
    select paralelo into v_tasa_ves
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

-- ── 3. rpc_mer_inventario: fallback estimado + horizonte por producto ─────────
create or replace function public.rpc_mer_inventario(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
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
      select b.*,
        round(b.diario, 3) as consumo_diario,
        round(b.diario * 30, 2) as consumo_mensual,
        case when b.diario > 0
          then floor(b.stock / b.diario)
        end as dias_agotamiento,
        case when b.diario > 0
          then (((now() at time zone 'America/Caracas'))::date
            + floor(b.stock / b.diario)::int)::text
        end as fecha_agotamiento,
        case when b.diario > 0
          then greatest(0, round(b.diario * b.horizonte_compra_dias - b.stock, 2))
        end as sugerido_comprar
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
          -- Fixeo: si no hay consumos reales en 30 días, usar el estimado
          -- semanal/7 (marcado para que la UI lo indique).
          case
            when c.consumo_diario is not null then c.consumo_diario
            when a.consumo_semanal_estim is not null then a.consumo_semanal_estim / 7.0
          end as diario,
          (c.consumo_diario is null
            and a.consumo_semanal_estim is not null) as consumo_estimado,
          a.horizonte_compra_dias,
          a.consumo_semanal_estim,
          st.n_compras
        from alcance a
        left join stock s on s.producto_id = a.id
        left join stats st on st.producto_id = a.id
        left join consumo c on c.producto_id = a.id
      ) b
    ) t
  );
end;
$$;

-- ── 4a. rpc_mer_producto_actualizar: editar + desactivar ─────────────────────
create or replace function public.rpc_mer_producto_actualizar(
  p_user_id uuid,
  p_producto_id uuid,
  p_nombre text default null,
  p_categoria text default null,
  p_horizonte_dias int default null,
  p_consumo_semanal_estim numeric default null,
  p_quitar_estimado boolean default false,
  p_activo boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.mer_productos%rowtype;
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
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
  if p_nombre is not null and char_length(trim(p_nombre)) not between 1 and 80 then
    raise exception 'nombre_invalido';
  end if;
  if p_categoria is not null and char_length(trim(p_categoria)) not between 1 and 40 then
    raise exception 'categoria_invalida';
  end if;
  if p_horizonte_dias is not null and p_horizonte_dias not between 1 and 90 then
    raise exception 'horizonte_invalido';
  end if;
  if p_consumo_semanal_estim is not null and p_consumo_semanal_estim < 0 then
    raise exception 'estimado_invalido';
  end if;

  update public.mer_productos set
    nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
    categoria = lower(coalesce(nullif(trim(p_categoria), ''), categoria)),
    horizonte_compra_dias = coalesce(p_horizonte_dias, horizonte_compra_dias),
    consumo_semanal_estim = case
      when p_quitar_estimado then null
      else coalesce(p_consumo_semanal_estim, consumo_semanal_estim)
    end,
    activo = coalesce(p_activo, activo)
  where id = v_prod.id
  returning * into v_prod;

  return jsonb_build_object(
    'ok', true, 'id', v_prod.id, 'nombre', v_prod.nombre,
    'categoria', v_prod.categoria, 'activo', v_prod.activo,
    'horizonte_compra_dias', v_prod.horizonte_compra_dias,
    'consumo_semanal_estim', v_prod.consumo_semanal_estim
  );
exception when unique_violation then
  raise exception 'nombre_duplicado';
end;
$$;

-- ── 4b. rpc_mer_anular: anular/rehacer un movimiento (toggle) ────────────────
create or replace function public.rpc_mer_anular(
  p_user_id uuid,
  p_movimiento_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov public.mer_movimientos%rowtype;
  v_anulado timestamptz;
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  select m.* into v_mov
  from public.mer_movimientos m
  join public.mer_productos pr on pr.id = m.producto_id
  where m.id = p_movimiento_id
    and (pr.user_id = p_user_id
      or (pr.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)));
  if v_mov.id is null then
    raise exception 'movimiento_no_encontrado';
  end if;

  update public.mer_movimientos
  set anulado_en = case when anulado_en is null then now() else null end
  where id = v_mov.id
  returning anulado_en into v_anulado;

  return jsonb_build_object(
    'ok', true, 'id', v_mov.id,
    'anulado', v_anulado is not null,
    'tipo', v_mov.tipo, 'cantidad', v_mov.cantidad
  );
end;
$$;

-- ── 4c. rpc_mer_recientes: últimos movimientos con producto ──────────────────
create or replace function public.rpc_mer_recientes(
  p_user_id uuid,
  p_limite int default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  return (
    select coalesce(jsonb_agg(row_to_json(t) order by t.creado_en desc), '[]'::jsonb)
    from (
      select m.id, m.tipo, m.cantidad, m.precio_total, m.moneda, m.comercio,
             m.fecha, m.nota, m.creado_en, (m.anulado_en is not null) as anulado,
             pr.nombre as producto, pr.unidad
      from public.mer_movimientos m
      join public.mer_productos pr on pr.id = m.producto_id
      where pr.user_id = p_user_id
         or (pr.hogar_id is not null and exists (
           select 1 from public.hogar_miembros hm
           where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id))
      order by m.creado_en desc
      limit least(coalesce(p_limite, 15), 50)
    ) t
  );
end;
$$;

-- ── 4d. rpc_mer_lista_comprar: compra atómica + sale de la lista ─────────────
create or replace function public.rpc_mer_lista_comprar(
  p_user_id uuid,
  p_producto_id uuid,
  p_cantidad numeric default null,
  p_precio_total numeric default null,
  p_moneda text default 'VES',
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
  v_lista public.mer_lista%rowtype;
  v_mov jsonb;
  v_clave text;
  v_dup jsonb;
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if p_precio_total is null or p_precio_total <= 0 then
    raise exception 'precio_requerido';
  end if;

  -- Clave estable: el doble tap no duplica la compra.
  v_clave := coalesce(
    nullif(trim(p_clave_evento), ''),
    'lista-compra-' || p_producto_id::text || '-' ||
      extract(epoch from now())::bigint::text
  );

  -- Idempotencia PRIMERO: si la compra ya se registró (reintento de red),
  -- devolverla como duplicada aunque la lista ya esté limpia.
  select jsonb_build_object('id', m.id, 'tipo', m.tipo, 'cantidad', m.cantidad)
  into v_dup
  from public.mer_movimientos m
  join public.mer_productos pr on pr.id = m.producto_id
  where m.clave_evento = v_clave
    and (pr.user_id = p_user_id
      or (pr.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)));
  if v_dup is not null then
    delete from public.mer_lista
    where user_id = p_user_id and producto_id = p_producto_id;
    return jsonb_build_object('ok', true, 'duplicado', true, 'movimiento', v_dup);
  end if;

  select * into v_lista
  from public.mer_lista
  where user_id = p_user_id and producto_id = p_producto_id;
  if v_lista.id is null then
    raise exception 'no_en_lista';
  end if;

  -- Reutiliza rpc_mer_movimiento (valida auth, stock no aplica a compra,
  -- crea el egreso en finanzas si hay cuenta). Todo en una transacción:
  -- si algo falla, no se registra nada ni sale de la lista.
  v_mov := public.rpc_mer_movimiento(
    p_user_id, p_producto_id, 'compra',
    coalesce(p_cantidad, v_lista.cantidad),
    p_precio_total, p_moneda, p_comercio, p_cuenta_id,
    coalesce(nullif(trim(p_nota), ''), 'compra desde la lista'),
    v_clave
  );

  delete from public.mer_lista
  where user_id = p_user_id and producto_id = p_producto_id;

  return jsonb_build_object(
    'ok', true,
    'movimiento', v_mov,
    'duplicado', coalesce((v_mov ->> 'duplicado')::boolean, false)
  );
end;
$$;

-- ── 5. Permisos (la puerta real es rpc_mer_llamada_ok) ───────────────────────
revoke all on function public.rpc_mer_producto_actualizar(uuid, uuid, text, text, int, numeric, boolean, boolean) from public;
grant execute on function public.rpc_mer_producto_actualizar(uuid, uuid, text, text, int, numeric, boolean, boolean) to anon, authenticated;
revoke all on function public.rpc_mer_anular(uuid, uuid) from public;
grant execute on function public.rpc_mer_anular(uuid, uuid) to anon, authenticated;
revoke all on function public.rpc_mer_recientes(uuid, int) from public;
grant execute on function public.rpc_mer_recientes(uuid, int) to anon, authenticated;
revoke all on function public.rpc_mer_lista_comprar(uuid, uuid, numeric, numeric, text, text, text, text, text) from public;
grant execute on function public.rpc_mer_lista_comprar(uuid, uuid, numeric, numeric, text, text, text, text, text) to anon, authenticated;
