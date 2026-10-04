-- 0042_mercado_actualizar_marca_presentacion.sql
-- Continúa la 0041: rpc_mer_producto_actualizar también acepta marca y presentación
-- (los usa la hoja de edición de la app).

create or replace function public.rpc_mer_producto_actualizar(
  p_user_id uuid,
  p_producto_id uuid,
  p_nombre text default null,
  p_categoria text default null,
  p_horizonte_dias int default null,
  p_consumo_semanal_estim numeric default null,
  p_quitar_estimado boolean default false,
  p_activo boolean default null,
  p_stock_minimo numeric default null,
  p_marca text default null,
  p_presentacion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.mer_productos%rowtype;
  v_paso boolean := false;
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
  if p_stock_minimo is not null and p_stock_minimo < 0 then
    raise exception 'minimo_invalido';
  end if;

  update public.mer_productos set
    nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
    categoria = lower(coalesce(nullif(trim(p_categoria), ''), categoria)),
    marca = coalesce(nullif(trim(p_marca), ''), marca),
    presentacion = coalesce(nullif(trim(p_presentacion), ''), presentacion),
    horizonte_compra_dias = coalesce(p_horizonte_dias, horizonte_compra_dias),
    consumo_semanal_estim = case
      when p_quitar_estimado then null
      else coalesce(p_consumo_semanal_estim, consumo_semanal_estim)
    end,
    stock_minimo = coalesce(p_stock_minimo, stock_minimo),
    activo = coalesce(p_activo, activo)
  where id = v_prod.id
  returning * into v_prod;

  -- Si cambió el umbral, evaluar de inmediato (el stock ya puede estar debajo).
  if p_stock_minimo is not null then
    v_paso := public.mer_pasar_a_lista_si_reorden(p_user_id, v_prod.id);
  end if;

  -- 0040: al desactivar, el producto sale de la lista de compras.
  if p_activo is not null and not p_activo then
    delete from public.mer_lista l where l.producto_id = v_prod.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_prod.id, 'nombre', v_prod.nombre,
    'categoria', v_prod.categoria, 'activo', v_prod.activo,
    'marca', v_prod.marca, 'presentacion', v_prod.presentacion,
    'horizonte_compra_dias', v_prod.horizonte_compra_dias,
    'consumo_semanal_estim', v_prod.consumo_semanal_estim,
    'stock_minimo', v_prod.stock_minimo,
    'paso_a_lista', v_paso
  );
exception when unique_violation then
  raise exception 'nombre_duplicado';
end;
$$;
