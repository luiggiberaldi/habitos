-- 0016_hogar.sql — Hogar: el hogar compartido de Senda (Fase 0).
--
-- Base sobre la que se montan Finanzas y Mercado compartidos. Decisiones:
-- - Un usuario pertenece a UN hogar (múltiples hogares por usuario queda
--   explícitamente fuera de alcance en el roadmap).
-- - `hogares`: el hogar (nombre + creador).
-- - `hogar_miembros`: (hogar_id, user_id) con rol admin|miembro. El creador
--   queda como admin.
-- - Lecturas y escrituras solo vía RPC SECURITY DEFINER (el cliente nunca
--   toca las tablas directo): crear_hogar, obtener_mi_hogar,
--   renombrar_hogar, invitar_al_hogar, expulsar_del_hogar, salir_del_hogar.
-- - RLS activado con policies de lectura apoyadas en es_miembro_de_hogar()
--   (SECURITY DEFINER) para no caer en la recursión infinita del 0011.
-- - `invitar_al_hogar` busca la cuenta por correo en auth.users: si existe
--   entra directo; si no, devuelve error cuenta_no_existe y la app ofrece
--   crear la cuenta (Edge Function crear-usuario) y reintentar.

create table if not exists public.hogares (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 60),
  creado_por uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.hogar_miembros (
  hogar_id uuid not null references public.hogares(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null default 'miembro' check (rol in ('admin', 'miembro')),
  created_at timestamptz not null default now(),
  primary key (hogar_id, user_id)
);

alter table public.hogares enable row level security;
alter table public.hogar_miembros enable row level security;

-- Anti-recursión (patrón 0011): la membresía se comprueba en funciones
-- SECURITY DEFINER; las policies solo las llaman.
create or replace function public.es_miembro_de_hogar(p_hogar_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.hogar_miembros
    where hogar_id = p_hogar_id and user_id = auth.uid()
  );
$$;

create or replace function public.es_admin_de_hogar(p_hogar_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.hogar_miembros
    where hogar_id = p_hogar_id and user_id = auth.uid() and rol = 'admin'
  );
$$;

grant execute on function public.es_miembro_de_hogar(uuid) to authenticated;
grant execute on function public.es_admin_de_hogar(uuid) to authenticated;

drop policy if exists "hogares_miembros_select" on public.hogares;
create policy "hogares_miembros_select" on public.hogares
  for select
  using (
    auth.uid() = creado_por
    or public.es_miembro_de_hogar(id)
  );

drop policy if exists "hogar_miembros_select" on public.hogar_miembros;
create policy "hogar_miembros_select" on public.hogar_miembros
  for select
  using (public.es_miembro_de_hogar(hogar_id));

-- Sin policies de insert/update/delete: toda escritura pasa por los RPCs.

-- Hogar del usuario actual (o null): incluye emails de auth.users para
-- mostrar los miembros sin exponer auth.users al cliente.
create or replace function public.obtener_mi_hogar()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_hogar public.hogares%rowtype;
  v_miembros jsonb;
  v_soy_admin boolean;
begin
  if v_uid is null then
    raise exception 'no_autenticado';
  end if;

  select h.* into v_hogar
  from public.hogares h
  join public.hogar_miembros m on m.hogar_id = h.id
  where m.user_id = v_uid
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', m.user_id,
      'email', u.email,
      'rol', m.rol,
      'es_yo', m.user_id = v_uid,
      'creado', m.created_at
    )
    order by m.created_at
  ), '[]'::jsonb)
  into v_miembros
  from public.hogar_miembros m
  join auth.users u on u.id = m.user_id
  where m.hogar_id = v_hogar.id;

  select exists (
    select 1 from public.hogar_miembros
    where hogar_id = v_hogar.id and user_id = v_uid and rol = 'admin'
  ) into v_soy_admin;

  return jsonb_build_object(
    'id', v_hogar.id,
    'nombre', v_hogar.nombre,
    'creado_por', v_hogar.creado_por,
    'soy_admin', v_soy_admin,
    'miembros', v_miembros
  );
end;
$$;

grant execute on function public.obtener_mi_hogar() to authenticated;

