-- 0039_mejoras_finanzas.sql — Plan de mejoras Senda 2026-10-01 (mejora 4: alerta de saldo bajo).
-- Añade umbral_bajo por cuenta + RPCs para fijarlo y consultar cuentas bajo el umbral.

alter table public.fin_cuentas
  add column if not exists umbral_bajo numeric(18, 2);

-- Fijar o limpiar el umbral de una cuenta (p_umbral null lo limpia).
-- p_cuenta: fragmento del nombre (insensible a mayúsculas).
create or replace function public.rpc_fin_cuenta_umbral(
  p_user_id uuid,
  p_cuenta text,
  p_umbral numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_nombre text;
  v_moneda text;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  if p_cuenta is null or char_length(trim(p_cuenta)) = 0 then
    raise exception 'cuenta_requerida';
  end if;
  if p_umbral is not null and p_umbral < 0 then
    raise exception 'umbral_invalido';
  end if;
  select c.id, c.nombre, c.moneda into v_id, v_nombre, v_moneda
  from public.fin_cuentas c
  where not c.archivada
    and c.nombre ilike '%' || trim(p_cuenta) || '%'
    and (
      c.user_id = p_user_id
      or (
        c.hogar_id is not null
        and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id
        )
      )
    )
  order by c.creado_en
  limit 1;
  if v_id is null then
    raise exception 'cuenta_no_encontrada';
  end if;
  update public.fin_cuentas set umbral_bajo = p_umbral where id = v_id;
  return jsonb_build_object('ok', true, 'cuenta', v_nombre, 'moneda', v_moneda, 'umbral_bajo', p_umbral);
end;
$$;

-- Cuentas cuyo saldo en moneda está bajo su umbral.
create or replace function public.rpc_fin_alertas_saldo(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  return (
    select coalesce(jsonb_agg(row_to_json(t) order by t.nombre), '[]'::jsonb)
    from (
      select c.nombre, c.moneda, s.saldo_moneda, s.saldo_usd, c.umbral_bajo
      from public.fin_cuentas c
      join public.fin_saldos s on s.cuenta_id = c.id
      where not c.archivada
        and c.umbral_bajo is not null
        and s.saldo_moneda < c.umbral_bajo
        and (
          c.user_id = p_user_id
          or (
            c.hogar_id is not null
            and exists (
              select 1 from public.hogar_miembros hm
              where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id
            )
          )
        )
    ) t
  );
end;
$$;
