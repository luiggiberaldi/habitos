-- 0014: endurecer el modelo de perfiles (aplicada 2026-09-27 con autorización de luigi)
--
-- Corrige tres deudas que dejó 0013:
--   1. Sobrecargas viejas de los RPC conversacionales: 0013 añadió versiones con
--      p_perfil_id pero las firmas anteriores (sin perfil) siguen vivas. Cualquiera
--      que llame sin p_perfil_id lee/escribe TODOS los perfiles de la cuenta.
--      Se eliminan las firmas viejas.
--   2. rpc_perfil_reciente(p_user_id): el puente de WhatsApp necesita saber a qué
--      perfil escribir cuando no se le pasa --perfil-id. Devuelve el perfil usado
--      más recientemente (ultimo_uso, luego creado_en).
--   3. FK de perfil_id → perfiles(id): evita filas huérfanas. (Las tablas de datos
--      usan ON DELETE CASCADE para que borrar un perfil limpie sus datos.)

-- 0. Normalizar filas legado con uuid cero.
--    Tablas con perfil_id nullable -> NULL (la adopción las reclama después).
--    Tablas con perfil_id NOT NULL (game_state, deleted_habits, liga_miembros):
--    se inserta un perfil puente con id cero por cada cuenta afectada; la
--    adopción (adoptarDatosLegado) lo reclama al crear el primer perfil y la
--    app filtra ese id para no mostrarlo nunca.
do $$
declare
  t text;
  r record;
begin
  foreach t in array array['habits','completions','push_subscriptions','activity_log'] loop
    execute format('update public.%I set perfil_id = null where perfil_id = %L::uuid', t, '00000000-0000-0000-0000-000000000000');
  end loop;
  foreach t in array array['game_state','deleted_habits','liga_miembros'] loop
    for r in execute format('select distinct user_id from public.%I where perfil_id = %L::uuid', t, '00000000-0000-0000-0000-000000000000') loop
      insert into public.perfiles (id, user_id, nombre, color, creado_en, ultimo_uso)
      values ('00000000-0000-0000-0000-000000000000'::uuid, r.user_id, 'Legado', '#F84818', now(), now())
      on conflict (id) do nothing;
    end loop;
  end loop;
end $$;

-- 1. Borrar las firmas viejas (sin p_perfil_id) -------------------------------
drop function if exists public.rpc_game_get(uuid);
drop function if exists public.rpc_game_upsert(uuid, jsonb);
drop function if exists public.rpc_habitos_list(uuid);
drop function if exists public.rpc_habitos_historial(uuid, date);
drop function if exists public.rpc_habitos_upsert(uuid, text, jsonb);
drop function if exists public.rpc_habitos_delete(uuid, text);
drop function if exists public.rpc_habitos_completions(uuid, date);
drop function if exists public.rpc_habitos_complete(uuid, text, text, text, date, text[]);
drop function if exists public.unirse_a_liga(text, text);

-- 2. Perfil usado más recientemente --------------------------------------------
create or replace function public.rpc_perfil_reciente(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select p.id into v_id
  from public.perfiles p
  where p.user_id = p_user_id
  order by p.ultimo_uso desc nulls last, p.creado_en desc
  limit 1;
  return v_id;
end;
$function$;

revoke all on function public.rpc_perfil_reciente(uuid) from public;
grant execute on function public.rpc_perfil_reciente(uuid) to anon, authenticated;

-- 3. FK hacia perfiles ----------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'habits_perfil_id_fkey') then
    alter table public.habits
      add constraint habits_perfil_id_fkey
      foreign key (perfil_id) references public.perfiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'completions_perfil_id_fkey') then
    alter table public.completions
      add constraint completions_perfil_id_fkey
      foreign key (perfil_id) references public.perfiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_state_perfil_id_fkey') then
    alter table public.game_state
      add constraint game_state_perfil_id_fkey
      foreign key (perfil_id) references public.perfiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_perfil_id_fkey') then
    alter table public.push_subscriptions
      add constraint push_subscriptions_perfil_id_fkey
      foreign key (perfil_id) references public.perfiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activity_log_perfil_id_fkey') then
    alter table public.activity_log
      add constraint activity_log_perfil_id_fkey
      foreign key (perfil_id) references public.perfiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deleted_habits_perfil_id_fkey') then
    alter table public.deleted_habits
      add constraint deleted_habits_perfil_id_fkey
      foreign key (perfil_id) references public.perfiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'liga_miembros_perfil_id_fkey') then
    alter table public.liga_miembros
      add constraint liga_miembros_perfil_id_fkey
      foreign key (perfil_id) references public.perfiles(id) on delete cascade;
  end if;
end $$;
