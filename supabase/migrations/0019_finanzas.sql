-- 0019_finanzas.sql — Fase 1: libro de finanzas del hogar (Senda).
--
-- Decisiones (roadmap / luigi):
-- - Saldos y patrimonio se CALCULAN desde movimientos; nunca se almacenan
--   como cifras mutables.
-- - Todo dato compartido lleva creado_por.
-- - Sin XP ni gamificación: tono serio.
-- - Cuentas personales (hogar_id null) o del hogar (visibles para ambos
--   miembros vía es_miembro_de_hogar, patrón anti-recursión de la 0016).
-- - Cada movimiento guarda un snapshot `tasa_usd` (1 unidad de la moneda de
--   la cuenta → USD) tomado de fin_tasas (o tasa_usd_manual de la cuenta):
--   el patrimonio en $ no se recalcula retroactivamente si la tasa cambia.
-- - `clave_evento` unique → idempotencia (WhatsApp / doble tap en la app).
-- - Transferencia = UNA sola fila con cuenta_id (origen) + cuenta_destino_id;
--   monto_destino se autoconvierte con los snapshots cuando difiere la moneda.

create table if not exists public.fin_cuentas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hogar_id uuid references public.hogares(id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 60),
  moneda text not null check (moneda in ('USD', 'VES', 'COP', 'USDT')),
  tipo text not null check (tipo in ('efectivo', 'banco', 'cripto', 'otro')),
  tasa_usd_manual numeric(18, 6),
  archivada boolean not null default false,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now()
);

create table if not exists public.fin_movimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hogar_id uuid references public.hogares(id) on delete cascade,
  cuenta_id uuid not null references public.fin_cuentas(id) on delete restrict,
  cuenta_destino_id uuid references public.fin_cuentas(id) on delete restrict,
  tipo text not null check (tipo in ('ingreso', 'egreso', 'transferencia')),
  categoria text,
  monto numeric(18, 2) not null check (monto > 0),
  monto_destino numeric(18, 2) check (monto_destino is null or monto_destino > 0),
  tasa_usd numeric(18, 6) not null check (tasa_usd > 0),
  tasa_usd_destino numeric(18, 6) check (tasa_usd_destino is null or tasa_usd_destino > 0),
  fecha date not null default ((now() at time zone 'America/Caracas'))::date,
  nota text,
  clave_evento text unique,
  creado_por uuid references auth.users(id) on delete set null,
  creado_en timestamptz not null default now(),
  anulado_en timestamptz,
  check (tipo <> 'transferencia' or cuenta_destino_id is not null),
  check (tipo = 'transferencia' or cuenta_destino_id is null),
  check (tipo = 'transferencia' or monto_destino is null),
  check (tipo = 'transferencia' or tasa_usd_destino is null),
  check (cuenta_destino_id is null or cuenta_id <> cuenta_destino_id)
);

create index if not exists fin_cuentas_user_id_idx on public.fin_cuentas (user_id);
create index if not exists fin_cuentas_hogar_id_idx on public.fin_cuentas (hogar_id);
create index if not exists fin_movimientos_cuenta_fecha_idx
  on public.fin_movimientos (cuenta_id, fecha desc);
create index if not exists fin_movimientos_user_fecha_idx
  on public.fin_movimientos (user_id, fecha desc);
create index if not exists fin_movimientos_hogar_fecha_idx
  on public.fin_movimientos (hogar_id, fecha desc)
  where hogar_id is not null;

alter table public.fin_cuentas enable row level security;
alter table public.fin_movimientos enable row level security;

-- Dueño o miembro del hogar (lectura y escritura).
drop policy if exists "fin_cuentas_dueno_o_hogar" on public.fin_cuentas;
create policy "fin_cuentas_dueno_o_hogar" on public.fin_cuentas
  for all
  using (
    auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id))
  )
  with check (
    auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id))
  );

drop policy if exists "fin_movimientos_dueno_o_hogar" on public.fin_movimientos;
create policy "fin_movimientos_dueno_o_hogar" on public.fin_movimientos
  for all
  using (
    auth.uid() = user_id
    or (hogar_id is not null and public.es_miembro_de_hogar(hogar_id))
  )
  with check (
    auth.uid() = user_id
    and (hogar_id is null or public.es_miembro_de_hogar(hogar_id))
  );

-- ── Saldos calculados (vista; respeta RLS de las tablas base) ────────────────
-- saldo_moneda: en la moneda de la cuenta. saldo_usd: con los snapshots.
create or replace view public.fin_saldos with (security_invoker = true) as
select
  c.id as cuenta_id,
  coalesce(sum(case
    when m.tipo = 'ingreso' then m.monto
    when m.tipo = 'egreso' then -m.monto
    when m.tipo = 'transferencia' and m.cuenta_id = c.id then -m.monto
    when m.tipo = 'transferencia' and m.cuenta_destino_id = c.id then m.monto_destino
    else 0
  end), 0)::numeric(18, 2) as saldo_moneda,
  coalesce(sum(case
    when m.tipo = 'ingreso' then m.monto * m.tasa_usd
    when m.tipo = 'egreso' then -m.monto * m.tasa_usd
    when m.tipo = 'transferencia' and m.cuenta_id = c.id then -m.monto * m.tasa_usd
    when m.tipo = 'transferencia' and m.cuenta_destino_id = c.id then m.monto_destino * m.tasa_usd_destino
    else 0
  end), 0)::numeric(18, 2) as saldo_usd,
  count(m.id)::int as n_movimientos
