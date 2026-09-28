-- 0024_control.sql — Fase 3 Control: recordatorios, presupuestos, deudas, metas, cierre.
--
-- Tablas: fin_recordatorios, fin_presupuestos, fin_deudas, fin_metas, fin_metas_aportes.
-- Todo con alcance propio/hogar (user_id o miembro del hogar), creado_por, RLS.
-- Los montos se guardan en su moneda; las comparaciones se hacen en USD con
-- fin_tasa_usd_para (snapshot del momento, igual que finanzas/mercado).

-- ── 0. Helper de conversión ─────────────────────────────────────────────────
create or replace function public.fin_convertir(
  p_monto numeric, p_de text, p_a text,
  p_manual_de numeric default null, p_manual_a numeric default null
)
returns numeric
language plpgsql
stable
as $$
declare
  v_t_de numeric;
  v_t_a numeric;
begin
  if p_de = p_a then
    return p_monto;
  end if;
  v_t_de := public.fin_tasa_usd_para(p_de, p_manual_de);
  v_t_a := public.fin_tasa_usd_para(p_a, p_manual_a);
  return p_monto * v_t_de / v_t_a;
end;
$$;

-- Próximo vencimiento de un recordatorio (día D del mes, último día si D no existe).
create or replace function public.fin_proximo_vencimiento(p_dia int, p_ultimo_pago date)
returns date
language plpgsql
stable
as $$
declare
  v_hoy date := ((now() at time zone 'America/Caracas'))::date;
  v_cand date;
  v_dias_mes int;
begin
  v_dias_mes := extract(day from (date_trunc('month', v_hoy) + interval '1 month - 1 day'))::int;
  v_cand := (date_trunc('month', v_hoy) + (least(p_dia, v_dias_mes) - 1) * interval '1 day')::date;
  if p_ultimo_pago is not null and p_ultimo_pago >= v_cand then
    v_dias_mes := extract(day from (date_trunc('month', v_hoy + interval '1 month') + interval '1 month - 1 day'))::int;
    v_cand := (date_trunc('month', v_hoy + interval '1 month') + (least(p_dia, v_dias_mes) - 1) * interval '1 day')::date;
  end if;
  return v_cand;
end;
$$;

-- ── 1. Tablas ───────────────────────────────────────────────────────────────
create table if not exists public.fin_recordatorios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hogar_id uuid references public.hogares(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 80),
  tipo text not null default 'egreso' check (tipo in ('ingreso', 'egreso')),
  categoria text,
  monto numeric(18, 2) not null check (monto > 0),
  moneda text not null check (moneda in ('USD', 'VES', 'COP', 'USDT')),
  cuenta_id uuid references public.fin_cuentas(id) on delete set null,
  dia_mes int not null check (dia_mes between 1 and 31),
  dias_aviso int not null default 3 check (dias_aviso >= 0),
  activo boolean not null default true,
  ultimo_pago date,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);

create table if not exists public.fin_presupuestos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hogar_id uuid references public.hogares(id) on delete cascade,
  categoria text not null check (char_length(categoria) between 1 and 40),
  monto_limite numeric(18, 2) not null check (monto_limite > 0),
  moneda text not null default 'USD' check (moneda in ('USD', 'VES', 'COP', 'USDT')),
  mes date not null,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  unique (user_id, categoria, mes)
);

create table if not exists public.fin_deudas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hogar_id uuid references public.hogares(id) on delete cascade,
  tipo text not null check (tipo in ('por_cobrar', 'por_pagar')),
  contraparte text not null check (char_length(contraparte) between 1 and 80),
  monto numeric(18, 2) not null check (monto > 0),
  abonado numeric(18, 2) not null default 0 check (abonado >= 0),
  moneda text not null check (moneda in ('USD', 'VES', 'COP', 'USDT')),
  fecha_limite date,
  nota text,
  cuenta_id uuid references public.fin_cuentas(id) on delete set null,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);

create table if not exists public.fin_metas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hogar_id uuid references public.hogares(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 80),
  monto_objetivo numeric(18, 2) not null check (monto_objetivo > 0),
  moneda text not null check (moneda in ('USD', 'VES', 'COP', 'USDT')),
  fecha_objetivo date,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);

