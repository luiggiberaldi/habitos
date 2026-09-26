-- Migración 0007 — tombstones de hábitos borrados (P2.6).
--
-- Problema: si el hábito se borra en el dispositivo B, el rehydrate del
-- dispositivo A lo re-agregaba desde su copia local (los deletes solo viajaban
-- por la cola del dispositivo que los originó).
-- Solución: al borrar se escribe un tombstone; rehidratar excluye los hábitos
-- con tombstone del remoto Y los purga del estado local.

create table if not exists public.deleted_habits (
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, habit_id)
);

create index if not exists deleted_habits_user_id_idx
  on public.deleted_habits (user_id);

alter table public.deleted_habits enable row level security;

drop policy if exists deleted_habits_all_own on public.deleted_habits;
create policy deleted_habits_all_own
  on public.deleted_habits
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