from public.fin_cuentas c
left join public.fin_movimientos m
  on (m.cuenta_id = c.id or m.cuenta_destino_id = c.id)
  and m.anulado_en is null
group by c.id;

-- ── Secreto del RPC conversacional (patrón 0012, tabla propia) ───────────────
-- El valor real NO va aquí; se inserta aparte (mismo valor que el secreto de
-- hábitos, un solo secreto que administrar):
--   insert into public.fin_rpc_secrets (name, value)
--   values ('rpc-secret', '<secreto-64-hex>')
--   on conflict (name) do update set value = excluded.value;
create table if not exists public.fin_rpc_secrets (
  name text primary key,
  value text not null
);

alter table public.fin_rpc_secrets enable row level security;
revoke all on public.fin_rpc_secrets from public;

create or replace function public.rpc_fin_secret_ok()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_secret text;
  v_esperado text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return false;
  end;
  v_secret := v_headers ->> 'x-fin-rpc-secret';
  if v_secret is null or v_secret = '' then
    return false;
  end if;
  select value into v_esperado from public.fin_rpc_secrets where name = 'rpc-secret';
  if v_esperado is null then
    return false;
  end if;
  return v_secret = v_esperado;
end;
$$;

-- Tasa USD snapshot para una moneda (manual de la cuenta > fin_tasas).
create or replace function public.fin_tasa_usd_para(p_moneda text, p_manual numeric)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_paralelo numeric;
begin
  if p_manual is not null and p_manual > 0 then
    return p_manual;
  end if;
  if p_moneda in ('USD', 'USDT') then
    return 1;
  end if;
  if p_moneda = 'VES' then
    select paralelo into v_paralelo
    from public.fin_tasas order by fecha desc limit 1;
    if v_paralelo is null or v_paralelo <= 0 then
      raise exception 'sin_tasa_ves';
    end if;
    return 1 / v_paralelo;
  end if;
  raise exception 'tasa_manual_requerida';
end;
$$;

-- ── RPC: registrar movimiento (WhatsApp / integraciones) ────────────────────
-- p_cuenta: id o nombre (insensible a mayúsculas); null → la primera cuenta
--   activa; si no hay cuentas, crea "Efectivo" USD automáticamente.
-- El secreto viaja en el header `x-fin-rpc-secret` (patrón 0012).
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

  -- Resolver cuenta origen.
  if p_cuenta is not null then
    select * into v_cuenta from public.fin_cuentas
    where user_id = p_user_id and not archivada
      and (id::text = p_cuenta or lower(nombre) = lower(p_cuenta))
    order by creado_en limit 1;
    if v_cuenta.id is null then
      raise exception 'cuenta_no_encontrada';
    end if;
  else
    select * into v_cuenta from public.fin_cuentas
    where user_id = p_user_id and not archivada
    order by creado_en limit 1;
    if v_cuenta.id is null then
      -- Primera vez: crear "Efectivo" en USD automáticamente.
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
    select * into v_dest from public.fin_cuentas
    where user_id = p_user_id and not archivada
      and (id::text = p_cuenta_destino or lower(nombre) = lower(p_cuenta_destino))
    order by creado_en limit 1;
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

-- ── RPC: saldos por cuenta (WhatsApp) ────────────────────────────────────────
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
      where c.user_id = p_user_id and not c.archivada
      order by c.creado_en
    ) t
  );
end;
$$;

-- ── RPC: movimientos recientes (WhatsApp) ────────────────────────────────────
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
      select m.id, m.tipo, m.categoria, m.monto, m.nota, m.fecha,
             c.nombre as cuenta, c.moneda,
             d.nombre as destino, m.monto_destino
      from public.fin_movimientos m
      join public.fin_cuentas c on c.id = m.cuenta_id
      left join public.fin_cuentas d on d.id = m.cuenta_destino_id
      where m.user_id = p_user_id and m.anulado_en is null
      order by m.fecha desc, m.creado_en desc
      limit greatest(1, least(coalesce(p_limite, 10), 50))
    ) t
  );
end;
$$;

-- ── RPC: anular movimiento (WhatsApp / correcciones) ─────────────────────────
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
  update public.fin_movimientos
  set anulado_en = now()
  where id = p_movimiento_id and user_id = p_user_id and anulado_en is null
  returning id into v_id;
  if v_id is null then
    raise exception 'movimiento_no_encontrado';
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ── Grants (patrón 0012: las funciones SECURITY DEFINER se exponen a anon/authenticated; el secreto las protege) ──
revoke all on function public.rpc_fin_secret_ok() from public;
grant execute on function public.rpc_fin_secret_ok() to anon, authenticated;
revoke all on function public.rpc_fin_registrar(uuid, text, numeric, text, text, date, text, text, text) from public;
grant execute on function public.rpc_fin_registrar(uuid, text, numeric, text, text, date, text, text, text) to anon, authenticated;
revoke all on function public.rpc_fin_saldos(uuid) from public;
grant execute on function public.rpc_fin_saldos(uuid) to anon, authenticated;
revoke all on function public.rpc_fin_recientes(uuid, int) from public;
grant execute on function public.rpc_fin_recientes(uuid, int) to anon, authenticated;
revoke all on function public.rpc_fin_anular(uuid, uuid) from public;
grant execute on function public.rpc_fin_anular(uuid, uuid) to anon, authenticated;
