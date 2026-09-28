-- 0025_fin_recordatorios_push.sql — soporte de avisos push para recordatorios de pago.
-- ultimo_aviso: último día (America/Caracas) en que se notificó; evita reenvíos.
alter table public.fin_recordatorios
  add column if not exists ultimo_aviso date;
