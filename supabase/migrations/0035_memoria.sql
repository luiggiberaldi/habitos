-- 0035_memoria.sql — Memoria conversacional de Senda (pgvector).
--
-- Prototipo chiquito: el asistente de WhatsApp puede GUARDAR datos que Luigi
-- le dice ("recuerda que el arroz lo compro en el mercado X") y BUSCARLOS
-- después por similitud semántica, sin depender de un servicio externo.
--
-- Diseño:
--   - Embeddings DETERMINISTAS de 64 dimensiones generados en el cliente
--     (scripts/senda-memoria.mjs, FNV-1a sobre unigramas+bigramas, L2).
--     No requieren API key ni red: todo el pipeline es reproducible.
--   - Si algún día se cambia a embeddings reales (OpenAI/Cohere), hay que
--     migrar la columna a la nueva dimensión; el resto no cambia.
--   - Acceso solo vía RPC SECURITY DEFINER con el secreto conversacional
--     (rpc_habitos_secret_ok()); RLS habilitado sin policies = denegar todo
--     acceso directo. Igual que el resto de tablas de la suite.
--
-- El valor real del secreto NO va en este archivo (vive en
-- public.habitos_rpc_secrets, ver migración 0012).

-- ── Extensión ────────────────────────────────────────────────────────────
create extension if not exists vector;

-- ── Tabla ────────────────────────────────────────────────────────────────
create table if not exists public.senda_memorias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  texto text not null,
  embedding vector(64) not null,
  modulo text not null default 'general',
  created_at timestamptz not null default now()
);

alter table public.senda_memorias enable row level security;
revoke all on public.senda_memorias from public;
revoke all on public.senda_memorias from anon;
revoke all on public.senda_memorias from authenticated;

create index if not exists senda_memorias_embedding_idx
  on public.senda_memorias using hnsw (embedding vector_cosine_ops);

create index if not exists senda_memorias_user_idx
  on public.senda_memorias (user_id);

-- ── RPC: guardar ─────────────────────────────────────────────────────────
create or replace function public.rpc_senda_memoria_guardar(
  p_user_id uuid,
  p_texto text,
  p_embedding double precision[],
  p_modulo text default 'general'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'forbidden';
  end if;
  if p_texto is null or btrim(p_texto) = '' then
    raise exception 'texto vacio';
  end if;
  if p_embedding is null or array_length(p_embedding, 1) <> 64 then
    raise exception 'embedding debe tener 64 dimensiones';
  end if;
  insert into public.senda_memorias (user_id, texto, embedding, modulo)
  values (p_user_id, btrim(p_texto), p_embedding::vector, coalesce(nullif(btrim(p_modulo), ''), 'general'))
  returning id into v_id;
  return v_id;
end;
$$;

-- ── RPC: buscar por similitud ─────────────────────────────────────────────
create or replace function public.rpc_senda_memoria_buscar(
  p_user_id uuid,
  p_embedding double precision[],
  p_limite integer default 5,
  p_modulo text default null
)
returns table (
  id uuid,
  texto text,
  modulo text,
  created_at timestamptz,
  distancia double precision
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'forbidden';
  end if;
  if p_embedding is null or array_length(p_embedding, 1) <> 64 then
    raise exception 'embedding debe tener 64 dimensiones';
  end if;
  return query
  select m.id, m.texto, m.modulo, m.created_at,
         (m.embedding <=> p_embedding::vector)::double precision as distancia
  from public.senda_memorias m
  where m.user_id = p_user_id
    and (p_modulo is null or m.modulo = p_modulo)
  order by m.embedding <=> p_embedding::vector
  limit greatest(1, least(coalesce(p_limite, 5), 50));
end;
$$;

-- ── RPC: borrar ──────────────────────────────────────────────────────────
create or replace function public.rpc_senda_memoria_borrar(
  p_user_id uuid,
  p_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.rpc_habitos_secret_ok() then
    raise exception 'forbidden';
  end if;
  delete from public.senda_memorias
  where id = p_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