create table if not exists public.fin_metas_aportes (
  id uuid primary key default gen_random_uuid(),
  meta_id uuid not null references public.fin_metas(id) on delete cascade,
  monto numeric(18, 2) not null check (monto > 0),
  moneda text not null check (moneda in ('USD', 'VES', 'COP', 'USDT')),
  fecha date not null default ((now() at time zone 'America/Caracas'))::date,
  cuenta_id uuid references public.fin_cuentas(id) on delete set null,
  fin_movimiento_id uuid references public.fin_movimientos(id) on delete set null,
  nota text,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);

create index if not exists fin_recordatorios_user_idx on public.fin_recordatorios (user_id);
create index if not exists fin_presupuestos_user_mes_idx on public.fin_presupuestos (user_id, mes);
create index if not exists fin_deudas_user_idx on public.fin_deudas (user_id);
create index if not exists fin_metas_user_idx on public.fin_metas (user_id);
create index if not exists fin_metas_aportes_meta_idx on public.fin_metas_aportes (meta_id);

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
alter table public.fin_recordatorios enable row level security;
alter table public.fin_presupuestos enable row level security;
alter table public.fin_deudas enable row level security;
alter table public.fin_metas enable row level security;
alter table public.fin_metas_aportes enable row level security;

drop policy if exists "fin_recordatorios_dueno_o_hogar" on public.fin_recordatorios;
create policy "fin_recordatorios_dueno_o_hogar" on public.fin_recordatorios
  for all
  using (auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id)))
  with check (auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id)));

drop policy if exists "fin_presupuestos_dueno_o_hogar" on public.fin_presupuestos;
create policy "fin_presupuestos_dueno_o_hogar" on public.fin_presupuestos
  for all
  using (auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id)))
  with check (auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id)));

drop policy if exists "fin_deudas_dueno_o_hogar" on public.fin_deudas;
create policy "fin_deudas_dueno_o_hogar" on public.fin_deudas
  for all
  using (auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id)))
  with check (auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id)));

drop policy if exists "fin_metas_dueno_o_hogar" on public.fin_metas;
create policy "fin_metas_dueno_o_hogar" on public.fin_metas
  for all
  using (auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id)))
  with check (auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id)));

drop policy if exists "fin_metas_aportes_por_meta" on public.fin_metas_aportes;
create policy "fin_metas_aportes_por_meta" on public.fin_metas_aportes
  for all
  using (exists (
    select 1 from public.fin_metas m
    where m.id = meta_id
      and (auth.uid() = m.user_id
        or (m.hogar_id is not null and public.es_miembro_de_hogar(m.hogar_id)))
  ))
  with check (exists (
    select 1 from public.fin_metas m
    where m.id = meta_id and auth.uid() = m.user_id
  ));

