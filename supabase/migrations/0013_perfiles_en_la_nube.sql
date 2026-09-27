-- 0013: perfiles en la nube (estilo Netflix, una cuenta, varios perfiles).
--
-- Modelo: una cuenta Supabase (auth.users) contiene varios perfiles. Cada
-- perfil es un silo de datos completo: sus hábitos, registros, juego,
-- notificaciones y liga viven con perfil_id. La UI es la misma de los
-- perfiles locales (tarjetas Netflix), pero todo persiste en la nube.
--
-- El uuid cero ('0000...') marca filas legado sin adoptar: la app las
-- adopta al primer perfil creado (update puntual, una sola vez).

-- 1. Tabla de perfiles -----------------------------------------------------
create table if not exists public.perfiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 24),
  color text not null,
  avatar text,
  foto text,
  creado_en timestamptz not null default now(),
  ultimo_uso timestamptz not null default now()
);

alter table public.perfiles enable row level security;

drop policy if exists perfiles_owner on public.perfiles;
create policy perfiles_owner on public.perfiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists perfiles_user_id_idx on public.perfiles(user_id);

-- 2. Columna perfil_id en las tablas de datos --------------------------------
alter table public.habits add column if not exists perfil_id uuid;
alter table public.completions add column if not exists perfil_id uuid;
alter table public.push_subscriptions add column if not exists perfil_id uuid;
alter table public.activity_log add column if not exists perfil_id uuid;

-- game_state: PK (user_id) -> (user_id, perfil_id)
alter table public.game_state
  add column if not exists perfil_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.game_state drop constraint if exists game_state_pkey;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'game_state_user_perfil_pkey') then
    alter table public.game_state add constraint game_state_user_perfil_pkey primary key (user_id, perfil_id);
  end if;
end $$;

-- deleted_habits: PK (user_id, habit_id) -> (user_id, perfil_id, habit_id)
alter table public.deleted_habits
  add column if not exists perfil_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.deleted_habits drop constraint if exists deleted_habits_pkey;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'deleted_habits_user_perfil_habit_pkey') then
    alter table public.deleted_habits add constraint deleted_habits_user_perfil_habit_pkey primary key (user_id, perfil_id, habit_id);
  end if;
end $$;

-- push_subscriptions: unique(endpoint) -> unique(endpoint, perfil_id)
-- (un mismo dispositivo puede suscribir varios perfiles)
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_endpoint_perfil_uniq') then
    alter table public.push_subscriptions
      add constraint push_subscriptions_endpoint_perfil_uniq unique (endpoint, perfil_id);
  end if;
end $$;

-- liga_miembros: PK (liga_id, user_id) -> (liga_id, user_id, perfil_id)
-- (cada perfil compite con su propio XP)
alter table public.liga_miembros
  add column if not exists perfil_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.liga_miembros drop constraint if exists liga_miembros_pkey;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'liga_miembros_liga_user_perfil_pkey') then
    alter table public.liga_miembros add constraint liga_miembros_liga_user_perfil_pkey primary key (liga_id, user_id, perfil_id);
  end if;
end $$;

-- Índices para los filtros por perfil
create index if not exists habits_perfil_idx on public.habits(user_id, perfil_id);
create index if not exists completions_perfil_idx on public.completions(user_id, perfil_id);
create index if not exists push_subscriptions_perfil_idx on public.push_subscriptions(user_id, perfil_id);

