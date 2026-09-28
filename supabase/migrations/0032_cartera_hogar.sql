-- ── 0032. Cartera: endurecer alcance de hogar (fail-closed) ───────────────────
-- Las RPC de cartera (0031) aceptaban p_hogar_id sin validar membresía y los
-- listados solo filtraban por user_id. Patrón tomado de Mercado (0022):
-- auth.uid() es NULL en llamadas por secreto, así que la membresía se valida
-- directo contra hogar_miembros con p_user_id.
--
-- Modelo:
--   - escritura con p_hogar_id → el usuario debe ser miembro (si no: 'hogar_no_valido')
--   - lectura → filas propias + filas de hogares donde es miembro
--   - desactivar → fila propia o compartida con un hogar donde es miembro
--   - movimiento → cliente propio o compartido con un hogar donde es miembro

-- ── 1. Helper: ¿puede p_user_id usar p_hogar_id? ─────────────────────────────
create or replace function public.rpc_cartera_hogar_ok(p_user_id uuid, p_hogar_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_hogar_id is null
    or exists (
      select 1 from public.hogar_miembros hm
      where hm.hogar_id = p_hogar_id and hm.user_id = p_user_id
    );
$$;
grant execute on function public.rpc_cartera_hogar_ok(uuid, uuid) to anon, authenticated;

-- ── 2. Productos: upsert (valida hogar) ──────────────────────────────────────
create or replace function public.rpc_cat_producto_upsert(
  p_user_id uuid,
  p_nombre text,
  p_unidad text,
  p_categoria text,
  p_precio_venta numeric,
  p_moneda text,
  p_costo numeric default null,
  p_notas text default null,
  p_hogar_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.cat_productos%rowtype;
  v_nuevo boolean := false;
begin
  if not public.rpc_cartera_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if not public.rpc_cartera_hogar_ok(p_user_id, p_hogar_id) then
    raise exception 'hogar_no_valido';
  end if;
  if p_nombre is null or char_length(trim(p_nombre)) = 0 then
    raise exception 'nombre_requerido';
  end if;
  if p_unidad not in ('und', 'kg', 'g', 'L', 'ml', 'paquete', 'caja', 'servicio') then
    raise exception 'unidad_invalida';
  end if;
  if p_categoria is null or char_length(trim(p_categoria)) = 0 then
    raise exception 'categoria_requerida';
  end if;
  if p_precio_venta is null or p_precio_venta <= 0 then
    raise exception 'precio_invalido';
  end if;
  if p_moneda not in ('USD', 'VES', 'COP', 'USDT') then
    raise exception 'moneda_invalida';
  end if;
  if p_costo is not null and p_costo <= 0 then
    raise exception 'costo_invalido';
  end if;

  select * into v_prod from public.cat_productos
  where user_id = p_user_id and lower(nombre) = lower(trim(p_nombre));

  if found then
    update public.cat_productos set
      unidad = p_unidad,
      categoria = trim(p_categoria),
      precio_venta = p_precio_venta,
      moneda = p_moneda,
      costo = p_costo,
      notas = nullif(trim(coalesce(p_notas, '')), ''),
      activo = true,
      hogar_id = coalesce(p_hogar_id, hogar_id)
    where id = v_prod.id
    returning * into v_prod;
  else
    v_nuevo := true;
    insert into public.cat_productos
      (user_id, hogar_id, nombre, unidad, categoria, precio_venta, moneda, costo, notas, creado_por)
    values
      (p_user_id, p_hogar_id, trim(p_nombre), p_unidad, trim(p_categoria),
       p_precio_venta, p_moneda, p_costo, nullif(trim(coalesce(p_notas, '')), ''), p_user_id)
    returning * into v_prod;
  end if;

  return jsonb_build_object('ok', true, 'id', v_prod.id, 'nuevo', v_nuevo, 'nombre', v_prod.nombre);
end;
$$;

-- ── 3. Productos: listar (alcance propio + hogar) ────────────────────────────
create or replace function public.rpc_cat_producto_listar(
  p_user_id uuid,
  p_solo_activos boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.rpc_cartera_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(p) order by p.nombre)
    from public.cat_productos p
    where (p.user_id = p_user_id
        or (p.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = p.hogar_id and hm.user_id = p_user_id)))
      and (not p_solo_activos or p.activo)
  ), '[]'::jsonb);
end;
$$;

