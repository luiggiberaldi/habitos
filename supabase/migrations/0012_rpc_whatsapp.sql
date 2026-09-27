-- 0012_rpc_whatsapp.sql — Extensión del RPC conversacional para el puente WhatsApp.
--
-- El puente (scripts/whatsapp-registrar.mjs) corre el registrarConJuego REAL
-- de la app en Node, así que necesita:
--   rpc_habitos_historial(p_user_id, p_desde) → completions desde una fecha
--     (la historia completa alimenta rachaActual y los logros con exactitud).
--   rpc_game_get(p_user_id) → data jsonb del game_state (null si no existe;
--     el puente usa juegoInicial() en ese caso).
--   rpc_game_upsert(p_user_id, p_data) → guarda el game_state recalculado.
--     Last-write-wins a nivel de fila; el merge fino por máximos/unión lo
--     sigue haciendo el cliente al rehidratar.
--
-- Además reemplaza el mecanismo del secreto de la 0008: en vez de
-- `ALTER DATABASE ... SET app.habitos_rpc_secret` (requiere superusuario y no
-- se puede aplicar vía Management API), el secreto vive en la tabla
-- habitos_rpc_secrets y rpc_habitos_secret_ok() lo lee de ahí. Sin grants de
-- lectura para nadie: solo las funciones SECURITY DEFINER la consultan.
--
-- El valor real del secreto NO va en este archivo: se inserta aparte
-- (una vez) con:
--   insert into public.habitos_rpc_secrets (name, value)
--   values ('rpc-secret', '<secreto-64-hex>')
--   on conflict (name) do update set value = excluded.value;

-- ── Tabla del secreto ───────────────────────────────────────────────────────
create table if not exists public.habitos_rpc_secrets (
  name text primary key,
  value text not null
);

alter table public.habitos_rpc_secrets enable row level security;
-- Sin policies: denegar todo acceso directo.
revoke all on public.habitos_rpc_secrets from public;

-- ── Validador del secreto v2 (lee la tabla, no current_setting) ─────────────
create or replace function public.rpc_habitos_secret_ok()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_secret text;
  v_esperado text;
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
  select s.value into v_esperado
  from public.habitos_rpc_secrets s
  where s.name = 'rpc-secret';
  if v_esperado is null then
    return false;
  end if;
  return v_secret = v_esperado;
end;
$$;

revoke all on function public.rpc_habitos_secret_ok() from public;
grant execute on function public.rpc_habitos_secret_ok() to anon, authenticated;

-- ── Historial de completions ────────────────────────────────────────────────
create or replace function public.rpc_habitos_historial(p_user_id uuid, p_desde date)
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
    where c.user_id = p_user_id and c.fecha >= p_desde
    order by c.fecha asc, c.created_at asc;
end;
$$;

revoke all on function public.rpc_habitos_historial(uuid, date) from public;
grant execute on function public.rpc_habitos_historial(uuid, date) to anon, authenticated;

-- ── Leer game_state ─────────────────────────────────────────────────────────
create or replace function public.rpc_game_get(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select g.data into v_data from public.game_state g where g.user_id = p_user_id;
  return v_data;
end;
$$;

revoke all on function public.rpc_game_get(uuid) from public;
grant execute on function public.rpc_game_get(uuid) to anon, authenticated;

-- ── Guardar game_state ──────────────────────────────────────────────────────
create or replace function public.rpc_game_upsert(p_user_id uuid, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_data is null then
    raise exception 'p_data requerido';
  end if;
  insert into public.game_state (user_id, data, updated_at)
  values (p_user_id, p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
  return true;
end;
$$;

revoke all on function public.rpc_game_upsert(uuid, jsonb) from public;
grant execute on function public.rpc_game_upsert(uuid, jsonb) to anon, authenticated;