-- ── 3. RPCs: recordatorios ──────────────────────────────────────────────────
create or replace function public.rpc_fin_recordatorio_upsert(
  p_user_id uuid,
  p_nombre text,
  p_monto numeric,
  p_moneda text,
  p_dia_mes int,
  p_cuenta_id text default null,
  p_categoria text default null,
  p_dias_aviso int default 3,
  p_tipo text default 'egreso',
  p_id uuid default null
)
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
  if p_nombre is null or char_length(trim(p_nombre)) = 0 then
    raise exception 'nombre_requerido';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto_invalido';
  end if;
  if p_moneda not in ('USD', 'VES', 'COP', 'USDT') then
    raise exception 'moneda_invalida';
  end if;
  if p_dia_mes is null or p_dia_mes < 1 or p_dia_mes > 31 then
    raise exception 'dia_invalido';
  end if;
  if p_tipo not in ('ingreso', 'egreso') then
    raise exception 'tipo_invalido';
  end if;

  if p_id is not null then
    update public.fin_recordatorios r
    set nombre = trim(p_nombre), tipo = p_tipo,
        categoria = nullif(lower(trim(coalesce(p_categoria, ''))), ''),
        monto = p_monto, moneda = p_moneda,
        cuenta_id = case when p_cuenta_id is null then null
                         else p_cuenta_id::uuid end,
        dia_mes = p_dia_mes, dias_aviso = coalesce(p_dias_aviso, r.dias_aviso)
    where r.id = p_id
      and (r.user_id = p_user_id
        or (r.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = r.hogar_id and hm.user_id = p_user_id)))
    returning r.id into v_id;
    if v_id is null then
      raise exception 'recordatorio_no_encontrado';
    end if;
  else
    insert into public.fin_recordatorios
      (user_id, nombre, tipo, categoria, monto, moneda, cuenta_id,
       dia_mes, dias_aviso, creado_por)
    values
      (p_user_id, trim(p_nombre), p_tipo,
       nullif(lower(trim(coalesce(p_categoria, ''))), ''),
       p_monto, p_moneda,
       case when p_cuenta_id is null then null else p_cuenta_id::uuid end,
       p_dia_mes, coalesce(p_dias_aviso, 3), p_user_id)
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Lista con próximo vencimiento y estado calculados.
create or replace function public.rpc_fin_recordatorios(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_hoy date := ((now() at time zone 'America/Caracas'))::date;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  return (
    select coalesce(jsonb_agg(row_to_json(t) order by t.proximo), '[]'::jsonb)
    from (
      select r.id, r.nombre, r.tipo, r.categoria, r.monto, r.moneda,
        r.cuenta_id, c.nombre as cuenta, r.dia_mes, r.dias_aviso,
        r.activo, r.ultimo_pago,
        public.fin_proximo_vencimiento(r.dia_mes, r.ultimo_pago) as proximo,
        case
          when public.fin_proximo_vencimiento(r.dia_mes, r.ultimo_pago) < v_hoy then 'vencido'
          when public.fin_proximo_vencimiento(r.dia_mes, r.ultimo_pago) - v_hoy <= r.dias_aviso then 'por_vencer'
          else 'pendiente'
        end as estado,
        public.fin_proximo_vencimiento(r.dia_mes, r.ultimo_pago) - v_hoy as dias_restantes
      from public.fin_recordatorios r
      left join public.fin_cuentas c on c.id = r.cuenta_id
      where r.user_id = p_user_id
        or (r.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = r.hogar_id and hm.user_id = p_user_id))
    ) t
  );
end;
$$;

-- Pagar un recordatorio: genera el movimiento y reprograma (ultimo_pago = hoy).
create or replace function public.rpc_fin_recordatorio_pagar(
  p_user_id uuid,
  p_id uuid,
  p_monto numeric default null,
  p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r public.fin_recordatorios%rowtype;
  v_hoy date := ((now() at time zone 'America/Caracas'))::date;
  v_cta public.fin_cuentas%rowtype;
  v_monto numeric;
  v_fin jsonb;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;

  select * into v_r from public.fin_recordatorios r
  where r.id = p_id
    and (r.user_id = p_user_id
      or (r.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = r.hogar_id and hm.user_id = p_user_id)));
  if v_r.id is null then
    raise exception 'recordatorio_no_encontrado';
  end if;
  if not v_r.activo then
    raise exception 'recordatorio_pausado';
  end if;

  v_monto := coalesce(p_monto, v_r.monto);
  if v_monto <= 0 then
    raise exception 'monto_invalido';
  end if;

  -- Resolver cuenta (la del recordatorio o la primera del usuario).
  if v_r.cuenta_id is not null then
    select * into v_cta from public.fin_cuentas c
    where c.id = v_r.cuenta_id and not c.archivada
      and (c.user_id = p_user_id
        or (c.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id)));
    if v_cta.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
  else
    select * into v_cta from public.fin_cuentas c
    where c.user_id = p_user_id and not c.archivada
    order by c.creado_en limit 1;
    if v_cta.id is null then
      raise exception 'sin_cuentas';
    end if;
  end if;

  v_fin := public.fin_registrar_interno(
    p_user_id, v_r.tipo,
    public.fin_convertir(v_monto, v_r.moneda, v_cta.moneda, null, v_cta.tasa_usd_manual),
    v_cta.id::text,
    coalesce(v_r.categoria, 'recurrente'),
    v_hoy,
    coalesce(nullif(trim(coalesce(p_nota, '')), ''), v_r.nombre),
    'rec-' || v_r.id::text || '-' || to_char(v_hoy, 'YYYYMMDD'),
    null
  );

  update public.fin_recordatorios
  set ultimo_pago = v_hoy
  where id = v_r.id;

  return jsonb_build_object(
    'ok', true,
    'fin_movimiento_id', v_fin ->> 'id',
    'monto', v_fin ->> 'monto',
    'moneda', v_fin ->> 'moneda',
    'proximo', public.fin_proximo_vencimiento(v_r.dia_mes, v_hoy)
  );
end;
$$;