-- ── 4. Productos: desactivar (propio o compartido con mi hogar) ──────────────
create or replace function public.rpc_cat_producto_desactivar(
  p_user_id uuid,
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n text;
begin
  if not public.rpc_cartera_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  update public.cat_productos set activo = false
  where id = p_id
    and (user_id = p_user_id
      or (hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = hogar_id and hm.user_id = p_user_id)))
  returning nombre into v_n;
  if not found then
    raise exception 'producto_no_encontrado';
  end if;
  return jsonb_build_object('ok', true, 'nombre', v_n);
end;
$$;

-- ── 5. Clientes: upsert (valida hogar) ───────────────────────────────────────
create or replace function public.rpc_car_cliente_upsert(
  p_user_id uuid,
  p_nombre text,
  p_tipo text default 'cliente',
  p_telefono text default null,
  p_email text default null,
  p_notas text default null,
  p_hogar_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cli public.car_clientes%rowtype;
  v_nuevo boolean := false;
begin
  if not public.rpc_cartera_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if not public.rpc_cartera_hogar_ok(p_user_id, p_hogar_id) then
    raise exception 'hogar_no_valido';
  end if;
  if p_nombre is null or char_length(trim(p_nombre)) = 0 then
    raise exception 'nombre_requerido';
  end if;
  if p_tipo not in ('cliente', 'proveedor', 'ambos') then
    raise exception 'tipo_invalido';
  end if;

  select * into v_cli from public.car_clientes
  where user_id = p_user_id and lower(nombre) = lower(trim(p_nombre));

  if found then
    update public.car_clientes set
      tipo = p_tipo,
      telefono = nullif(trim(coalesce(p_telefono, '')), ''),
      email = nullif(trim(coalesce(p_email, '')), ''),
      notas = nullif(trim(coalesce(p_notas, '')), ''),
      activo = true,
      hogar_id = coalesce(p_hogar_id, hogar_id)
    where id = v_cli.id
    returning * into v_cli;
  else
    v_nuevo := true;
    insert into public.car_clientes
      (user_id, hogar_id, nombre, tipo, telefono, email, notas, creado_por)
    values
      (p_user_id, p_hogar_id, trim(p_nombre), p_tipo,
       nullif(trim(coalesce(p_telefono, '')), ''),
       nullif(trim(coalesce(p_email, '')), ''),
       nullif(trim(coalesce(p_notas, '')), ''), p_user_id)
    returning * into v_cli;
  end if;

  return jsonb_build_object('ok', true, 'id', v_cli.id, 'nuevo', v_nuevo, 'nombre', v_cli.nombre);
end;
$$;

-- ── 6. Clientes: listar (alcance propio + hogar) ─────────────────────────────
create or replace function public.rpc_car_cliente_listar(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.rpc_cartera_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'nombre', c.nombre,
        'tipo', c.tipo,
        'telefono', c.telefono,
        'email', c.email,
        'notas', c.notas,
        'activo', c.activo,
        'saldos', coalesce((
          select jsonb_agg(to_jsonb(s) order by s.moneda)
          from (
            select m.moneda as moneda,
                   sum(case when m.tipo = 'cargo' then m.monto else -m.monto end) as saldo
            from public.car_movimientos m
            where m.cliente_id = c.id
            group by m.moneda
          ) s
        ), '[]'::jsonb)
      )
      order by c.nombre
    )
    from public.car_clientes c
    where c.user_id = p_user_id
       or (c.hogar_id is not null and exists (
         select 1 from public.hogar_miembros hm
         where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id))
  ), '[]'::jsonb);
end;
$$;

-- ── 7. Clientes: desactivar (propio o compartido con mi hogar) ────────────────
create or replace function public.rpc_car_cliente_desactivar(
  p_user_id uuid,
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n text;
begin
  if not public.rpc_cartera_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  update public.car_clientes set activo = false
  where id = p_id
    and (user_id = p_user_id
      or (hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = hogar_id and hm.user_id = p_user_id)))
  returning nombre into v_n;
  if not found then
    raise exception 'cliente_no_encontrado';
  end if;
  return jsonb_build_object('ok', true, 'nombre', v_n);
end;
$$;

