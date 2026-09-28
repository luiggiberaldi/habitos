-- 0022_mercado.sql — Fase 2: inventario del hogar (Senda).
--
-- Decisiones (roadmap / luigi):
-- - Stock se CALCULA: compras − consumos − dañados + ajustes. Nunca se guarda
--   como cifra mutable.
-- - Productos: nombre, unidad, categoría, cantidad (obligatorios); precio de
--   referencia opcional (se rellena solo con la última compra si no se da).
-- - "Se dañó" baja stock pero NO contamina las estadísticas de precio.
-- - Compras registran tasa_usd snapshot (igual que finanzas): el historial
--   de precios en $ no se recalcula retroactivamente.
-- - Compra con cuenta → genera el egreso en finanzas (categoria 'mercado')
--   vía fin_registrar_interno; queda el link fin_movimiento_id.
-- - Todo dato compartido lleva creado_por. Alcance: productos propios +
--   del hogar donde el usuario es miembro (mismo patrón que la 0021: consulta
--   directa a hogar_miembros porque auth.uid() es NULL en RPC por secreto).
-- - Refactor: el cuerpo de rpc_fin_registrar pasa a fin_registrar_interno
--   (sin chequeo de secreto, no expuesta); rpc_fin_registrar queda como
--   wrapper con la misma firma. Mercado puede crear egresos sin duplicar
--   lógica ni bypassear la idempotencia.

-- ── 1. Refactor finanzas: núcleo interno ─────────────────────────────────────
create or replace function public.fin_registrar_interno(
  p_user_id uuid,
  p_tipo text,
  p_monto numeric,
  p_cuenta text default null,
  p_categoria text default null,
  p_fecha date default null,
  p_nota text default null,
  p_clave_evento text default null,
  p_cuenta_destino text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.fin_cuentas%rowtype;
  v_dest public.fin_cuentas%rowtype;
  v_tasa numeric;
  v_tasa_dest numeric;
  v_monto_dest numeric;
  v_existente uuid;
  v_mov_id uuid;
begin
  if p_tipo not in ('ingreso', 'egreso', 'transferencia') then
    raise exception 'tipo_invalido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto_invalido';
  end if;

  -- Idempotencia: si la clave ya existe, devolver el movimiento.
  if p_clave_evento is not null then
    select id into v_existente
    from public.fin_movimientos where clave_evento = p_clave_evento;
    if v_existente is not null then
      return jsonb_build_object('ok', true, 'id', v_existente, 'duplicado', true);
    end if;
  end if;

  -- Resolver cuenta origen (propia o del hogar del usuario).
  if p_cuenta is not null then
    select * into v_cuenta from public.fin_cuentas c
    where not c.archivada
      and (c.id::text = p_cuenta or lower(c.nombre) = lower(p_cuenta))
      and (c.user_id = p_user_id
        or (c.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id)))
    order by (c.user_id = p_user_id) desc, c.creado_en limit 1;
    if v_cuenta.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
  else
    select * into v_cuenta from public.fin_cuentas c
    where c.user_id = p_user_id and not c.archivada
    order by c.creado_en limit 1;
    if v_cuenta.id is null then
      -- Primera vez: crear "Efectivo" en USD automáticamente.
      insert into public.fin_cuentas (user_id, nombre, moneda, tipo, creado_por)
      values (p_user_id, 'Efectivo', 'USD', 'efectivo', p_user_id)
      returning * into v_cuenta;
    end if;
  end if;

  v_tasa := public.fin_tasa_usd_para(v_cuenta.moneda, v_cuenta.tasa_usd_manual);

  if p_tipo = 'transferencia' then
    if p_cuenta_destino is null then
      raise exception 'destino_requerido';
    end if;
    select * into v_dest from public.fin_cuentas c
    where not c.archivada
      and (c.id::text = p_cuenta_destino or lower(c.nombre) = lower(p_cuenta_destino))
      and (c.user_id = p_user_id
        or (c.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id)))
    order by (c.user_id = p_user_id) desc, c.creado_en limit 1;
    if v_dest.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
    if v_dest.id = v_cuenta.id then
      raise exception 'misma_cuenta';
    end if;
    v_tasa_dest := public.fin_tasa_usd_para(v_dest.moneda, v_dest.tasa_usd_manual);
    -- Autoconversión con los snapshots del momento.
    v_monto_dest := round(p_monto * v_tasa / v_tasa_dest, 2);
  end if;

  insert into public.fin_movimientos
    (user_id, hogar_id, cuenta_id, cuenta_destino_id, tipo, categoria,
     monto, monto_destino, tasa_usd, tasa_usd_destino,
     fecha, nota, clave_evento, creado_por)
  values
    (p_user_id, v_cuenta.hogar_id, v_cuenta.id, v_dest.id, p_tipo,
     nullif(lower(trim(coalesce(p_categoria, ''))), ''),
     p_monto, v_monto_dest, v_tasa, v_tasa_dest,
     coalesce(p_fecha, ((now() at time zone 'America/Caracas'))::date),
     nullif(trim(coalesce(p_nota, '')), ''),
     p_clave_evento, p_user_id)
  returning id into v_mov_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_mov_id,
    'tipo', p_tipo,
    'monto', p_monto,
    'moneda', v_cuenta.moneda,
    'cuenta', v_cuenta.nombre,
    'cuenta_id', v_cuenta.id,
    'destino', case when v_dest.id is not null then v_dest.nombre end,
    'monto_destino', v_monto_dest,
    'moneda_destino', case when v_dest.id is not null then v_dest.moneda end,
    'usd_equivalente', round(p_monto * v_tasa, 2),
    'categoria', nullif(lower(trim(coalesce(p_categoria, ''))), '')
  );