create or replace function public.rpc_fin_recordatorio_toggle(
  p_user_id uuid, p_id uuid, p_activo boolean
)
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
  update public.fin_recordatorios r
  set activo = p_activo
  where r.id = p_id
    and (r.user_id = p_user_id
      or (r.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = r.hogar_id and hm.user_id = p_user_id)))
  returning r.id into v_id;
  if v_id is null then
    raise exception 'recordatorio_no_encontrado';
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'activo', p_activo);
end;
$$;

-- ── 4. RPCs: presupuestos ───────────────────────────────────────────────────
create or replace function public.rpc_fin_presupuesto_upsert(
  p_user_id uuid,
  p_categoria text,
  p_monto_limite numeric,
  p_moneda text default 'USD',
  p_mes date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mes date;
  v_id uuid;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  if p_categoria is null or char_length(trim(p_categoria)) = 0 then
    raise exception 'categoria_requerida';
  end if;
  if p_monto_limite is null or p_monto_limite <= 0 then
    raise exception 'monto_invalido';
  end if;
  if p_moneda not in ('USD', 'VES', 'COP', 'USDT') then
    raise exception 'moneda_invalida';
  end if;
  v_mes := date_trunc('month', coalesce(p_mes, ((now() at time zone 'America/Caracas'))::date))::date;

  insert into public.fin_presupuestos
    (user_id, categoria, monto_limite, moneda, mes, creado_por)
  values
    (p_user_id, lower(trim(p_categoria)), p_monto_limite, p_moneda, v_mes, p_user_id)
  on conflict (user_id, categoria, mes)
  do update set monto_limite = excluded.monto_limite, moneda = excluded.moneda
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'mes', v_mes);
end;
$$;

-- Presupuestos del mes con gastado real (egresos de la categoría, en USD).
create or replace function public.rpc_fin_presupuestos(p_user_id uuid, p_mes date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_mes date := date_trunc('month', coalesce(p_mes, ((now() at time zone 'America/Caracas'))::date))::date;
  v_fin date := (v_mes + interval '1 month - 1 day')::date;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  return (
    with alcance as (
      select pr.*
      from public.fin_presupuestos pr
      where pr.mes = v_mes
        and (pr.user_id = p_user_id
          or (pr.hogar_id is not null and exists (
            select 1 from public.hogar_miembros hm
            where hm.hogar_id = pr.hogar_id and hm.user_id = p_user_id)))
    ),
    gasto as (
      select m.categoria,
        sum(m.monto * m.tasa_usd) as gastado_usd
      from public.fin_movimientos m
      where m.tipo = 'egreso'
        and m.anulado_en is null
        and m.fecha between v_mes and v_fin
        and m.categoria is not null
        and (m.user_id = p_user_id
          or (m.hogar_id is not null and exists (
            select 1 from public.hogar_miembros hm
            where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)))
      group by m.categoria
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.pct desc nulls last), '[]'::jsonb)
    from (
      select a.id, a.categoria, a.monto_limite as limite, a.moneda,
        round(public.fin_convertir(a.monto_limite, a.moneda, 'USD'), 2) as limite_usd,
        round(coalesce(g.gastado_usd, 0), 2) as gastado_usd,
        case when a.monto_limite > 0
          then round(coalesce(g.gastado_usd, 0)
            / public.fin_convertir(a.monto_limite, a.moneda, 'USD') * 100, 1)
        end as pct,
        case
          when coalesce(g.gastado_usd, 0) >= public.fin_convertir(a.monto_limite, a.moneda, 'USD') then 'excedido'
          when coalesce(g.gastado_usd, 0) >= public.fin_convertir(a.monto_limite, a.moneda, 'USD') * 0.8 then 'alerta'
          else 'ok'
        end as estado
      from alcance a
      left join gasto g on g.categoria = a.categoria
    ) t
  );
end;
$$;

