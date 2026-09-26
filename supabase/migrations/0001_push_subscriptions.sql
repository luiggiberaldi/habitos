-- Migración Fase 3 — Opción A: suscripciones web push por usuario.
-- Tabla push_subscriptions persiste las suscripciones que el scheduler push usará al enviar.
-- Ver docs/plan-notificaciones-push.md.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índice para recuperar todas las suscripciones de un usuario al disparar un push.
create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

-- Mantiene updated_at al actualizar.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────────────────────
-- El servicio (Edge Function con service role) gestiona inserts/deletes autorizados.
-- El usuario sólo puede leer su propia suscripción.
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
  on public.push_subscriptions
  for select
  using (auth.uid() = user_id);

-- El usuario sólo puede insertar/borrar sus propias suscripciones (por si la app
-- persiste directamente sin pasar por la Edge Function).
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
  on public.push_subscriptions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
  on public.push_subscriptions
  for delete
  using (auth.uid() = user_id);
