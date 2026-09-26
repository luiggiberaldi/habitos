-- Migración Fase 5 — dedupe de envíos push y claves de suscripción en formato web-push.
-- Ver docs/plan-notificaciones-push.md.

-- push_subscriptions.key guarda las claves p256dh/auth en el objeto que web-push espera
-- ({ p256dh, auth }) para enviar la notificación.
alter table public.push_subscriptions
  add column if not exists keys jsonb;

-- Recrear los índices/trigger por si la columna usada antes era p256dh/auth plana:
-- se conservan ambas formas para compatibilidad; la Edge Function prefiere keys cuando existe.
update public.push_subscriptions
  set keys = jsonb_build_object('p256dh', p256dh, 'auth', auth)
  where keys is null and p256dh is not null and auth is not null;

-- ── push_log: registro idempotente de envíos para dedupe por minuto. ────────
create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null,
  moment_id text not null,
  event_id text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists push_log_event_id_idx
  on public.push_log (event_id);

create index if not exists push_log_created_at_idx
  on public.push_log (created_at);

-- ── Row Level Security ──────────────────────────────────────────────────────────────
-- push_log lo escribe la Edge Function (service role); el usuario no necesita leerlo.
alter table public.push_log enable row level security;

drop policy if exists push_log_service_insert on public.push_log;
create policy push_log_service_insert
  on public.push_log
  for insert
  with check (true);

drop policy if exists push_log_select_own on public.push_log;
create policy push_log_select_own
  on public.push_log
  for select
  using (auth.uid() = user_id);
