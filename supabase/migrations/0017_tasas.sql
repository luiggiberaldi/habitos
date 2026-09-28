-- 0017_tasas.sql — Servicio de tasas (Fase 0.4).
--
-- `fin_tasas`: una fila por fecha (America/Caracas) con BCV, paralelo, USDT
-- y la fuente que los produjo. La escribe la Edge Function `actualizar-tasas`
-- (service_role); la lectura es pública (son datos de referencia, sin
-- privacidad). El job horario de pg_cron la mantiene fresca; la app la lee
-- vía GET /api/tasas y refresca si está desactualizada (fallback en cadena:
-- fresca → última guardada → manual).

create table if not exists public.fin_tasas (
  fecha date primary key,
  bcv numeric,
  paralelo numeric,
  usdt numeric,
  fuente text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fin_tasas enable row level security;

drop policy if exists "fin_tasas_lectura_publica" on public.fin_tasas;
create policy "fin_tasas_lectura_publica" on public.fin_tasas
  for select
  using (true);

-- Sin policies de escritura: solo la Edge Function (service_role) escribe.