end;
$$;

-- La interna NO se expone: solo la llaman los wrappers con secreto.
revoke all on function public.fin_registrar_interno(uuid, text, numeric, text, text, date, text, text, text) from public;

-- rpc_fin_registrar queda como wrapper con la misma firma (compatibilidad).
create or replace function public.rpc_fin_registrar(
  p_user_id uuid,
  p_tipo text,
  p_monto numeric,
  p_cuenta text default null,
  p_categoria text default null,
  p_fecha date default null,
  p_nota text default null,
  p_clave_evento text default null,
  p_cuenta_destino text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  return public.fin_registrar_interno(
    p_user_id, p_tipo, p_monto, p_cuenta, p_categoria,
    p_fecha, p_nota, p_clave_evento, p_cuenta_destino
  );
end;
$$;

-- ── 2. Tablas de Mercado ─────────────────────────────────────────────────────
create table if not exists public.mer_productos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hogar_id uuid references public.hogares(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 80),
  unidad text not null check (unidad in ('und', 'kg', 'g', 'L', 'ml', 'paquete', 'caja')),
  categoria text not null check (char_length(categoria) between 1 and 40),
  precio_referencia numeric(18, 2) check (precio_referencia is null or precio_referencia > 0),
  activo boolean not null default true,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);

create unique index if not exists mer_productos_user_nombre_idx
  on public.mer_productos (user_id, lower(nombre));

create table if not exists public.mer_movimientos (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.mer_productos(id) on delete restrict,
  tipo text not null check (tipo in ('compra', 'consumo', 'ajuste', 'danado')),
  cantidad numeric(18, 3) not null check (cantidad > 0),
  precio_total numeric(18, 2) check (precio_total is null or precio_total > 0),
  moneda text check (moneda is null or moneda in ('USD', 'VES', 'COP', 'USDT')),
  tasa_usd numeric(18, 6) check (tasa_usd is null or tasa_usd > 0),
  comercio text check (comercio is null or char_length(comercio) between 1 and 80),
  cuenta_id uuid references public.fin_cuentas(id) on delete set null,
  fin_movimiento_id uuid references public.fin_movimientos(id) on delete set null,
  fecha date not null default ((now() at time zone 'America/Caracas'))::date,
  nota text,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  anulado_en timestamptz,
  check (tipo <> 'compra' or precio_total is not null),
  check (tipo = 'compra' or precio_total is null),
  check (tipo = 'compra' or moneda is null),
  check ((precio_total is null) = (tasa_usd is null))
);

create table if not exists public.mer_lista (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hogar_id uuid references public.hogares(id) on delete cascade,
  producto_id uuid not null references public.mer_productos(id) on delete cascade,
  cantidad numeric(18, 3) not null check (cantidad > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'comprado')),
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  unique (user_id, producto_id)
);

create index if not exists mer_productos_user_idx on public.mer_productos (user_id);
create index if not exists mer_productos_hogar_idx on public.mer_productos (hogar_id) where hogar_id is not null;
create index if not exists mer_movimientos_producto_fecha_idx
  on public.mer_movimientos (producto_id, fecha desc);
create index if not exists mer_lista_user_idx on public.mer_lista (user_id);

alter table public.mer_productos enable row level security;
alter table public.mer_movimientos enable row level security;
alter table public.mer_lista enable row level security;

-- RLS: dueño o miembro del hogar (los movimientos heredan el alcance del producto).
drop policy if exists "mer_productos_dueno_o_hogar" on public.mer_productos;
create policy "mer_productos_dueno_o_hogar" on public.mer_productos
  for all
  using (
    auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id))
  )
  with check (
    auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id))
  );

drop policy if exists "mer_movimientos_por_producto" on public.mer_movimientos;
create policy "mer_movimientos_por_producto" on public.mer_movimientos
  for all
  using (
    exists (
      select 1 from public.mer_productos p
      where p.id = producto_id
        and (auth.uid() = p.user_id
          or (p.hogar_id is not null and public.es_miembro_de_hogar(p.hogar_id)))
    )
  )
  with check (
    exists (
      select 1 from public.mer_productos p
      where p.id = producto_id
        and auth.uid() = p.user_id
        and (p.hogar_id is null or public.es_miembro_de_hogar(p.hogar_id))
    )
  );

