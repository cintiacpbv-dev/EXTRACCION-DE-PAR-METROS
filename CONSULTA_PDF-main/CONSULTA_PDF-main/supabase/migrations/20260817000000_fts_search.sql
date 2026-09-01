-- Búsqueda full-text con ranking (ts_rank), complementa match_document_chunks
-- (vectorial) para el retrieval híbrido. Usa el mismo índice GIN ya creado
-- sobre to_tsvector('spanish', content) en la migración inicial.

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
    ts_rank(to_tsvector('spanish', dc.content), websearch_to_tsquery('spanish', search_query)) as rank
  from document_chunks dc
  where to_tsvector('spanish', dc.content) @@ websearch_to_tsquery('spanish', search_query)
    and (filter_document_ids is null or dc.document_id = any (filter_document_ids))
  order by rank desc
  limit match_count;
$$;
