-- Migración Fase 0 — Tablas core: habits, completions, activity_log
-- RLS estricto por user_id. El service role (Edge Functions) bypassa RLS automáticamente.

-- ── habits ──────────────────────────────────────────────────────────────────
create table if not exists public.habits (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists habits_user_id_idx on public.habits (user_id);

-- Trigger para mantener updated_at
drop trigger if exists habits_set_updated_at on public.habits;
create trigger habits_set_updated_at
  before update on public.habits
  for each row execute function public.set_updated_at();

alter table public.habits enable row level security;

drop policy if exists habits_select_own on public.habits;
create policy habits_select_own
  on public.habits for select
  using (auth.uid() = user_id);

drop policy if exists habits_insert_own on public.habits;
create policy habits_insert_own
  on public.habits for insert
  with check (auth.uid() = user_id);

drop policy if exists habits_update_own on public.habits;
create policy habits_update_own
  on public.habits for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists habits_delete_own on public.habits;
create policy habits_delete_own
  on public.habits for delete
  using (auth.uid() = user_id);

-- ── completions ─────────────────────────────────────────────────────────────
create table if not exists public.completions (
  event_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  moment_id text,
  fecha date not null,
  subtareas_completadas text[] default '{}',
  created_at timestamptz not null default now()
);

create index if not exists completions_user_id_idx on public.completions (user_id);
create index if not exists completions_fecha_idx on public.completions (fecha);
create index if not exists completions_habit_id_idx on public.completions (habit_id);

alter table public.completions enable row level security;

drop policy if exists completions_select_own on public.completions;
create policy completions_select_own
  on public.completions for select
  using (auth.uid() = user_id);

drop policy if exists completions_insert_own on public.completions;
create policy completions_insert_own
  on public.completions for insert
  with check (auth.uid() = user_id);

drop policy if exists completions_update_own on public.completions;
create policy completions_update_own
  on public.completions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists completions_delete_own on public.completions;
create policy completions_delete_own
  on public.completions for delete
  using (auth.uid() = user_id);

-- ── activity_log ────────────────────────────────────────────────────────────
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  entity_type text,
  entity_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_user_id_idx on public.activity_log (user_id);
create index if not exists activity_log_created_at_idx on public.activity_log (created_at);

alter table public.activity_log enable row level security;

drop policy if exists activity_log_insert_own on public.activity_log;
create policy activity_log_insert_own
  on public.activity_log for insert
  with check (auth.uid() = user_id);

drop policy if exists activity_log_select_own on public.activity_log;
create policy activity_log_select_own
  on public.activity_log for select
  using (auth.uid() = user_id);

-- Nadie puede actualizar ni borrar el log de auditoría.

-- Nota: push_log ya se endureció en la migración 0002 (insert sólo con service role).
