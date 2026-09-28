-- 0029_recibos.sql — Fase 5: Recibos (comprobantes en PDF, diseño de recibera).
--
-- Tabla fin_recibos: snapshot JSONB completo (fuente de verdad del PDF, como
-- recibera) + columnas desnormalizadas para listado rápido. Numeración
-- secuencial atómica por mes: SEN-AAAAMM-XXX (guardarraíl #2).
-- Auth dual en los RPC (secreto o JWT del navegador), mismo patrón que
-- rpc_mer_llamada_ok (0028). La web escribe directo por RLS; el número siempre
-- sale del RPC para no dejar huecos ni duplicados.

-- ── Tabla ──
create table if not exists public.fin_recibos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  hogar_id uuid,
  numero text not null unique,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'parcial', 'pagado', 'anulado')),
  moneda text not null check (moneda in ('USD', 'VES', 'COP', 'USDT')),
  cliente_nombre text not null,
  snapshot jsonb not null default '{}'::jsonb,
  total numeric not null default 0,
  total_pagado numeric not null default 0,
  saldo numeric not null default 0,
  fecha_emision date not null default ((now() at time zone 'America/Caracas'))::date,
  fecha_vencimiento date,
  creado_por uuid not null,
  creado_en timestamptz not null default now(),
  anulado_en timestamptz
);

create index if not exists fin_recibos_user_idx on public.fin_recibos (user_id, creado_en desc);
create index if not exists fin_recibos_estado_idx on public.fin_recibos (estado);
create index if not exists fin_recibos_numero_idx on public.fin_recibos (numero);

-- ── Secuencia mensual atómica ──
create table if not exists public.fin_recibo_secuencias (
  clave text not null,
  mes text not null,
  ultimo integer not null default 0,
  primary key (clave, mes)
);

-- ── RLS: dueño o miembro del hogar (igual que fin_cuentas) ──
alter table public.fin_recibos enable row level security;
drop policy if exists "fin_recibos_dueno_o_hogar" on public.fin_recibos;
create policy "fin_recibos_dueno_o_hogar" on public.fin_recibos
  for all
  using (
    auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id))
  )
  with check (
    auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id))
  );

