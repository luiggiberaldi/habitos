-- 0027_coach_alertas.sql — Dedupe de alertas inteligentes del coach (Fase 4).
--
-- La Edge Function `coach-alertas` corre el briefing por usuario y envía
-- web push solo por correlaciones nuevas: una fila por
-- (user_id, correlacion_id, ventana_desde). La misma señal no se repite
-- dentro de su ventana semanal.

create table if not exists public.coach_alertas_enviadas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  correlacion_id text not null,
  ventana_desde date not null,
  titulo text not null,
  enviado_en timestamptz not null default now(),
  unique (user_id, correlacion_id, ventana_desde)
);

create index if not exists coach_alertas_user_idx
  on public.coach_alertas_enviadas (user_id, enviado_en desc);

comment on table public.coach_alertas_enviadas is
  'Fase 4: dedupe de alertas del coach — una correlación se avisa una vez por ventana.';
