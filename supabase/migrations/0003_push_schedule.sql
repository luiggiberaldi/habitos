-- Migración 0003 — job programado cada minuto que invoca a la Edge Function
-- push-notifications (cálculo de recordatorios debidos + envío web push).
--
-- P1.2 (seguridad): esta migración NO contiene secretos. El secreto compartido
-- CRON_SECRET y el resto de credenciales se configuran en el Dashboard de
-- Supabase, nunca en SQL ni en Git.
--
-- Procedimiento recomendado (Dashboard → Database → Cron → Create job):
--   1. Habilita las extensiones pg_cron y pg_net (Database → Extensions).
--   2. Guarda CRON_SECRET como secreto del proyecto
--      (Project Settings → Edge Functions → Secrets). La función lo lee con
--      Deno.env.get("CRON_SECRET") y rechaza (401) toda invocación sin el
--      header x-cron-secret correcto; sin secreto configurado no ejecuta nada.
--   3. Crea el job con el SQL de abajo, tomando el secreto desde Vault:
--
--      select cron.schedule(
--        'push-notifications-minuto',
--        '* * * * *',
--        $$select net.http_post(
--             url := 'https://<PROJECT_REF>.supabase.co/functions/v1/push-notifications',
--             headers := jsonb_build_object(
--               'Content-Type', 'application/json',
--               'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
--             ),
--             body := '{}'
--           ) as request_id$$);
--
--      (Reemplaza <PROJECT_REF> por la referencia de tu proyecto.)
--   4. Verifica en Database → Cron → job run history que el job corre cada
--      minuto y que la función responde 200.
--
-- NOTA: la función solo acepta el header x-cron-secret (no Authorization) y
-- opera en modo fail-closed: sin CRON_SECRET configurado responde 401 siempre.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- El job se crea desde el Dashboard con el procedimiento de arriba.
-- Este archivo deja constancia del schedule esperado; no programa nada solo.
