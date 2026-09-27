-- 0011_liga_rls_recursion.sql — Rompe la recursión infinita de la policy
-- "miembros_select" en liga_miembros (error 42P17 → HTTP 500 en PostgREST).
--
-- La policy anterior hacía `exists (select 1 from liga_miembros ...)` dentro
-- de una policy SOBRE liga_miembros: cada evaluación re-disparaba la policy
-- hasta que Postgres abortaba por recursión infinita.
--
-- Fix estándar de Supabase: la comprobación de membresía vive en una función
-- SECURITY DEFINER (corre como el dueño, sin RLS), y la policy solo la llama.

create or replace function public.es_miembro_de_liga(p_liga_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.liga_miembros
    where liga_id = p_liga_id
      and user_id = auth.uid()
  );
$$;

grant execute on function public.es_miembro_de_liga(uuid) to authenticated;

drop policy if exists "miembros_select" on public.liga_miembros;
create policy "miembros_select" on public.liga_miembros
  for select
  using (public.es_miembro_de_liga(liga_id));
