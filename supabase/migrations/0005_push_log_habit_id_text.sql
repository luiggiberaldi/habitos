-- Migración 0005 — push_log.habit_id: uuid → text.
--
-- La migración 0002 declaró habit_id como uuid, pero los ids de hábitos son text
-- desde la 0004 (p. ej. "demo-agua"). Cada insert de dedupe de la Edge Function
-- push-notifications fallaba con "invalid input syntax for type uuid", el dedupe
-- por minuto nunca registraba y el cron reenviaba el mismo push cada minuto.
-- No hay FK sobre esta columna, el ALTER es directo.
-- No aplicar sin autorización explícita (ver docs/plan-maestro-fix.md §6).

alter table public.push_log
  alter column habit_id type text;
