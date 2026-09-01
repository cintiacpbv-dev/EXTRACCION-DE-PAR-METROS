-- Cambia la configuración de full-text de 'spanish' a 'simple' (sin
-- reglas de idioma específicas) para que funcione razonablemente parejo
-- con documentos en cualquier idioma, no solo español.

drop index if exists idx_document_chunks_content_fts;
create index idx_document_chunks_content_fts on document_chunks
  using gin (to_tsvector('simple', content));

create or replace function search_document_chunks_fts (
  search_query text,
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
  rank float
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
    ts_rank(to_tsvector('simple', dc.content), websearch_to_tsquery('simple', search_query)) as rank
  from document_chunks dc
  where to_tsvector('simple', dc.content) @@ websearch_to_tsquery('simple', search_query)
    and (filter_document_ids is null or dc.document_id = any (filter_document_ids))
  order by rank desc
  limit match_count;
$$;
