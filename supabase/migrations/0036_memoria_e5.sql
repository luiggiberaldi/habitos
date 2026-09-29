-- 0036_memoria_e5.sql — Memoria de Senda: embeddings e5 locales (384 dims).
--
-- OpenAI está bloqueado en Venezuela → se descartó text-embedding-3-small
-- como proveedor. Nuevo embedder: multilingual-e5-small corriendo LOCAL
-- (Xenova, vía @huggingface/transformers en scripts/senda-embed.mjs):
-- 384 dimensiones, CPU, determinista bit a bit, sin API key y sin red
-- después de la primera descarga del modelo.
--
-- Los vectores viejos de 64 dims eran del prototipo hash (0035), sin datos
-- reales: se purgan antes de cambiar el tipo de la columna. El índice HNSW
-- depende de la dimensión y se recrea.

-- Purgar filas del prototipo anterior (dimensión vieja)
delete from public.senda_memorias where vector_dims(embedding) <> 384;

-- Cambiar dimensión de la columna (el índice HNSW se recrea)
drop index if exists public.senda_memorias_embedding_idx;
alter table public.senda_memorias alter column embedding type vector(384);
create index if not exists senda_memorias_embedding_idx
  on public.senda_memorias using hnsw (embedding vector_cosine_ops);

-- ── RPC: guardar (valida 384) ────────────────────────────────────────────
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
  if p_embedding is null or array_length(p_embedding, 1) <> 384 then
    raise exception 'embedding debe tener 384 dimensiones';
  end if;
  insert into public.senda_memorias (user_id, texto, embedding, modulo)
  values (p_user_id, btrim(p_texto), p_embedding::vector, coalesce(nullif(btrim(p_modulo), ''), 'general'))
  returning id into v_id;
  return v_id;
end;
$$;

-- ── RPC: buscar por similitud (valida 384) ────────────────────────────────
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
  if p_embedding is null or array_length(p_embedding, 1) <> 384 then
    raise exception 'embedding debe tener 384 dimensiones';
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
