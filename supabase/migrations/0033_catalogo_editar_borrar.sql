-- 0033: Catálogo — editar y borrar productos por id.
-- (El upsert existente solo matchea por nombre; la edición necesita id explícito.)

-- ── 1. Productos: actualizar por id (propio o compartido con mi hogar) ───────
create or replace function public.rpc_cat_producto_actualizar(
  p_user_id uuid,
  p_id uuid,
  p_nombre text,
  p_unidad text,
  p_categoria text,
  p_precio_venta numeric,
  p_moneda text,
  p_costo numeric default null,
  p_notas text default null
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

  update public.cat_productos set
    nombre = trim(p_nombre),
    unidad = p_unidad,
    categoria = trim(p_categoria),
    precio_venta = p_precio_venta,
    moneda = p_moneda,
    costo = p_costo,
    notas = nullif(trim(coalesce(p_notas, '')), '')
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

-- ── 2. Productos: borrar (propio o compartido con mi hogar) ──────────────────
create or replace function public.rpc_cat_producto_eliminar(
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
  delete from public.cat_productos
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

grant execute on function public.rpc_cat_producto_actualizar(uuid, uuid, text, text, text, numeric, text, numeric, text) to anon, authenticated;
grant execute on function public.rpc_cat_producto_eliminar(uuid, uuid) to anon, authenticated;