drop policy if exists "mer_lista_dueno_o_hogar" on public.mer_lista;
create policy "mer_lista_dueno_o_hogar" on public.mer_lista
  for all
  using (
    auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id))
  )
  with check (
    auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id))
  );

-- ── 3. RPCs de Mercado ───────────────────────────────────────────────────────
-- Alcance compartido: producto propio o de un hogar donde p_user_id es miembro.
-- (No usa es_miembro_de_hogar() porque auth.uid() es NULL en RPC por secreto.)

-- Crear o actualizar producto.
create or replace function public.rpc_mer_producto_upsert(
  p_user_id uuid,
  p_nombre text,
  p_unidad text,
  p_categoria text,
  p_precio_ref numeric default null,
  p_hogar_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.mer_productos%rowtype;
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

  insert into public.mer_productos
    (user_id, hogar_id, nombre, unidad, categoria, precio_referencia, creado_por)
  values
    (p_user_id, p_hogar_id, trim(p_nombre), p_unidad,
     lower(trim(p_categoria)), p_precio_ref, p_user_id)
  on conflict (user_id, lower(nombre))
  do update set
    unidad = excluded.unidad,
    categoria = excluded.categoria,
    precio_referencia = coalesce(excluded.precio_referencia, public.mer_productos.precio_referencia),
    hogar_id = coalesce(excluded.hogar_id, public.mer_productos.hogar_id),
    activo = true
  returning * into v_prod;

  return jsonb_build_object(
    'ok', true, 'id', v_prod.id, 'nombre', v_prod.nombre,
    'unidad', v_prod.unidad, 'categoria', v_prod.categoria
  );
end;
$$;

-- Registrar movimiento de inventario. La compra con cuenta genera el egreso.
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
  v_usd_unit numeric;
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

  v_tasa := null;
  if p_tipo = 'compra' then
    if p_precio_total is null or p_precio_total <= 0 then
      raise exception 'precio_requerido';
    end if;
    v_tasa := public.fin_tasa_usd_para(
      coalesce(p_moneda, 'VES'),
      null
    );
    v_usd_unit := round((p_precio_total / v_tasa) / p_cantidad, 4);
  end if;

  -- Compra pagada con cuenta → egreso en finanzas (idempotente por clave).
  if p_tipo = 'compra' and p_cuenta_id is not null then
    v_fin := public.fin_registrar_interno(
      p_user_id, 'egreso', p_precio_total, p_cuenta_id, 'mercado',
      ((now() at time zone 'America/Caracas'))::date,
      trim(coalesce(v_prod.nombre, '') || ' · ' || coalesce(p_comercio, 'mercado')),
      'mer-' || coalesce(p_clave_evento, gen_random_uuid()::text),
      null
    );
  end if;

  insert into public.mer_movimientos
    (producto_id, tipo, cantidad, precio_total, moneda, tasa_usd,
     comercio, cuenta_id, fin_movimiento_id, nota, creado_por)
  values
    (v_prod.id, p_tipo, p_cantidad,
     case when p_tipo = 'compra' then p_precio_total end,
     case when p_tipo = 'compra' then coalesce(p_moneda, 'VES') end,
     v_tasa,
     nullif(trim(coalesce(p_comercio, '')), ''),
     case when p_cuenta_id is not null
       then (v_fin ->> 'cuenta_id')::uuid end,
     case when v_fin is not null then (v_fin ->> 'id')::uuid end,
     nullif(trim(coalesce(p_nota, '')), ''),
     p_user_id)
  returning id into v_mov_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_mov_id,
    'tipo', p_tipo,
    'producto', v_prod.nombre,
    'cantidad', p_cantidad,
    'unidad', v_prod.unidad,
    'precio_usd_unitario', v_usd_unit,
    'fin_movimiento_id', case when v_fin is not null then v_fin ->> 'id' end
  );
end;
$$;

-- Inventario calculado: stock, precios, consumo, agotamiento, sugerido.
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
        (precio_total / tasa_usd) / nullif(cantidad, 0) as usd_unit,
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

-- Historial de precios de un producto (compras, Bs y $).
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
        round((m.precio_total / m.tasa_usd) / m.cantidad, 2) as precio_usd_unitario,
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

-- Lista de compras colaborativa.
create or replace function public.rpc_mer_lista(p_user_id uuid)
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
  if not public.rpc_fin_secret_ok() then
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
  if not public.rpc_fin_secret_ok() then
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

-- Permisos: solo anon/authenticated vía secreto (fail-closed).
revoke all on function public.rpc_mer_producto_upsert(uuid, text, text, text, numeric, uuid) from public;
grant execute on function public.rpc_mer_producto_upsert(uuid, text, text, text, numeric, uuid) to anon, authenticated;
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
