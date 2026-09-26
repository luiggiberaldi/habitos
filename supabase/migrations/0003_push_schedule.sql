-- Migración Fase 4 — job programado cada minuto que llama a la Edge Function
-- push-notifications (cálculo de recordatorios debidos + envío).
-- Requiere la extensión pg_cron y pg_net (ambas habilitadas por defecto en Supabase).
--
-- IMPORTANTE: reemplaza <PROJECT_REF>, <SERVICE_ROLE_KEY> y <CRON_SECRET> por los
-- valores reales antes de aplicar, o configura el job en el Dashboard (Database → Cron)
-- usando cron.http_post con la misma cabecera x-cron-secret.
-- La Edge Function valida la cabecera x-cron-secret (o Authorization) contra CRON_SECRET.

create extension if not exists pg_cron;

select cron.schedule(
  'push-notifications-minuto',   -- nombre del job
  '* * * * *',                -- cada minuto
  $$select
      net.http_post(
        url := 'https://<PROJECT_REF>.supabase.co/functions/v1/push-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', '<CRON_SECRET>',
          'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'
      ) as request_id
  $$
);
