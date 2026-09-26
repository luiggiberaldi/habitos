-- Fase C: programar push-notifications cada minuto (pg_cron).
-- Correr en el SQL Editor del dashboard de Supabase (proyecto diqjwidceauuhppbxtwm).
--
-- PASO 0 (en tu terminal, no aquí): genera el secreto y guárdalo.
--   openssl rand -hex 32
-- Ese MISMO valor va:
--   1) abajo, donde dice <PEGA_AQUI_TU_CRON_SECRET>
--   2) en el deploy:  export CRON_SECRET="<mismo valor>"  (ver scripts/deploy-push.sh)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Si ya existía una programación vieja con otro nombre, bórrala primero:
-- select cron.unschedule('push-notifications-cada-minuto');

select cron.schedule(
  'push-notifications-cada-minuto',
  '* * * * *',  -- cada minuto
  $$
  select net.http_post(
    url := 'https://diqjwidceauuhppbxtwm.supabase.co/functions/v1/push-notifications',
    headers := jsonb_build_object(
      'x-cron-secret', '<PEGA_AQUI_TU_CRON_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verificación: debe salir 1 fila con status OK en el próximo minuto.
--   select jobid, jobname, status from cron.job_run_details order by start_time desc limit 5;
-- Para pausar:  select cron.unschedule('push-notifications-cada-minuto');
