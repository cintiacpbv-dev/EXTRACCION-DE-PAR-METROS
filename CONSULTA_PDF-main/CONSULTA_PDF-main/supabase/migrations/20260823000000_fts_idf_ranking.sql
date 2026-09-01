-- Bug real medido en producción: con OR + ts_rank (que NO pondera por
-- rareza), los términos comunes ahogan al específico. En este corpus de
-- 7017 fragmentos, "concurrente" aparece en 14 (0,2%) pero "validación"
-- en 307 y "información" en 189 -- así que al preguntar "¿existe
-- información sobre la validación concurrente?" los 14 fragmentos que de
-- verdad hablaban del tema no entraban ni al top 20.
--
-- Solución: puntuar cada fragmento por la suma de IDF -- ln(N/df) -- de
-- los términos que contiene. Un término raro pesa mucho más que uno
-- común, así que un fragmento con "concurrente" gana a uno que solo
-- repite "validación".

-- 1) tsvector almacenado en vez de calculado en cada consulta: sin esto,
--    puntuar término por término obligaría a recalcular el tsvector de
--    cada fragmento varias veces por consulta.
--
--    OJO: el cast explícito a ::regconfig es OBLIGATORIO. Sin él,
--    PostgreSQL resuelve la variante de to_tsvector que depende de la
--    configuración de sesión (STABLE, no IMMUTABLE) y rechaza toda la
--    sentencia con "generation expression is not immutable".
alter table document_chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('simple'::regconfig, content)) stored;

drop index if exists idx_document_chunks_content_fts;
create index if not exists idx_document_chunks_content_tsv
  on document_chunks using gin (content_tsv);

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
language plpgsql
stable
as $$
declare
  terms text[];
  total_chunks bigint;
  tsq tsquery;
begin
  -- Términos significativos: se descartan los de menos de 3 letras y las
  -- palabras vacías más frecuentes de español e inglés.
  select array_agg(x.term)
  into terms
  from unnest(
    regexp_split_to_array(
      lower(regexp_replace(coalesce(search_query, ''), '[^a-z0-9áéíóúüñ]+', ' ', 'gi')),
      '\s+'
    )
  ) as x(term)
  where length(x.term) >= 3
    and x.term not in (
      'las','los','del','por','para','con','una','uno','sobre','como','este','esta','esto',
      'esos','esas','ese','esa','que','qué','cual','cuál','cuales','cuáles','donde','dónde',
      'cuando','cuándo','quien','quién','porque','existe','existen','hay','haya','dice','dicen',
      'algo','alguna','alguno','algunas','algunos','todo','toda','todos','todas','mas','más',
      'muy','pero','sino','desde','hasta','entre','segun','según','tambien','también','solo',
      'sólo','ser','son','fue','han','has','sus','les','nos','the','and','for','with',
      'that','this','from','are','was','were','have','had','you','your','can','all',
      'any','its','not','but','how','what','which','when','where','who','why','does','did'
    );

  if terms is null or array_length(terms, 1) = 0 then
    return;
  end if;

  select count(*) into total_chunks from document_chunks;
  if total_chunks = 0 then
    return;
  end if;

  tsq := to_tsquery('simple', array_to_string(terms, ' | '));

  return query
  with term_idf as (
    -- Peso de cada término: ln(total / veces que aparece). Un término
    -- presente en casi todo el corpus tiende a 0; uno raro pesa mucho.
    select
      y.term as term,
      ln(
        total_chunks::float
        / greatest(
            (
              select count(*)
              from document_chunks c
              where c.content_tsv @@ to_tsquery('simple', y.term)
            ),
            1
          )
      ) as idf
    from unnest(terms) as y(term)
  )
  select
    dc.id::uuid as chunk_id,
    dc.document_id::uuid,
    dc.content::text,
    dc.page_start::int,
    dc.page_end::int,
    dc.chapter::text,
    dc.section::text,
    scored.score::float as rank
  from document_chunks dc
  join lateral (
    select coalesce(sum(ti.idf), 0) as score
    from term_idf ti
    where dc.content_tsv @@ to_tsquery('simple', ti.term)
  ) scored on true
  where dc.content_tsv @@ tsq
    and (filter_document_ids is null or dc.document_id = any (filter_document_ids))
  order by scored.score desc, ts_rank(dc.content_tsv, tsq) desc
  limit match_count;
end;
$$;
