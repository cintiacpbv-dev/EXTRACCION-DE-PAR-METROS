-- Bug real: con la configuración 'simple' no se eliminan palabras vacías,
-- y websearch_to_tsquery une TODOS los términos con AND. Una pregunta en
-- lenguaje natural ("¿Existe información sobre la validación concurrente?")
-- exigía que "existe" Y "información" Y "sobre" Y "la" Y "validación" Y
-- "concurrente" aparecieran en el MISMO fragmento -> 0 resultados, aunque
-- el contenido existiera. Verificado: la misma consulta sin las palabras
-- vacías devolvía 5 resultados.
--
-- Ahora se extraen los términos significativos y se unen con OR. ts_rank
-- se encarga de subir los fragmentos que cubren más términos (y más
-- específicos), en vez de exigir coincidencia total.

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
  tsq tsquery;
begin
  -- Palabras vacías frecuentes en español e inglés: no aportan al
  -- ranking y solo generan ruido cuando se buscan con OR.
  select array_agg(t)
  into terms
  from unnest(
    regexp_split_to_array(
      lower(regexp_replace(coalesce(search_query, ''), '[^a-z0-9áéíóúüñ]+', ' ', 'gi')),
      '\s+'
    )
  ) as t
  where length(t) >= 3
    and t not in (
      'las','los','del','por','para','con','una','uno','sobre','como','este','esta','esto',
      'esos','esas','ese','esa','que','qué','cual','cuál','cuales','cuáles','donde','dónde',
      'cuando','cuándo','quien','quién','porque','por qué','existe','existen','hay','haya',
      'algo','alguna','alguno','algunas','algunos','todo','toda','todos','todas','mas','más',
      'muy','pero','sino','desde','hasta','entre','segun','según','tambien','también','solo',
      'sólo','ser','son','fue','han','has','sus','sus','les','nos','the','and','for','with',
      'that','this','from','are','was','were','have','has','had','you','your','can','all',
      'any','its','not','but','how','what','which','when','where','who','why','does','did'
    );

  if terms is null or array_length(terms, 1) = 0 then
    return;
  end if;

  tsq := to_tsquery('simple', array_to_string(terms, ' | '));

  -- Los tipos deben coincidir EXACTAMENTE con los de RETURNS TABLE:
  -- plpgsql (a diferencia de una función en SQL plano) no inserta
  -- conversiones implícitas en RETURN QUERY. ts_rank devuelve `real`
  -- (float4) y aquí se declara `float` (float8), así que hay que
  -- convertirlo a mano o falla con "structure of query does not match
  -- function result type".
  return query
  select
    dc.id as chunk_id,
    dc.document_id,
    dc.content,
    dc.page_start::int,
    dc.page_end::int,
    dc.chapter,
    dc.section,
    ts_rank(to_tsvector('simple', dc.content), tsq)::float as rank
  from document_chunks dc
  where to_tsvector('simple', dc.content) @@ tsq
    and (filter_document_ids is null or dc.document_id = any (filter_document_ids))
  order by ts_rank(to_tsvector('simple', dc.content), tsq) desc
  limit match_count;
end;
$$;