-- Copiar presupuestos de un mes a otro.
create or replace function public.rpc_fin_presupuesto_copiar(
  p_user_id uuid, p_mes_origen date, p_mes_destino date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen date := date_trunc('month', p_mes_origen)::date;
  v_destino date := date_trunc('month', p_mes_destino)::date;
  v_n int;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  with ins as (
    insert into public.fin_presupuestos
      (user_id, hogar_id, categoria, monto_limite, moneda, mes, creado_por)
    select p_user_id, hogar_id, categoria, monto_limite, moneda, v_destino, p_user_id
    from public.fin_presupuestos
    where user_id = p_user_id and mes = v_origen
    on conflict (user_id, categoria, mes) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return jsonb_build_object('ok', true, 'copiados', v_n);
end;
$$;

-- ── 5. RPCs: deudas ─────────────────────────────────────────────────────────
create or replace function public.rpc_fin_deuda_upsert(
  p_user_id uuid,
  p_tipo text,
  p_contraparte text,
  p_monto numeric,
  p_moneda text,
  p_fecha_limite date default null,
  p_cuenta_id text default null,
  p_nota text default null,
  p_id uuid default null
)
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
  if p_tipo not in ('por_cobrar', 'por_pagar') then
    raise exception 'tipo_invalido';
  end if;
  if p_contraparte is null or char_length(trim(p_contraparte)) = 0 then
    raise exception 'contraparte_requerida';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto_invalido';
  end if;
  if p_moneda not in ('USD', 'VES', 'COP', 'USDT') then
    raise exception 'moneda_invalida';
  end if;

  if p_id is not null then
    update public.fin_deudas d
    set tipo = p_tipo, contraparte = trim(p_contraparte),
        monto = p_monto, moneda = p_moneda,
        fecha_limite = p_fecha_limite,
        nota = nullif(trim(coalesce(p_nota, '')), ''),
        cuenta_id = case when p_cuenta_id is null then null
                         else p_cuenta_id::uuid end
    where d.id = p_id
      and (d.user_id = p_user_id
        or (d.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = d.hogar_id and hm.user_id = p_user_id)))
    returning d.id into v_id;
    if v_id is null then
      raise exception 'deuda_no_encontrada';
    end if;
  else
    insert into public.fin_deudas
      (user_id, tipo, contraparte, monto, moneda, fecha_limite, nota,
       cuenta_id, creado_por)
    values
      (p_user_id, p_tipo, trim(p_contraparte), p_monto, p_moneda,
       p_fecha_limite, nullif(trim(coalesce(p_nota, '')), ''),
       case when p_cuenta_id is null then null else p_cuenta_id::uuid end,
       p_user_id)
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.rpc_fin_deudas(p_user_id uuid)
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
    select coalesce(jsonb_agg(row_to_json(t)
      order by t.estado, t.fecha_limite nulls last), '[]'::jsonb)
    from (
      select d.id, d.tipo, d.contraparte, d.monto, d.abonado, d.moneda,
        round(d.monto - d.abonado, 2) as pendiente,
        d.fecha_limite, d.nota, d.cuenta_id, c.nombre as cuenta,
        case when d.abonado >= d.monto then 'saldada' else 'pendiente' end as estado
      from public.fin_deudas d
      left join public.fin_cuentas c on c.id = d.cuenta_id
      where d.user_id = p_user_id
        or (d.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = d.hogar_id and hm.user_id = p_user_id))
    ) t
  );
end;
$$;

-- Abonar a una deuda: por_pagar → egreso; por_cobrar → ingreso.
create or replace function public.rpc_fin_deuda_abonar(
  p_user_id uuid,
  p_id uuid,
  p_monto numeric,
  p_cuenta_id text default null,
  p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d public.fin_deudas%rowtype;
  v_hoy date := ((now() at time zone 'America/Caracas'))::date;
  v_cta public.fin_cuentas%rowtype;
  v_fin jsonb;
  v_tipo_mov text;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto_invalido';
  end if;

  select * into v_d from public.fin_deudas d
  where d.id = p_id
    and (d.user_id = p_user_id
      or (d.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = d.hogar_id and hm.user_id = p_user_id)));
  if v_d.id is null then
    raise exception 'deuda_no_encontrada';
  end if;
  if v_d.abonado >= v_d.monto then
    raise exception 'deuda_saldada';
  end if;

  if p_cuenta_id is not null then
    select * into v_cta from public.fin_cuentas c
    where not c.archivada and c.id::text = p_cuenta_id
      and (c.user_id = p_user_id
        or (c.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id)));
    if v_cta.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
  elsif v_d.cuenta_id is not null then
    select * into v_cta from public.fin_cuentas c
    where c.id = v_d.cuenta_id and not c.archivada;
    if v_cta.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
  else
    select * into v_cta from public.fin_cuentas c
    where c.user_id = p_user_id and not c.archivada
    order by c.creado_en limit 1;
    if v_cta.id is null then
      raise exception 'sin_cuentas';
    end if;
  end if;

  v_tipo_mov := case when v_d.tipo = 'por_pagar' then 'egreso' else 'ingreso' end;
  v_fin := public.fin_registrar_interno(
    p_user_id, v_tipo_mov,
    public.fin_convertir(p_monto, v_d.moneda, v_cta.moneda, null, v_cta.tasa_usd_manual),
    v_cta.id::text, 'deuda', v_hoy,
    coalesce(nullif(trim(coalesce(p_nota, '')), ''), '')
      || ' · ' || v_d.contraparte,
    'deuda-' || v_d.id::text || '-' || to_char(v_hoy, 'YYYYMMDD')
      || '-' || round(p_monto::numeric, 2)::text,
    null
  );

  update public.fin_deudas
  set abonado = abonado + p_monto
  where id = v_d.id;

  return jsonb_build_object(
    'ok', true,
    'fin_movimiento_id', v_fin ->> 'id',
    'abonado_total', (select abonado from public.fin_deudas where id = v_d.id),
    'saldada', (select abonado >= monto from public.fin_deudas where id = v_d.id)
  );
