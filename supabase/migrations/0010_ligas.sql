-- 0010_ligas.sql — Liga semanal opt-in: grupos pequeños con ranking por XP.
--
-- Diseño:
-- - `ligas`: el grupo (nombre + código de 6 caracteres para invitar).
-- - `liga_miembros`: un registro por (liga, usuario) con su XP semanal.
-- - El ranking se reinicia cada lunes: la app publica xp_semanal junto con la
--   semana (lunes YYYY-MM-DD) y al leer trata como 0 los datos de semanas viejas.
-- - Unirse es vía RPC `unirse_a_liga` (security definer) para no exponer el
--   catálogo de ligas a todos los usuarios autenticados.

create table if not exists public.ligas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo text not null unique,
  creada_por uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.liga_miembros (
  liga_id uuid not null references public.ligas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre_visible text not null default 'Jugador',
  xp_semanal integer not null default 0,
  semana text not null default '',
  updated_at timestamptz not null default now(),
  primary key (liga_id, user_id)
);

alter table public.ligas enable row level security;
alter table public.liga_miembros enable row level security;

-- ligas: solo miembros (o el creador) pueden verlas; cualquiera autenticado
-- puede crear una (quedando como creada_por).
drop policy if exists "ligas_miembros_select" on public.ligas;
create policy "ligas_miembros_select" on public.ligas
  for select
  using (
    auth.uid() = creada_por
    or exists (
      select 1 from public.liga_miembros m
      where m.liga_id = ligas.id and m.user_id = auth.uid()
    )
  );

drop policy if exists "ligas_crear" on public.ligas;
create policy "ligas_crear" on public.ligas
  for insert
  with check (auth.uid() = creada_por);

-- liga_miembros: los miembros de una liga se ven entre sí; cada uno escribe
-- solo su propia fila (el alta inicial la hace el creador; las uniones por
-- código pasan por el RPC de abajo).
drop policy if exists "miembros_select" on public.liga_miembros;
create policy "miembros_select" on public.liga_miembros
  for select
  using (
    exists (
      select 1 from public.liga_miembros m
      where m.liga_id = liga_miembros.liga_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "miembros_insert" on public.liga_miembros;
create policy "miembros_insert" on public.liga_miembros
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "miembros_update" on public.liga_miembros;
create policy "miembros_update" on public.liga_miembros
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "miembros_delete" on public.liga_miembros;
create policy "miembros_delete" on public.liga_miembros
  for delete
  using (auth.uid() = user_id);

-- Unirse con código sin exponer el catálogo de ligas.
create or replace function public.unirse_a_liga(p_codigo text, p_nombre text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liga uuid;
  v_nombre text;
begin
  select id into v_liga from public.ligas where codigo = upper(p_codigo);
  if v_liga is null then
    raise exception 'codigo_invalido';
  end if;
  v_nombre := coalesce(nullif(trim(p_nombre), ''), 'Jugador');
  insert into public.liga_miembros (liga_id, user_id, nombre_visible)
  values (v_liga, auth.uid(), v_nombre)
  on conflict (liga_id, user_id)
  do update set nombre_visible = excluded.nombre_visible;
  return v_liga;
end
$$;

grant execute on function public.unirse_a_liga(text, text) to authenticated;