-- Crear el hogar del usuario (uno por usuario en Fase 0).
create or replace function public.crear_hogar(p_nombre text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'no_autenticado';
  end if;
  if char_length(v_nombre) < 1 or char_length(v_nombre) > 60 then
    raise exception 'nombre_invalido';
  end if;
  if exists (select 1 from public.hogar_miembros where user_id = v_uid) then
    raise exception 'ya_tiene_hogar';
  end if;

  insert into public.hogares (nombre, creado_por)
  values (v_nombre, v_uid)
  returning id into v_id;

  insert into public.hogar_miembros (hogar_id, user_id, rol)
  values (v_id, v_uid, 'admin');

  return v_id;
end;
$$;

grant execute on function public.crear_hogar(text) to authenticated;

-- Renombrar (solo admin).
create or replace function public.renombrar_hogar(p_nombre text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hogar_id uuid;
  v_nombre text := btrim(coalesce(p_nombre, ''));
begin
  if v_uid is null then
    raise exception 'no_autenticado';
  end if;
  select hogar_id into v_hogar_id
  from public.hogar_miembros where user_id = v_uid limit 1;
  if v_hogar_id is null then
    raise exception 'sin_hogar';
  end if;
  if not public.es_admin_de_hogar(v_hogar_id) then
    raise exception 'no_admin';
  end if;
  if char_length(v_nombre) < 1 or char_length(v_nombre) > 60 then
    raise exception 'nombre_invalido';
  end if;
  update public.hogares set nombre = v_nombre where id = v_hogar_id;
end;
$$;

grant execute on function public.renombrar_hogar(text) to authenticated;

-- Invitar por correo (solo admin). Si la cuenta existe entra directo; si no,
-- error cuenta_no_existe para que la app ofrezca crearla.
create or replace function public.invitar_al_hogar(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hogar_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_invitado_id uuid;
  v_invitado_email text;
begin
  if v_uid is null then
    raise exception 'no_autenticado';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'correo_invalido';
  end if;

  select hogar_id into v_hogar_id
  from public.hogar_miembros where user_id = v_uid limit 1;
  if v_hogar_id is null then
    raise exception 'sin_hogar';
  end if;
  if not public.es_admin_de_hogar(v_hogar_id) then
    raise exception 'no_admin';
  end if;

  select id, email into v_invitado_id, v_invitado_email
  from auth.users where lower(email) = v_email limit 1;

  if v_invitado_id is null then
    raise exception 'cuenta_no_existe';
  end if;
  if v_invitado_id = v_uid then
    raise exception 'eres_tu';
  end if;
  if exists (
    select 1 from public.hogar_miembros
    where hogar_id = v_hogar_id and user_id = v_invitado_id
  ) then
    raise exception 'ya_es_miembro';
  end if;

  insert into public.hogar_miembros (hogar_id, user_id, rol)
  values (v_hogar_id, v_invitado_id, 'miembro');

  return jsonb_build_object('user_id', v_invitado_id, 'email', v_invitado_email);
end;
$$;

grant execute on function public.invitar_al_hogar(text) to authenticated;

-- Expulsar a un miembro (solo admin, solo a miembros no-admin).
create or replace function public.expulsar_del_hogar(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hogar_id uuid;
  v_rol text;
begin
  if v_uid is null then
    raise exception 'no_autenticado';
  end if;
  select hogar_id into v_hogar_id
  from public.hogar_miembros where user_id = v_uid limit 1;
  if v_hogar_id is null then
    raise exception 'sin_hogar';
  end if;
  if not public.es_admin_de_hogar(v_hogar_id) then
    raise exception 'no_admin';
  end if;
  if p_user_id = v_uid then
    raise exception 'usa_salir';
  end if;
  select rol into v_rol from public.hogar_miembros
  where hogar_id = v_hogar_id and user_id = p_user_id;
  if not found then
    raise exception 'no_es_miembro';
  end if;
  if v_rol = 'admin' then
    raise exception 'no_expulsar_admin';
  end if;
  delete from public.hogar_miembros
  where hogar_id = v_hogar_id and user_id = p_user_id;
end;
$$;

grant execute on function public.expulsar_del_hogar(uuid) to authenticated;

-- Salir del hogar. Si era el último miembro, el hogar se elimina. Si era el
-- único admin y quedan miembros, el más antiguo asciende a admin.
create or replace function public.salir_del_hogar()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hogar_id uuid;
  v_era_admin boolean;
  v_restantes integer;
begin
  if v_uid is null then
    raise exception 'no_autenticado';
  end if;
  select hogar_id into v_hogar_id
  from public.hogar_miembros where user_id = v_uid limit 1;
  if v_hogar_id is null then
    raise exception 'sin_hogar';
  end if;

  select (rol = 'admin') into v_era_admin from public.hogar_miembros
  where hogar_id = v_hogar_id and user_id = v_uid;

  delete from public.hogar_miembros
  where hogar_id = v_hogar_id and user_id = v_uid;

  select count(*) into v_restantes from public.hogar_miembros
  where hogar_id = v_hogar_id;

  if v_restantes = 0 then
    delete from public.hogares where id = v_hogar_id;
  elsif v_era_admin then
    -- Si queda otro admin, nada que hacer; si no, asciende el más antiguo.
    if not exists (
      select 1 from public.hogar_miembros
      where hogar_id = v_hogar_id and rol = 'admin'
    ) then
      update public.hogar_miembros set rol = 'admin'
      where hogar_id = v_hogar_id
        and created_at = (
          select min(created_at) from public.hogar_miembros
          where hogar_id = v_hogar_id
        );
    end if;
  end if;
end;
$$;

grant execute on function public.salir_del_hogar() to authenticated;
