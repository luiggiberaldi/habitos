-- 0009_game_state.sql — Progreso de gamificación por usuario (un registro por usuario).
--
-- Guarda el JuegoState (XP, niveles, congeladores, logros, desafíos) como JSON.
-- El merge entre dispositivos lo hace el cliente por máximos/unión, así que
-- basta con last-write-wins a nivel de fila.

create table if not exists public.game_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.game_state enable row level security;

drop policy if exists "game_state_owner" on public.game_state;
create policy "game_state_owner" on public.game_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