end;
$$;

-- ── 6. RPCs: metas de ahorro ────────────────────────────────────────────────
create or replace function public.rpc_fin_meta_upsert(
  p_user_id uuid,
  p_nombre text,
  p_monto_objetivo numeric,
  p_moneda text,
  p_fecha_objetivo date default null,
  p_id uuid default null
)
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
  if p_nombre is null or char_length(trim(p_nombre)) = 0 then
    raise exception 'nombre_requerido';
  end if;
  if p_monto_objetivo is null or p_monto_objetivo <= 0 then
    raise exception 'monto_invalido';
  end if;
  if p_moneda not in ('USD', 'VES', 'COP', 'USDT') then
    raise exception 'moneda_invalida';
  end if;

  if p_id is not null then
    update public.fin_metas m
    set nombre = trim(p_nombre), monto_objetivo = p_monto_objetivo,
        moneda = p_moneda, fecha_objetivo = p_fecha_objetivo
    where m.id = p_id
      and (m.user_id = p_user_id
        or (m.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)))
    returning m.id into v_id;
    if v_id is null then
      raise exception 'meta_no_encontrada';
    end if;
  else
    insert into public.fin_metas
      (user_id, nombre, monto_objetivo, moneda, fecha_objetivo, creado_por)
    values
      (p_user_id, trim(p_nombre), p_monto_objetivo, p_moneda,
       p_fecha_objetivo, p_user_id)
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.rpc_fin_metas(p_user_id uuid)
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
    select coalesce(jsonb_agg(row_to_json(t) order by t.pct desc), '[]'::jsonb)
    from (
      select m.id, m.nombre, m.monto_objetivo as objetivo, m.moneda,
        m.fecha_objetivo,
        round(public.fin_convertir(m.monto_objetivo, m.moneda, 'USD'), 2) as objetivo_usd,
        round(coalesce(sum(public.fin_convertir(a.monto, a.moneda, 'USD')), 0), 2) as aportado_usd,
        case when m.monto_objetivo > 0
          then round(coalesce(sum(public.fin_convertir(a.monto, a.moneda, 'USD')), 0)
            / public.fin_convertir(m.monto_objetivo, m.moneda, 'USD') * 100, 1)
        end as pct
      from public.fin_metas m
      left join public.fin_metas_aportes a on a.meta_id = m.id
      where m.user_id = p_user_id
        or (m.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id))
      group by m.id
    ) t
  );
end;
$$;

