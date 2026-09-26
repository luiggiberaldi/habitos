-- Migración Fase 4 — job programado cada minuto que llama a la Edge Function
-- push-notifications (cálculo de recordatorios debidos + envío).
-- Requiere la extensión pg_cron y pg_net (ambas habilitadas por defecto en Supabase).
-- Ver docs/plan-notificaciones-push.md.

create extension if not exists pg_cron;

-- Invoca la Edge Function cada minuto con la clave de servicio para que el scheduler
-- pueda leer habits/completions con service role y escribir en push_log.
-- IMPORTANTE: reemplaza <PROJECT_REF> y <SERVICE_ROLE_KEY> por los valores reales,
-- o configura la URL/secret en el Dashboard (Database → Cron) usando cron.http_post.
select cron.schedule(
  'push-notifications-minuto',   -- nombre del job
  '* * * * *',                -- cada minuto
  $$select
      net.http_post(
        url := 'https://<PROJECT_REF>.supabase.co/functions/v1/push-notifications',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
        ),
        body := '{}'
      ) as request_id
  $$
);
