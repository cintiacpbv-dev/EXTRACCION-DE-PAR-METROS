-- Consulta a tu PDF — esquema inicial
-- Proyecto de un solo propietario: sin auth.users, sin RLS multiusuario.
-- Requiere la extensión pgvector (disponible por defecto en Supabase).

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ────────────────────────────────────────────────────────────────
-- Colecciones (agrupaciones temáticas del usuario, ej. "Historia")
-- ────────────────────────────────────────────────────────────────
create table collections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────
-- Documentos
-- ────────────────────────────────────────────────────────────────
create table documents (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  author               text,
  file_hash            text not null unique, -- sha256 del archivo original, para deduplicación
  storage_path         text not null,        -- path en el bucket privado de Storage
  mime_type            text not null,
  file_size_bytes      bigint not null,
  page_count           integer,
  status               text not null default 'pending'
                         check (status in ('pending', 'processing', 'ready', 'error')),
  processing_progress  numeric(5,2) not null default 0, -- 0-100
  processing_error     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index idx_documents_status on documents (status);

-- ────────────────────────────────────────────────────────────────
-- Puente documentos ↔ colecciones (N:M)
-- ────────────────────────────────────────────────────────────────
create table collection_documents (
  collection_id uuid not null references collections (id) on delete cascade,
  document_id   uuid not null references documents (id) on delete cascade,
  primary key (collection_id, document_id)
);

-- ────────────────────────────────────────────────────────────────
-- Jobs de procesamiento (cola de ingesta)
-- ────────────────────────────────────────────────────────────────
create table processing_jobs (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references documents (id) on delete cascade,
  status             text not null default 'queued'
                        check (status in ('queued', 'processing', 'completed', 'failed')),
  current_stage      text, -- ej: 'extracting_text' | 'vision_ocr' | 'chunking' | 'embedding' | 'indexing'
  last_page_processed integer default 0,
  retry_count        integer not null default 0,
  error_message      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_processing_jobs_status on processing_jobs (status);
create index idx_processing_jobs_document_id on processing_jobs (document_id);

-- ────────────────────────────────────────────────────────────────
-- Páginas de documento (una fila por página física)
-- ────────────────────────────────────────────────────────────────
create table document_pages (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references documents (id) on delete cascade,
  page_number        integer not null,
  has_native_text    boolean not null default false,
  processing_method  text not null check (processing_method in ('text_extraction', 'vision')),
  raw_text           text,
  -- Solo se rellena para páginas procesadas por visión: lo usa el chunking
  -- para decidir el content_type de los chunks derivados de esta página.
  content_type_hint  text check (content_type_hint in ('text', 'table', 'image', 'formula', 'mixed')),
  created_at         timestamptz not null default now(),
  unique (document_id, page_number)
);

create index idx_document_pages_document_id on document_pages (document_id);

-- ────────────────────────────────────────────────────────────────
-- Chunks (unidad de recuperación semántica)
-- ────────────────────────────────────────────────────────────────
create table document_chunks (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references documents (id) on delete cascade,
  parent_chunk_id  uuid references document_chunks (id) on delete set null,
  page_start       integer not null,
  page_end         integer not null,
  chapter          text,
  section          text,
  content_type     text not null default 'text'
                      check (content_type in ('text', 'table', 'image', 'formula', 'mixed')),
  position         integer not null, -- orden dentro del documento
  content          text not null,
  content_hash     text not null,    -- hash del contenido, evita recalcular embeddings sin cambios
  token_count      integer,
  created_at       timestamptz not null default now()
);

create index idx_document_chunks_document_id on document_chunks (document_id);
create index idx_document_chunks_content_fts on document_chunks
  using gin (to_tsvector('spanish', content));
create unique index idx_document_chunks_content_hash on document_chunks (document_id, content_hash);

-- ────────────────────────────────────────────────────────────────
-- Embeddings (1 fila por chunk)
-- gemini-embedding-001 truncado a 1536 dims + normalización L2 manual
-- (límite del índice HNSW de pgvector: 2000 dims para tipo `vector`)
-- ────────────────────────────────────────────────────────────────
create table document_embeddings (
  chunk_id      uuid primary key references document_chunks (id) on delete cascade,
  embedding     vector(1536) not null,
  model_version text not null default 'gemini-embedding-001',
  created_at    timestamptz not null default now()
);

create index idx_document_embeddings_hnsw on document_embeddings
  using hnsw (embedding vector_cosine_ops);

-- ────────────────────────────────────────────────────────────────
-- Conversaciones y mensajes
-- ────────────────────────────────────────────────────────────────
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  title      text,
  scope_type text not null default 'library'
                check (scope_type in ('library', 'document', 'documents', 'collection')),
  scope_ids  uuid[] not null default '{}', -- document_id(s) o collection_id, según scope_type
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  confidence      numeric(4,3), -- solo para mensajes 'assistant'
  created_at      timestamptz not null default now()
);

create index idx_messages_conversation_id on messages (conversation_id);

-- ────────────────────────────────────────────────────────────────
-- Fuentes citadas por cada mensaje del asistente
-- ────────────────────────────────────────────────────────────────
create table message_sources (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references messages (id) on delete cascade,
  chunk_id         uuid not null references document_chunks (id) on delete cascade,
  document_id      uuid not null references documents (id) on delete cascade,
  page_number      integer not null,
  quote            text not null,
  relevance_score  numeric(5,4)
);

create index idx_message_sources_message_id on message_sources (message_id);

-- ────────────────────────────────────────────────────────────────
-- Búsqueda híbrida: función RPC para vector search (usada desde el backend)
-- ────────────────────────────────────────────────────────────────
create or replace function match_document_chunks (
  query_embedding vector(1536),
  match_count int default 12,
  filter_document_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  page_start int,
  page_end int,
  chapter text,
  section text,
  similarity float
)
language sql stable
as $$
  select
    dc.id as chunk_id,
    dc.document_id,
    dc.content,
    dc.page_start,
    dc.page_end,
    dc.chapter,
    dc.section,
    1 - (de.embedding <=> query_embedding) as similarity
  from document_embeddings de
  join document_chunks dc on dc.id = de.chunk_id
  where filter_document_ids is null or dc.document_id = any (filter_document_ids)
  order by de.embedding <=> query_embedding
  limit match_count;
$$;