-- Aportar a una meta. Con cuenta → egreso 'ahorro' (el dinero se aparta).
create or replace function public.rpc_fin_meta_aportar(
  p_user_id uuid,
  p_meta_id uuid,
  p_monto numeric,
  p_moneda text default null,
  p_cuenta_id text default null,
  p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.fin_metas%rowtype;
  v_hoy date := ((now() at time zone 'America/Caracas'))::date;
  v_cta public.fin_cuentas%rowtype;
  v_fin jsonb;
  v_moneda text;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto_invalido';
  end if;

  select * into v_m from public.fin_metas m
  where m.id = p_meta_id
    and (m.user_id = p_user_id
      or (m.hogar_id is not null and exists (
        select 1 from public.hogar_miembros hm
        where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)));
  if v_m.id is null then
    raise exception 'meta_no_encontrada';
  end if;
  v_moneda := coalesce(p_moneda, v_m.moneda);
  if v_moneda not in ('USD', 'VES', 'COP', 'USDT') then
    raise exception 'moneda_invalida';
  end if;

  if p_cuenta_id is not null then
    select * into v_cta from public.fin_cuentas c
    where not c.archivada and c.id::text = p_cuenta_id
      and (c.user_id = p_user_id
        or (c.hogar_id is not null and exists (
          select 1 from public.hogar_miembros hm
          where hm.hogar_id = c.hogar_id and hm.user_id = p_user_id)));
    if v_cta.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
    v_fin := public.fin_registrar_interno(
      p_user_id, 'egreso',
      public.fin_convertir(p_monto, v_moneda, v_cta.moneda, null, v_cta.tasa_usd_manual),
      v_cta.id::text, 'ahorro', v_hoy,
      'Meta: ' || v_m.nombre
        || coalesce(' · ' || nullif(trim(coalesce(p_nota, '')), ''), ''),
      'meta-' || v_m.id::text || '-' || to_char(v_hoy, 'YYYYMMDD')
        || '-' || round(p_monto::numeric, 2)::text,
      null
    );
  end if;

  insert into public.fin_metas_aportes
    (meta_id, monto, moneda, fecha, cuenta_id, fin_movimiento_id, nota, creado_por)
  values
    (v_m.id, p_monto, v_moneda, v_hoy,
     case when v_cta.id is not null then v_cta.id end,
     case when v_fin is not null then (v_fin ->> 'id')::uuid end,
     nullif(trim(coalesce(p_nota, '')), ''), p_user_id);

  return jsonb_build_object(
    'ok', true,
    'fin_movimiento_id', case when v_fin is not null then v_fin ->> 'id' end
  );
end;
$$;

-- ── 7. Cierre de mes ────────────────────────────────────────────────────────
create or replace function public.rpc_fin_cierre_mes(p_user_id uuid, p_mes date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_mes date := date_trunc('month', coalesce(p_mes, ((now() at time zone 'America/Caracas'))::date))::date;
  v_fin date := (v_mes + interval '1 month - 1 day')::date;
  v_prev date := (v_mes - interval '1 month')::date;
  v_prev_fin date := (v_mes - interval '1 day')::date;
begin
  if not public.rpc_fin_secret_ok() then
    raise exception 'no_autorizado';
  end if;
  return (
    with movs as (
      select m.*
      from public.fin_movimientos m
      where m.anulado_en is null
        and (m.user_id = p_user_id
          or (m.hogar_id is not null and exists (
            select 1 from public.hogar_miembros hm
            where hm.hogar_id = m.hogar_id and hm.user_id = p_user_id)))
    ),
    mes as (
      select
        sum(case when tipo = 'ingreso' then monto * tasa_usd end) as ingresos,
        sum(case when tipo = 'egreso' then monto * tasa_usd end) as egresos
      from movs where fecha between v_mes and v_fin
    ),
    prev as (
      select
        sum(case when tipo = 'ingreso' then monto * tasa_usd end) as ingresos,
        sum(case when tipo = 'egreso' then monto * tasa_usd end) as egresos
      from movs where fecha between v_prev and v_prev_fin
    ),
    por_cat as (
      select coalesce(categoria, 'sin categoría') as categoria,
        round(sum(monto * tasa_usd), 2) as total_usd,
        count(*) as n
      from movs
      where tipo = 'egreso' and fecha between v_mes and v_fin
      group by categoria
      order by total_usd desc
      limit 10
    )
    select jsonb_build_object(
      'mes', v_mes,
      'ingresos_usd', round(coalesce((select ingresos from mes), 0), 2),
      'egresos_usd', round(coalesce((select egresos from mes), 0), 2),
      'balance_usd', round(coalesce((select ingresos from mes), 0)
        - coalesce((select egresos from mes), 0), 2),
      'mes_anterior', jsonb_build_object(
        'ingresos_usd', round(coalesce((select ingresos from prev), 0), 2),
        'egresos_usd', round(coalesce((select egresos from prev), 0), 2)
      ),
      'por_categoria', coalesce((select jsonb_agg(row_to_json(por_cat)) from por_cat), '[]'::jsonb)
    )
  );
end;
$$;
