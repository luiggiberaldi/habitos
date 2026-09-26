-- Migración 0006 — timezone por suscripción push + policy de update propio.
--
-- P1.8: el scheduler calcula fechas/recordatorios en la zona horaria real del
-- usuario. El cliente la escribe en guardarSuscripcion() (lib/notifications.ts).
-- P1.9-fix: el upsert de guardarSuscripcion usa onConflict:"endpoint", que
-- ejecuta UPDATE cuando la fila ya existe; sin policy de update la RLS lo
-- rechazaría. Se añade push_subscriptions_update_own.

alter table public.push_subscriptions
  add column if not exists timezone text;

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
  on public.push_subscriptions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