-- ── Helper de autenticación dual (secreto o JWT) ──
create or replace function public.rpc_recibo_llamada_ok(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.rpc_fin_secret_ok() then
    return true;
  end if;
  return auth.uid() is not null and auth.uid() = p_user_id;
exception when others then
  return false;
end;
$$;

-- ── Número secuencial atómico: SEN-AAAAMM-XXX ──
create or replace function public.rpc_recibo_numero(
  p_user_id uuid,
  p_hogar_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text := coalesce(p_hogar_id::text, 'u:' || p_user_id::text);
  v_mes text := to_char((now() at time zone 'America/Caracas'), 'YYYYMM');
  v_ultimo integer;
begin
  if not public.rpc_recibo_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  insert into public.fin_recibo_secuencias (clave, mes, ultimo)
  values (v_clave, v_mes, 1)
  on conflict (clave, mes)
  do update set ultimo = public.fin_recibo_secuencias.ultimo + 1
  returning public.fin_recibo_secuencias.ultimo into v_ultimo;
  return 'SEN-' || v_mes || '-' || lpad(v_ultimo::text, 3, '0');
end;
$$;

-- ── Crear recibo (número atómico incluido) ──
create or replace function public.rpc_recibo_crear(
  p_user_id uuid,
  p_moneda text,
  p_cliente_nombre text,
  p_snapshot jsonb,
  p_total numeric,
  p_fecha_emision date default null,
  p_fecha_vencimiento date default null,
  p_hogar_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numero text;
  v_id uuid;
begin
  if not public.rpc_recibo_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if p_moneda not in ('USD', 'VES', 'COP', 'USDT') then
    raise exception 'moneda_invalida';
  end if;
  if p_cliente_nombre is null or char_length(trim(p_cliente_nombre)) = 0 then
    raise exception 'cliente_requerido';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'snapshot_invalido';
  end if;
  if not (p_total >= 0) then
    raise exception 'total_invalido';
  end if;
  if p_hogar_id is not null and not public.es_miembro_de_hogar(p_hogar_id) then
    raise exception 'hogar_invalido';
  end if;

  v_numero := public.rpc_recibo_numero(p_user_id, p_hogar_id);

  insert into public.fin_recibos
    (user_id, hogar_id, numero, moneda, cliente_nombre, snapshot, total, saldo,
     fecha_emision, fecha_vencimiento, creado_por)
  values
    (p_user_id, p_hogar_id, v_numero, p_moneda, trim(p_cliente_nombre), p_snapshot,
     p_total, p_total,
     coalesce(p_fecha_emision, ((now() at time zone 'America/Caracas'))::date),
     p_fecha_vencimiento, p_user_id)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
end;
$$;

-- ── Abonar (pago parcial; nunca supera el saldo — guardarraíl #6) ──
create or replace function public.rpc_recibo_abonar(
  p_user_id uuid,
  p_recibo_id uuid,
  p_monto numeric,
  p_fecha date default null,
  p_metodo text default null,
  p_referencia text default null,
  p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.fin_recibos%rowtype;
  v_pagos jsonb;
  v_pagado numeric;
  v_estado text;
begin
  if not public.rpc_recibo_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;
  if not (p_monto > 0) then
    raise exception 'monto_invalido';
  end if;

  select * into v_rec from public.fin_recibos where id = p_recibo_id;
  if not found then
    raise exception 'recibo_no_encontrado';
  end if;
  if v_rec.user_id <> p_user_id
     and not (v_rec.hogar_id is not null and public.es_miembro_de_hogar(v_rec.hogar_id)) then
    raise exception 'no_autorizado';
  end if;
  if v_rec.estado = 'anulado' then
    raise exception 'recibo_anulado';
  end if;
  if p_monto > v_rec.saldo then
    raise exception 'sobrepago';
  end if;

  v_pagos := coalesce(v_rec.snapshot -> 'pagos', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'fecha', coalesce(p_fecha, ((now() at time zone 'America/Caracas'))::date)::text,
      'monto', p_monto,
      'metodo', p_metodo,
      'referencia', p_referencia,
      'nota', p_nota
    )
  );
  v_pagado := v_rec.total_pagado + p_monto;
  v_estado := case
    when v_pagado >= v_rec.total then 'pagado'
    else 'parcial'
  end;

  update public.fin_recibos
  set snapshot = jsonb_set(snapshot, '{pagos}', v_pagos),
      total_pagado = v_pagado,
      saldo = total - v_pagado,
      estado = v_estado
  where id = p_recibo_id;

  return jsonb_build_object('ok', true, 'estado', v_estado, 'saldo', v_rec.total - v_pagado);
end;
$$;

-- ── Anular (soft delete — guardarraíl #3) ──
create or replace function public.rpc_recibo_anular(
  p_user_id uuid,
  p_recibo_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.fin_recibos%rowtype;
begin
  if not public.rpc_recibo_llamada_ok(p_user_id) then
    raise exception 'no_autorizado';
  end if;

  select * into v_rec from public.fin_recibos where id = p_recibo_id;
  if not found then
    raise exception 'recibo_no_encontrado';
  end if;
  if v_rec.user_id <> p_user_id
     and not (v_rec.hogar_id is not null and public.es_miembro_de_hogar(v_rec.hogar_id)) then
    raise exception 'no_autorizado';
  end if;

  update public.fin_recibos
  set estado = 'anulado', anulado_en = now()
  where id = p_recibo_id and estado <> 'anulado';

  return jsonb_build_object('ok', true);
end;
$$;

-- ── Permisos ──
revoke all on function public.rpc_recibo_llamada_ok(uuid) from public;
grant execute on function public.rpc_recibo_llamada_ok(uuid) to anon, authenticated;
revoke all on function public.rpc_recibo_numero(uuid, uuid) from public;
grant execute on function public.rpc_recibo_numero(uuid, uuid) to anon, authenticated;
revoke all on function public.rpc_recibo_crear(uuid, text, text, jsonb, numeric, date, date, uuid) from public;
grant execute on function public.rpc_recibo_crear(uuid, text, text, jsonb, numeric, date, date, uuid) to anon, authenticated;
revoke all on function public.rpc_recibo_abonar(uuid, uuid, numeric, date, text, text, text) from public;
grant execute on function public.rpc_recibo_abonar(uuid, uuid, numeric, date, text, text, text) to anon, authenticated;
revoke all on function public.rpc_recibo_anular(uuid, uuid) from public;
grant execute on function public.rpc_recibo_anular(uuid, uuid) to anon, authenticated;
