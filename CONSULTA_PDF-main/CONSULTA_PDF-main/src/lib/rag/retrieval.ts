import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { embedTexts } from '@/lib/ingestion/embeddings';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  content: string;
  pageStart: number;
  pageEnd: number;
  chapter: string | null;
  section: string | null;
  /** Score de fusión RRF -- no es una probabilidad, solo sirve para ordenar. */
  fusedScore: number;
  vectorSimilarity: number | null;
}

// Se recupera de más para que el modelo tenga material suficiente con
// que razonar (antes 12/12 -> 10 finales resultaba demasiado justo en
// documentos largos, y una sola pregunta podía quedarse sin el fragmento
// que sí tenía la respuesta).
const VECTOR_MATCH_COUNT = 20;
const FTS_MATCH_COUNT = 20;
const DEFAULT_MATCH_COUNT = 14;
const RRF_K = 60;
/** Umbral mínimo de similitud coseno para considerar un chunk "relevante". */
const MIN_VECTOR_SIMILARITY = 0.45;

interface RawMatch {
  chunk_id: string;
  document_id: string;
  content: string;
  page_start: number;
  page_end: number;
  chapter: string | null;
  section: string | null;
}

/**
 * Recuperación híbrida: combina búsqueda vectorial (significado) y
 * full-text (términos exactos/nombres propios/números) mediante Reciprocal
 * Rank Fusion. Prioriza precisión: si nada supera el umbral mínimo de
 * similitud vectorial, devuelve una lista vacía en vez de forzar
 * resultados poco relevantes.
 */
export async function hybridSearch(
  question: string,
  options: { documentIds?: string[]; matchCount?: number } = {},
): Promise<RetrievedChunk[]> {
  const supabase = getSupabaseAdmin();
  const filterDocumentIds = options.documentIds && options.documentIds.length > 0 ? options.documentIds : null;

  const [queryEmbedding] = await embedTexts([question], 'RETRIEVAL_QUERY');

  const [vectorResult, ftsResult] = await Promise.all([
    supabase.rpc('match_document_chunks', {
      query_embedding: queryEmbedding,
      match_count: VECTOR_MATCH_COUNT,
      filter_document_ids: filterDocumentIds,
    }),
    supabase.rpc('search_document_chunks_fts', {
      search_query: question,
      match_count: FTS_MATCH_COUNT,
      filter_document_ids: filterDocumentIds,
    }),
  ]);

  if (vectorResult.error) throw new Error(vectorResult.error.message);
  // La búsqueda full-text puede fallar si la query no es válida para
  // websearch_to_tsquery (p.ej. solo signos de puntuación) -- no es fatal,
  // el retrieval híbrido sigue funcionando solo con la parte vectorial.
  const ftsData = ftsResult.error ? [] : (ftsResult.data as (RawMatch & { rank: number })[]);

  const vectorData = (vectorResult.data as (RawMatch & { similarity: number })[]) ?? [];
  const vectorSimilarityByChunk = new Map(vectorData.map((r) => [r.chunk_id, r.similarity]));

  const fused = new Map<string, { match: RawMatch; score: number }>();

  vectorData.forEach((match, rank) => {
    const score = 1 / (RRF_K + rank + 1);
    fused.set(match.chunk_id, { match, score });
  });

  ftsData.forEach((match, rank) => {
    const score = 1 / (RRF_K + rank + 1);
    const existing = fused.get(match.chunk_id);
    if (existing) {
      existing.score += score;
    } else {
      fused.set(match.chunk_id, { match, score });
    }
  });

  const ranked = [...fused.values()]
    .filter(({ match }) => {
      const similarity = vectorSimilarityByChunk.get(match.chunk_id);
      // Un chunk que solo vino por full-text (sin match vectorial) se
      // acepta igual -- suele ser porque contiene un término exacto que el
      // embedding no capturó bien (nombres propios, números, siglas).
      return similarity === undefined || similarity >= MIN_VECTOR_SIMILARITY;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, options.matchCount ?? DEFAULT_MATCH_COUNT);

  return ranked.map(({ match, score }) => ({
    chunkId: match.chunk_id,
    documentId: match.document_id,
    content: match.content,
    pageStart: match.page_start,
    pageEnd: match.page_end,
    chapter: match.chapter,
    section: match.section,
    fusedScore: score,
    vectorSimilarity: vectorSimilarityByChunk.get(match.chunk_id) ?? null,
  }));
}
