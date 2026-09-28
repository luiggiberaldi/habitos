-- 0020_euro.sql — Tasa euro oficial (BCV) en fin_tasas.
--
-- La tarjeta "Tasas del día" muestra BCV ($), Euro (BCV) y USDT; el paralelo
-- sale de la tarjeta pero SE SIGUE guardando: Finanzas lo usa para convertir
-- VES→USD (fin_tasa_usd_para en la 0019).
alter table public.fin_tasas
  add column if not exists euro numeric(18, 2);
