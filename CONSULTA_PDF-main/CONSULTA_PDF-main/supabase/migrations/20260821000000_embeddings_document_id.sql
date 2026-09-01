-- Bug real encontrado en producción: la consulta para saber qué chunks
-- ya tienen embedding usaba `.in('chunk_id', [...todos los ids...])`.
-- Con documentos grandes (945 páginas -> 1000 chunks -> 1000 UUIDs en la
-- URL) esto supera el límite de longitud de query de PostgREST y
-- responde 400 Bad Request, bloqueando el documento para siempre.
--
-- Se agrega document_id directamente a document_embeddings (desnormalizado
-- a propósito) para poder filtrar por documento sin necesitar una lista
-- de IDs de ningún tamaño.

alter table document_embeddings
  add column document_id uuid references documents (id) on delete cascade;

-- Rellena document_id para embeddings ya existentes, vía el chunk.
update document_embeddings de
set document_id = dc.document_id
from document_chunks dc
where dc.id = de.chunk_id
  and de.document_id is null;

alter table document_embeddings
  alter column document_id set not null;

create index idx_document_embeddings_document_id on document_embeddings (document_id);
