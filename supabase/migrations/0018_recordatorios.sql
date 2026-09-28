-- 0018_recordatorios.sql — Motor de recordatorios genérico (Fase 0.5).
--
-- `recordatorios`: el motor genérico que la Edge Function push-notifications
-- lee cada minuto. Los recordatorios de hábitos NO viven aquí (se calculan
-- al vuelo desde los momentos; ver el adaptador en la función): esta tabla
-- es para recordatorios explícitos de cualquier módulo (finanzas, mercado,
-- sistema). `regla_recurrencia`: 'diaria' | 'semanal' | 'mensual' (la función
-- reprograma) o null (una sola vez).

create table if not exists public.recordatorios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hogar_id uuid references public.hogares(id) on delete cascade,
  modulo text not null,
  titulo text not null,
  cuerpo text not null default '',
  programado_para timestamptz not null,
  regla_recurrencia text,
  datos_json jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviado', 'cancelado')),
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  enviado_en timestamptz
);

create index if not exists recordatorios_pendientes_idx
  on public.recordatorios (estado, programado_para)
  where estado = 'pendiente';
create index if not exists recordatorios_user_id_idx
  on public.recordatorios (user_id);

alter table public.recordatorios enable row level security;

drop policy if exists "recordatorios_dueno_todo" on public.recordatorios;
create policy "recordatorios_dueno_todo" on public.recordatorios
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