-- ── 8. Cartera: movimiento (cliente propio o compartido con mi hogar) ────────
create or replace function public.rpc_car_movimiento(
  p_user_id uuid,
  p_cliente_id uuid,
  p_tipo text,
  p_concepto text,
  p_monto numeric,
  p_moneda text,
  p_fecha date default null,
  p_recibo_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cli public.car_clientes%rowtype;
  v_mov public.car_movimientos%rowtype;
  v_saldo numeric;
begin
  if not public.rpc_cartera_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  select * into v_cli from public.car_clientes
  where id = p_cliente_id
    and (user_id = p_user_id
      or (hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = hogar_id and hm.user_id = p_user_id)));
  if not found then
    raise exception 'cliente_no_encontrado';
  end if;
  if p_tipo not in ('cargo', 'abono') then
    raise exception 'tipo_invalido';
  end if;
  if p_concepto is null or char_length(trim(p_concepto)) = 0 then
    raise exception 'concepto_requerido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto_invalido';
  end if;
  if p_moneda not in ('USD', 'VES', 'COP', 'USDT') then
    raise exception 'moneda_invalida';
  end if;
  if p_recibo_id is not null then
    perform 1 from public.fin_recibos r
    where r.id = p_recibo_id and r.user_id = p_user_id;
    if not found then
      raise exception 'recibo_no_encontrado';
    end if;
  end if;

  insert into public.car_movimientos
    (cliente_id, tipo, concepto, monto, moneda, fecha, recibo_id, creado_por)
  values
    (p_cliente_id, p_tipo, trim(p_concepto), p_monto, p_moneda,
     coalesce(p_fecha, (now() at time zone 'America/Caracas')::date),
     p_recibo_id, p_user_id)
  returning * into v_mov;

  select coalesce(sum(case when tipo = 'cargo' then monto else -monto end), 0)
    into v_saldo
  from public.car_movimientos
  where cliente_id = p_cliente_id and moneda = p_moneda;

  return jsonb_build_object(
    'ok', true,
    'id', v_mov.id,
    'cliente', v_cli.nombre,
    'saldo_moneda', v_saldo,
    'moneda', p_moneda
  );
end;
$$;

-- ── 9. Cartera: resumen/detalle (alcance propio + hogar) ─────────────────────
create or replace function public.rpc_car_cartera(
  p_user_id uuid,
  p_cliente_id uuid default null,
  p_limite_movimientos integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cli public.car_clientes%rowtype;
begin
  if not public.rpc_cartera_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;

  if p_cliente_id is not null then
    select * into v_cli from public.car_clientes
    where id = p_cliente_id
      and (user_id = p_user_id
        or (hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = hogar_id and hm.user_id = p_user_id)));
    if not found then
      raise exception 'cliente_no_encontrado';
    end if;
    return jsonb_build_object(
      'ok', true,
      'cliente', jsonb_build_object(
        'id', v_cli.id, 'nombre', v_cli.nombre, 'tipo', v_cli.tipo,
        'telefono', v_cli.telefono, 'email', v_cli.email, 'activo', v_cli.activo
      ),
      'saldos', coalesce((
        select jsonb_agg(to_jsonb(s) order by s.moneda)
        from (
          select moneda,
                 sum(case when tipo = 'cargo' then monto else 0 end) as cargos,
                 sum(case when tipo = 'abono' then monto else 0 end) as abonos,
                 sum(case when tipo = 'cargo' then monto else -monto end) as saldo
          from public.car_movimientos
          where cliente_id = p_cliente_id
          group by moneda
        ) s
      ), '[]'::jsonb),
      'movimientos', coalesce((
        select jsonb_agg(to_jsonb(m) order by m.fecha desc, m.creado_en desc)
        from (
          select * from public.car_movimientos
          where cliente_id = p_cliente_id
          order by fecha desc, creado_en desc
          limit greatest(p_limite_movimientos, 1)
        ) m
      ), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'clientes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'nombre', c.nombre,
          'tipo', c.tipo,
          'activo', c.activo,
          'saldos', coalesce((
            select jsonb_agg(to_jsonb(s) order by s.moneda)
            from (
              select moneda,
                     sum(case when tipo = 'cargo' then monto else -monto end) as saldo
              from public.car_movimientos
              where cliente_id = c.id
              group by moneda
            ) s
          ), '[]'::jsonb)
        )
        order by c.nombre
      )
      from public.car_clientes c
      where c.user_id = p_user_id and c.activo
         or (c.hogar_id is not null and c.activo and exists (
           select 1 from public.hogar_miembros hm
           where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id))
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.rpc_cat_producto_upsert(uuid, text, text, text, numeric, text, numeric, text, uuid) to anon, authenticated;
grant execute on function public.rpc_cat_producto_listar(uuid, boolean) to anon, authenticated;
grant execute on function public.rpc_cat_producto_desactivar(uuid, uuid) to anon, authenticated;
grant execute on function public.rpc_car_cliente_upsert(uuid, text, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.rpc_car_cliente_listar(uuid) to anon, authenticated;
grant execute on function public.rpc_car_cliente_desactivar(uuid, uuid) to anon, authenticated;
grant execute on function public.rpc_car_movimiento(uuid, uuid, text, text, numeric, text, date, uuid) to anon, authenticated;
grant execute on function public.rpc_car_cartera(uuid, uuid, integer) to anon, authenticated;
