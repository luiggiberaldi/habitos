-- Migración 0008 — RPC conversacional (Fase B).
--
-- Problema: el canal conversacional (Muse) solo puede actuar como rol `anon`
-- contra PostgREST (el sustituto del conector solo se reemplaza en el header
-- declarado `apikey`; sin JWT en `Authorization` no hay forma de asumir otro
-- rol). Con RLS estricto, `anon` no puede leer ni escribir datos de usuario.
--
-- Solución: funciones SECURITY DEFINER (corren como postgres, bypasean RLS)
-- protegidas por un secreto compartido que viaja en el header
-- `x-habitos-rpc-secret` y se valida en cada llamada. El secreto se guarda en
-- la bóveda segura de Muse (credential `custom.supabase-habitos-rpc`, placement
-- `custom_header:x-habitos-rpc-secret`): nunca aparece en texto plano ni en el
-- repo. Se invoca vía POST /rest/v1/rpc/<nombre> con los headers `apikey` +
-- `x-habitos-rpc-secret` — compatible con el conector actual.
--
-- ═══ PASO PREVIO OBLIGATORIO (una vez, en el SQL Editor del dashboard) ═══
--   ALTER DATABASE postgres SET app.habitos_rpc_secret = '<SECRETO_LARGO_ALEATORIO>';
-- El secreto lo genera el dueño (p. ej. `openssl rand -hex 32`) y NO va en este
-- archivo ni en el repo. Sin él (o con valor incorrecto), todas las funciones
-- fallan con 'unauthorized'.
-- ═══════════════════════════════════════════════════════════════════════
--
-- Defensa en profundidad:
--  - p_user_id se valida contra el FK a auth.users (un UUID inexistente da 23503).
--  - Ninguna función toca filas de otro usuario: se verifica el dueño antes de
--    escribir y todos los writes filtran por user_id.
--  - search_path fijo en public (anti search_path hijack).

-- ── Validador del secreto (interno) ─────────────────────────────────────────
-- Lee el header que PostgREST expone en request.headers (claves en minúsculas).
create or replace function public.rpc_habitos_secret_ok()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_secret text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return false;
  end;
  if v_headers is null then
    return false;
  end if;
  v_secret := v_headers ->> 'x-habitos-rpc-secret';
  if v_secret is null or v_secret = '' then
    return false;
  end if;
  return v_secret = current_setting('app.habitos_rpc_secret', true);
end;
$$;

revoke all on function public.rpc_habitos_secret_ok() from public;
grant execute on function public.rpc_habitos_secret_ok() to anon, authenticated;

-- ── Listar hábitos del usuario (lectura conversacional) ──────────────────────
create or replace function public.rpc_habitos_list(p_user_id uuid)
returns table (id text, data jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query
    select h.id, h.data, h.updated_at
    from public.habits h
    where h.user_id = p_user_id
    order by h.id;
end;
$$;

revoke all on function public.rpc_habitos_list(uuid) from public;
grant execute on function public.rpc_habitos_list(uuid) to anon, authenticated;

-- ── Completions de un día (lectura conversacional) ───────────────────────────
create or replace function public.rpc_habitos_completions(p_user_id uuid, p_fecha date)
returns table (event_id text, habit_id text, moment_id text, fecha date, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return query
    select c.event_id, c.habit_id, c.moment_id, c.fecha, c.created_at
    from public.completions c
    where c.user_id = p_user_id and c.fecha = p_fecha
    order by c.created_at desc;
end;
$$;

revoke all on function public.rpc_habitos_completions(uuid, date) from public;
grant execute on function public.rpc_habitos_completions(uuid, date) to anon, authenticated;

-- ── Upsert de hábito ─────────────────────────────────────────────────────────
create or replace function public.rpc_habitos_upsert(p_user_id uuid, p_id text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  insert into public.habits (id, user_id, data, updated_at)
  values (p_id, p_user_id, coalesce(p_data, '{}'::jsonb), now())
  on conflict (id) do update
    set user_id = excluded.user_id,
        data = excluded.data,
        updated_at = now();
end;
$$;

revoke all on function public.rpc_habitos_upsert(uuid, text, jsonb) from public;
grant execute on function public.rpc_habitos_upsert(uuid, text, jsonb) to anon, authenticated;

-- ── Registrar completion (idempotente) ───────────────────────────────────────
-- Devuelve true si insertó, false si el evento ya existía.
-- p_event_id lo genera el caller UNA vez (formato lib/event-id.ts):
--   momento:  <habitId>|<momentId>|<fecha>
--   cantidad: <habitId>|cantidad|<fecha>|<epoch>-<rand>
create or replace function public.rpc_habitos_complete(
  p_user_id uuid,
  p_event_id text,
  p_habit_id text,
  p_moment_id text,
  p_fecha date,
  p_subtareas text[] default '{}'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_inserted boolean := false;
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_event_id is null or p_event_id = '' then
    raise exception 'p_event_id requerido';
  end if;
  select h.user_id into v_owner from public.habits h where h.id = p_habit_id;
  if not found then
    raise exception 'habito no existe: %', p_habit_id;
  end if;
  if v_owner <> p_user_id then
    raise exception 'habito de otro usuario';
  end if;
  insert into public.completions
    (event_id, user_id, habit_id, moment_id, fecha, subtareas_completadas)
  values
    (p_event_id, p_user_id, p_habit_id, p_moment_id, p_fecha, coalesce(p_subtareas, '{}'))
  on conflict (event_id) do nothing
  returning true into v_inserted;
  return coalesce(v_inserted, false);
end;
$$;

revoke all on function public.rpc_habitos_complete(uuid, text, text, text, date, text[]) from public;
grant execute on function public.rpc_habitos_complete(uuid, text, text, text, date, text[]) to anon, authenticated;

-- ── Borrar hábito (cascada + tombstone) ──────────────────────────────────────
-- Espejo del borrado de la app (D2 + P2.6) para el canal conversacional.
create or replace function public.rpc_habitos_delete(p_user_id uuid, p_habit_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  delete from public.completions
   where habit_id = p_habit_id and user_id = p_user_id;
  delete from public.habits
   where id = p_habit_id and user_id = p_user_id;
  insert into public.deleted_habits (user_id, habit_id, deleted_at)
  values (p_user_id, p_habit_id, now())
  on conflict (user_id, habit_id) do update
    set deleted_at = now();
end;
$$;

revoke all on function public.rpc_habitos_delete(uuid, text) from public;
grant execute on function public.rpc_habitos_delete(uuid, text) to anon, authenticated;
