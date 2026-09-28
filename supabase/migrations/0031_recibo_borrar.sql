-- 0031 — Borrado definitivo de recibos (reemplaza "anular" en la app).
-- Los pagos viven en el snapshot JSONB: no hay tablas hijas que limpiar.

create or replace function public.rpc_recibo_borrar(
  p_user_id uuid,
  p_recibo_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.fin_recibos%rowtype;
begin
  if not public.rpc_recibo_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;

  select * into v_rec from public.fin_recibos where id = p_recibo_id;
  if not found then
    raise exception 'recibo_no_encontrado';
  end if;
  if v_rec.user_id <> p_user_id
     and not (v_rec.hogar_id is not null and public.es_miembro_de_hogar(v_rec.hogar_id)) then
    raise exception 'no_autorizado';
  end if;

  delete from public.fin_recibos where id = p_recibo_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.rpc_recibo_borrar(uuid, uuid) from public;
grant execute on function public.rpc_recibo_borrar(uuid, uuid) to anon, authenticated;
