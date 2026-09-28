-- 0028_mercado_jwt.sql — Mercado acepta el JWT del navegador (igual que el coach).
--
-- Antes, los RPC de Mercado solo aceptaban el secreto de integración
-- (`rpc_fin_secret_ok()`), así que la web de /mercado exigía exponer el
-- secreto como NEXT_PUBLIC_HABITOS_RPC_SECRET (nunca se configuró en
-- producción y, además, exponerlo sería una filtración).
--
-- Ahora cada RPC acepta el secreto O el JWT del navegador cuando
-- auth.uid() = p_user_id (helper rpc_mer_llamada_ok, mismo patrón que
-- rpc_coach_llamada_ok de la 0026). Los scripts de WhatsApp siguen
-- funcionando igual por la vía del secreto.

-- Helper de autenticación dual.
create or replace function public.rpc_mer_llamada_ok(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.rpc_fin_secret_ok() then
    return true;
  end if;
  return auth.uid() is not null and auth.uid() = p_user_id;
exception when others then
  return false;
end;
$$;

-- ── rpc_mer_producto_upsert (auth dual) ──
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
  if not public.rpc_mer_llamada_ok(p_user_id) then
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

-- ── rpc_mer_movimiento (auth dual) ──
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

-- ── rpc_mer_inventario (auth dual) ──
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

-- ── rpc_mer_precios (auth dual) ──
create or replace function public.rpc_mer_precios(p_user_id uuid, p_producto_id uuid)
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

-- ── rpc_mer_lista (auth dual) ──
create or replace function public.rpc_mer_lista(p_user_id uuid)
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
    select coalesce(jsonb_agg(row_to_json(t) order by t.creado_en), '[]'::jsonb)
    from (
      select l.id, l.producto_id, pr.nombre, pr.unidad,
        l.cantidad, l.estado, l.creado_en
      from public.mer_lista l
      join public.mer_productos pr on pr.id = l.producto_id
      where l.user_id = p_user_id
        or (l.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = l.hogar_id and hm.user_id = p_user_id))
    ) t
  );
end;
$$;

-- ── rpc_mer_lista_toggle (auth dual) ──
create or replace function public.rpc_mer_lista_toggle(
  p_user_id uuid,
  p_producto_id uuid,
  p_cantidad numeric default null,
  p_estado text default 'pendiente'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.mer_productos%rowtype;
  v_lista public.mer_lista%rowtype;
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

  if p_estado = 'quitar' then
    delete from public.mer_lista
    where user_id = p_user_id and producto_id = p_producto_id;
    return jsonb_build_object('ok', true, 'estado', 'quitado');
  end if;

  insert into public.mer_lista
    (user_id, hogar_id, producto_id, cantidad, estado, creado_por)
  values
    (p_user_id, v_prod.hogar_id, v_prod.id,
     coalesce(p_cantidad, 1), p_estado, p_user_id)
  on conflict (user_id, producto_id)
  do update set
    cantidad = coalesce(excluded.cantidad, public.mer_lista.cantidad),
    estado = excluded.estado
  returning * into v_lista;

  return jsonb_build_object(
    'ok', true, 'id', v_lista.id, 'estado', v_lista.estado,
    'producto', v_prod.nombre, 'cantidad', v_lista.cantidad
  );
end;
$$;

-- Presupuesto mensual de mercado: Σ consumo_mensual × precio actual.

-- ── rpc_mer_presupuesto (auth dual) ──
create or replace function public.rpc_mer_presupuesto(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_inv jsonb;
begin
  if not public.rpc_mer_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  -- Reutiliza el cálculo del inventario (ya validó el secreto).
  select public.rpc_mer_inventario(p_user_id) into v_inv;
  return (
    select jsonb_build_object(
      'total_usd', coalesce(sum((e ->> 'consumo_mensual')::numeric * (e ->> 'precio_usd_unitario')::numeric), 0),
      'items', coalesce(jsonb_agg(
        jsonb_build_object(
          'producto', e ->> 'nombre',
          'unidad', e ->> 'unidad',
          'consumo_mensual', (e ->> 'consumo_mensual')::numeric,
          'precio_usd_unitario', (e ->> 'precio_usd_unitario')::numeric,
          'costo_mensual_usd', round(
            (e ->> 'consumo_mensual')::numeric * (e ->> 'precio_usd_unitario')::numeric, 2)
        ) order by e ->> 'nombre'
      ) filter (where (e ->> 'consumo_mensual')::numeric > 0
                  and (e ->> 'precio_usd_unitario')::numeric > 0), '[]'::jsonb)
    )
    from jsonb_array_elements(v_inv) e
  );
end;
$$;

-- Permisos: solo anon/authenticated (la puerta real es rpc_mer_llamada_ok,
-- fail-closed: secreto de integración O auth.uid() = p_user_id).
revoke all on function public.rpc_mer_producto_upsert(uuid, text, text, text, numeric, uuid, numeric) from public;
grant execute on function public.rpc_mer_producto_upsert(uuid, text, text, text, numeric, uuid, numeric) to anon, authenticated;
revoke all on function public.rpc_mer_movimiento(uuid, uuid, text, numeric, numeric, text, text, text, text, text) from public;
grant execute on function public.rpc_mer_movimiento(uuid, uuid, text, numeric, numeric, text, text, text, text, text) to anon, authenticated;
revoke all on function public.rpc_mer_inventario(uuid) from public;
grant execute on function public.rpc_mer_inventario(uuid) to anon, authenticated;
revoke all on function public.rpc_mer_precios(uuid, uuid) from public;
grant execute on function public.rpc_mer_precios(uuid, uuid) to anon, authenticated;
revoke all on function public.rpc_mer_lista(uuid) from public;
grant execute on function public.rpc_mer_lista(uuid) to anon, authenticated;
revoke all on function public.rpc_mer_lista_toggle(uuid, uuid, numeric, text) from public;
grant execute on function public.rpc_mer_lista_toggle(uuid, uuid, numeric, text) to anon, authenticated;
revoke all on function public.rpc_mer_presupuesto(uuid) from public;
grant execute on function public.rpc_mer_presupuesto(uuid) to anon, authenticated;

