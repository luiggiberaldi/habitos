-- 0043_mercado_lista_marca_presentacion.sql
-- La lista de compras también muestra marca y presentación del producto.

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
        pr.marca, pr.presentacion,
        l.cantidad, l.estado, l.creado_en
      from public.mer_lista l
      join public.mer_productos pr on pr.id = l.producto_id
      where pr.activo
        and (l.user_id = p_user_id
        or (l.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = l.hogar_id and hm.user_id = p_user_id)))
    ) t
  );
end;
$$;
