-- 0021_finanzas_alcance.sql — Fase 1: los RPC conversacionales ven las cuentas
-- compartidas del hogar, no solo las propias.
--
-- Problema (auditoría 2026-09-28): los 4 RPC de la 0019 filtraban
-- `user_id = p_user_id`. Una cuenta compartida creada por luigi
-- (user_id = él) era invisible para el WhatsApp de su novia aunque ambos
-- sean miembros del mismo hogar.
--
-- Fix: el alcance es "mis cuentas + cuentas de hogares donde soy miembro".
-- OJO: no se puede usar es_miembro_de_hogar() (usa auth.uid(), que es NULL
-- en el contexto del secreto por header, sin JWT); se consulta
-- hogar_miembros directamente. Las funciones son SECURITY DEFINER, así que
-- el RLS de hogar_miembros no las frena.

-- ── RPC: registrar movimiento (reemplaza 0019 con alcance de hogar) ──────────
create or replace function public.rpc_fin_registrar(
  p_user_id uuid,
  p_tipo text,
  p_monto numeric,
  p_cuenta text default null,
  p_categoria text default null,
  p_fecha date default null,
  p_nota text default null,
  p_clave_evento text default null,
  p_cuenta_destino text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta public.fin_cuentas%rowtype;
  v_dest public.fin_cuentas%rowtype;
  v_tasa numeric;
  v_tasa_dest numeric;
  v_monto_dest numeric;
  v_existente uuid;
  v_mov_id uuid;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;

  if p_tipo not in ('ingreso', 'egreso', 'transferencia') then
    raise exception 'tipo_invalido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto_invalido';
  end if;

  -- Idempotencia: si la clave ya existe, devolver el movimiento.
  if p_clave_evento is not null then
    select id into v_existente
    from public.fin_movimientos where clave_evento = p_clave_evento;
    if v_existente is not null then
      return jsonb_build_object('ok', true, 'id', v_existente, 'duplicado', true);
    end if;
  end if;

  -- Resolver cuenta origen: propia primero, luego compartidas del hogar.
  if p_cuenta is not null then
    select * into v_cuenta from public.fin_cuentas c
    where not c.archivada
      and (c.id::text = p_cuenta or lower(c.nombre) = lower(p_cuenta))
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
    order by (c.user_id = p_user_id) desc, c.creado_en limit 1;
    if v_cuenta.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
  else
    select * into v_cuenta from public.fin_cuentas c
    where not c.archivada
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
    order by (c.user_id = p_user_id) desc, c.creado_en limit 1;
    if v_cuenta.id is null then
      -- Primera vez: crear "Efectivo" en USD automáticamente (personal).
      insert into public.fin_cuentas (user_id, nombre, moneda, tipo, creado_por)
      values (p_user_id, 'Efectivo', 'USD', 'efectivo', p_user_id)
      returning * into v_cuenta;
    end if;
  end if;

  v_tasa := public.fin_tasa_usd_para(v_cuenta.moneda, v_cuenta.tasa_usd_manual);

  if p_tipo = 'transferencia' then
    if p_cuenta_destino is null then
      raise exception 'destino_requerido';
    end if;
    select * into v_dest from public.fin_cuentas c
    where not c.archivada
      and (c.id::text = p_cuenta_destino or lower(c.nombre) = lower(p_cuenta_destino))
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
    order by (c.user_id = p_user_id) desc, c.creado_en limit 1;
    if v_dest.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
    if v_dest.id = v_cuenta.id then
      raise exception 'misma_cuenta';
    end if;
    v_tasa_dest := public.fin_tasa_usd_para(v_dest.moneda, v_dest.tasa_usd_manual);
    -- Autoconversión con los snapshots del momento.
    v_monto_dest := round(p_monto * v_tasa / v_tasa_dest, 2);
  end if;

  insert into public.fin_movimientos
    (user_id, hogar_id, cuenta_id, cuenta_destino_id, tipo, categoria,
     monto, monto_destino, tasa_usd, tasa_usd_destino,
     fecha, nota, clave_evento, creado_por)
  values
    (p_user_id, v_cuenta.hogar_id, v_cuenta.id, v_dest.id, p_tipo,
     nullif(lower(trim(coalesce(p_categoria, ''))), ''),
     p_monto, v_monto_dest, v_tasa, v_tasa_dest,
     coalesce(p_fecha, ((now() at time zone 'America/Caracas'))::date),
     nullif(trim(coalesce(p_nota, '')), ''),
     p_clave_evento, p_user_id)
  returning id into v_mov_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_mov_id,
    'tipo', p_tipo,
    'monto', p_monto,
    'moneda', v_cuenta.moneda,
    'cuenta', v_cuenta.nombre,
    'cuenta_id', v_cuenta.id,
    'destino', case when v_dest.id is not null then v_dest.nombre end,
    'monto_destino', v_monto_dest,
    'moneda_destino', case when v_dest.id is not null then v_dest.moneda end,
    'usd_equivalente', round(p_monto * v_tasa, 2),
    'categoria', nullif(lower(trim(coalesce(p_categoria, ''))), '')
  );
end;
$$;

-- ── RPC: saldos por cuenta (reemplaza 0019 con alcance de hogar) ─────────────
create or replace function public.rpc_fin_saldos(p_user_id uuid)
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
      select c.id, c.nombre, c.moneda, c.tipo,
             s.saldo_moneda, s.saldo_usd, s.n_movimientos
      from public.fin_cuentas c
      join public.fin_saldos s on s.cuenta_id = c.id
      where not c.archivada
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
    ) t
  );
end;
$$;

-- ── RPC: movimientos recientes (reemplaza 0019 con alcance de hogar) ─────────
create or replace function public.rpc_fin_recientes(
  p_user_id uuid, p_limite int default 10
)
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
    select coalesce(jsonb_agg(row_to_json(t) order by t.fecha desc, t.creado_en desc), '[]'::jsonb)
    from (
      select m.id, m.tipo, m.categoria, m.monto, m.nota, m.fecha, m.creado_en,
             c.nombre as cuenta, c.moneda,
             d.nombre as destino, m.monto_destino
      from public.fin_movimientos m
      join public.fin_cuentas c on c.id = m.cuenta_id
      left join public.fin_cuentas d on d.id = m.cuenta_destino_id
      where m.anulado_en is null
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
      order by m.fecha desc, m.creado_en desc
      limit greatest(1, least(coalesce(p_limite, 10), 50))
    ) t
  );
end;
$$;

-- ── RPC: anular movimiento (reemplaza 0019 con alcance de hogar) ──────────────
create or replace function public.rpc_fin_anular(p_user_id uuid, p_movimiento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  update public.fin_movimientos m
  set anulado_en = now()
  from public.fin_cuentas c
  where m.id = p_movimiento_id
    and c.id = m.cuenta_id
    and m.anulado_en is null
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
  returning m.id into v_id;
  if v_id is null then
    raise exception 'movimiento_no_encontrado';
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
