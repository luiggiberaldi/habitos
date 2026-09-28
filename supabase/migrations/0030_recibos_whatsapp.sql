-- 0030_recibos_whatsapp.sql — Fase 5.3: Recibos por WhatsApp.
--
-- - rpc_recibo_listar / rpc_recibo_ver / rpc_recibo_duplicar (SECURITY DEFINER,
--   auth dual como 0029: secreto x-fin-rpc-secret o JWT del navegador).
-- - Las lecturas resuelven la pertenencia al hogar con p_user_id en vez de
--   es_miembro_de_hogar(), porque esa función depende de auth.uid() (nulo en
--   llamadas con secreto desde WhatsApp).
-- - rpc_recibo_numero pasa a ser interna: se revoca el acceso directo de
--   anon/authenticated para no consumir números sin crear recibos
--   (guardarraíl #2: sin huecos). Solo rpc_recibo_crear/duplicar la llaman.

-- ── Listar recibos visibles (dueño o miembro del hogar) ──
create or replace function public.rpc_recibo_listar(
  p_user_id uuid,
  p_limite int default 10,
  p_busqueda text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.rpc_recibo_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.creado_en desc)
    from (
      select r.id, r.numero, r.estado, r.moneda, r.cliente_nombre,
             r.total, r.total_pagado, r.saldo, r.fecha_emision, r.creado_en
      from public.fin_recibos r
      where (r.user_id = p_user_id
             or (r.hogar_id is not null and exists (
                   select 1 from public.hogar_miembros hm
                   where hm.hogar_id = r.hogar_id and hm.user_id = p_user_id)))
        and (p_busqueda is null or trim(p_busqueda) = ''
             or r.numero ilike '%' || trim(p_busqueda) || '%'
             or r.cliente_nombre ilike '%' || trim(p_busqueda) || '%')
      order by r.creado_en desc
      limit greatest(1, least(coalesce(p_limite, 10), 50))
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ── Ver un recibo (número exacto o mejor coincidencia por cliente/número) ──
create or replace function public.rpc_recibo_ver(
  p_user_id uuid,
  p_busqueda text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.rpc_recibo_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if p_busqueda is null or trim(p_busqueda) = '' then
    raise exception 'busqueda_requerida';
  end if;
  -- 1) número exacto (insensible a mayúsculas)
  select to_jsonb(r) into v
  from public.fin_recibos r
  where upper(r.numero) = upper(trim(p_busqueda))
    and (r.user_id = p_user_id
         or (r.hogar_id is not null and exists (
               select 1 from public.hogar_miembros hm
               where hm.hogar_id = r.hogar_id and hm.user_id = p_user_id)));
  if v is not null then return v; end if;
  -- 2) mejor coincidencia parcial por cliente o número
  select to_jsonb(r) into v
  from public.fin_recibos r
  where (r.user_id = p_user_id
         or (r.hogar_id is not null and exists (
               select 1 from public.hogar_miembros hm
               where hm.hogar_id = r.hogar_id and hm.user_id = p_user_id)))
    and (r.numero ilike '%' || trim(p_busqueda) || '%'
         or r.cliente_nombre ilike '%' || trim(p_busqueda) || '%')
  order by r.creado_en desc
  limit 1;
  if v is null then raise exception 'recibo_no_encontrado'; end if;
  return v;
end;
$$;

-- ── Duplicar: nuevo número, pagos en cero, mismos conceptos ──
create or replace function public.rpc_recibo_duplicar(
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
  v_numero text;
  v_id uuid;
  v_snap jsonb;
begin
  if not public.rpc_recibo_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  select * into v_rec
  from public.fin_recibos r
  where r.id = p_recibo_id
    and (r.user_id = p_user_id
         or (r.hogar_id is not null and exists (
               select 1 from public.hogar_miembros hm
               where hm.hogar_id = r.hogar_id and hm.user_id = p_user_id)));
  if not found then
    raise exception 'recibo_no_encontrado';
  end if;

  v_snap := v_rec.snapshot;
  if jsonb_typeof(v_snap) <> 'object' then
    v_snap := '{}'::jsonb;
  end if;
  v_snap := jsonb_set(v_snap, '{pagos}', '[]'::jsonb, true);

  v_numero := public.rpc_recibo_numero(p_user_id, v_rec.hogar_id);

  insert into public.fin_recibos
    (user_id, hogar_id, numero, moneda, cliente_nombre, snapshot, total, saldo,
     fecha_emision, fecha_vencimiento, creado_por)
  values
    (p_user_id, v_rec.hogar_id, v_numero, v_rec.moneda, v_rec.cliente_nombre,
     v_snap, v_rec.total, v_rec.total,
     ((now() at time zone 'America/Caracas'))::date,
     v_rec.fecha_vencimiento, p_user_id)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
end;
$$;

-- ── Grants ──
grant execute on function public.rpc_recibo_listar(uuid, int, text) to anon, authenticated;
grant execute on function public.rpc_recibo_ver(uuid, text) to anon, authenticated;
grant execute on function public.rpc_recibo_duplicar(uuid, uuid) to anon, authenticated;

-- ── Endurecer la secuencia: número solo vía crear/duplicar ──
revoke execute on function public.rpc_recibo_numero(uuid, uuid) from anon, authenticated;