-- 3. unirse_a_liga con perfil_id ----------------------------------------------
create or replace function public.unirse_a_liga(p_codigo text, p_nombre text, p_perfil_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_liga uuid;
  v_nombre text;
begin
  select id into v_liga from public.ligas where codigo = upper(p_codigo);
  if v_liga is null then
    raise exception 'codigo_invalido';
  end if;
  v_nombre := coalesce(nullif(trim(p_nombre), ''), 'Jugador');
  insert into public.liga_miembros (liga_id, user_id, perfil_id, nombre_visible)
  values (v_liga, auth.uid(), p_perfil_id, v_nombre)
  on conflict (liga_id, user_id, perfil_id)
  do update set nombre_visible = excluded.nombre_visible;
  return v_liga;
end
$function$;

-- 4. RPCs conversacionales con p_perfil_id --------------------------------------
-- (los usa el puente de WhatsApp; el secreto compartido sigue siendo el gate)

create or replace function public.rpc_game_get(p_user_id uuid, p_perfil_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_data jsonb;
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select g.data into v_data
  from public.game_state g
  where g.user_id = p_user_id and g.perfil_id = p_perfil_id;
  return v_data;
end;
$function$;

create or replace function public.rpc_game_upsert(p_user_id uuid, p_perfil_id uuid, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_data is null then
    raise exception 'p_data requerido';
  end if;
  insert into public.game_state (user_id, perfil_id, data, updated_at)
  values (p_user_id, p_perfil_id, p_data, now())
  on conflict (user_id, perfil_id) do update set data = excluded.data, updated_at = now();
  return true;
end;
$function$;

create or replace function public.rpc_habitos_list(p_user_id uuid, p_perfil_id uuid)
returns table(id text, data jsonb, updated_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query
    select h.id, h.data, h.updated_at
    from public.habits h
    where h.user_id = p_user_id and h.perfil_id = p_perfil_id
    order by h.id;
end;
$function$;

create or replace function public.rpc_habitos_upsert(p_user_id uuid, p_perfil_id uuid, p_id text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_id is null or p_id = '' then
    raise exception 'p_id requerido';
  end if;
  -- D1: el id es PK global — jamás pisar el hábito de otro usuario.
  select h.user_id into v_owner from public.habits h where h.id = p_id;
  if found and v_owner <> p_user_id then
    raise exception 'habit id pertenece a otro usuario';
  end if;
  insert into public.habits (id, user_id, perfil_id, data, updated_at)
  values (p_id, p_user_id, p_perfil_id, coalesce(p_data, '{}'::jsonb), now())
  on conflict (id) do update
    set user_id = excluded.user_id,
        perfil_id = excluded.perfil_id,
        data = excluded.data,
        updated_at = now();
end;
$function$;

create or replace function public.rpc_habitos_delete(p_user_id uuid, p_perfil_id uuid, p_habit_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  delete from public.completions
   where habit_id = p_habit_id and user_id = p_user_id and perfil_id = p_perfil_id;
  delete from public.habits
   where id = p_habit_id and user_id = p_user_id and perfil_id = p_perfil_id;
  insert into public.deleted_habits (user_id, perfil_id, habit_id, deleted_at)
  values (p_user_id, p_perfil_id, p_habit_id, now())
  on conflict (user_id, perfil_id, habit_id) do update
    set deleted_at = now();
end;
$function$;

create or replace function public.rpc_habitos_complete(
  p_user_id uuid, p_perfil_id uuid, p_event_id text, p_habit_id text,
  p_moment_id text, p_fecha date, p_subtareas text[] default '{}'::text[]
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_perfil uuid;
  v_inserted boolean := false;
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_event_id is null or p_event_id = '' then
    raise exception 'p_event_id requerido';
  end if;
  select h.user_id, h.perfil_id into v_owner, v_perfil from public.habits h where h.id = p_habit_id;
  if not found then
    raise exception 'habito no existe: %', p_habit_id;
  end if;
  if v_owner <> p_user_id or v_perfil is distinct from p_perfil_id then
    raise exception 'habito de otro usuario o perfil';
  end if;
  insert into public.completions
    (event_id, user_id, perfil_id, habit_id, moment_id, fecha, subtareas_completadas)
  values
    (p_event_id, p_user_id, p_perfil_id, p_habit_id, p_moment_id, p_fecha, coalesce(p_subtareas, '{}'))
  on conflict (event_id) do nothing
  returning true into v_inserted;
  return coalesce(v_inserted, false);
end;
$function$;

create or replace function public.rpc_habitos_completions(p_user_id uuid, p_perfil_id uuid, p_fecha date)
returns table(event_id text, habit_id text, moment_id text, fecha date, created_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query
    select c.event_id, c.habit_id, c.moment_id, c.fecha, c.created_at
    from public.completions c
    where c.user_id = p_user_id and c.perfil_id = p_perfil_id and c.fecha = p_fecha
    order by c.created_at desc;
end;
$function$;

create or replace function public.rpc_habitos_historial(p_user_id uuid, p_perfil_id uuid, p_desde date)
returns table(event_id text, habit_id text, moment_id text, fecha date, created_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query
    select c.event_id, c.habit_id, c.moment_id, c.fecha, c.created_at
    from public.completions c
    where c.user_id = p_user_id and c.perfil_id = p_perfil_id and c.fecha >= p_desde
    order by c.fecha asc, c.created_at asc;
end;
$function$;
