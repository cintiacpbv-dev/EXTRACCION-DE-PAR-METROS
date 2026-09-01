import { withGemini, aiConfig } from '@/lib/ai/gemini';

/**
 * L2-normaliza un vector truncado. gemini-embedding-001 usa Matryoshka
 * Representation Learning: al pedir menos de 3072 dimensiones el vector
 * resultante no viene normalizado por defecto y hay que normalizarlo a
 * mano para que la similitud coseno en pgvector sea correcta.
 */
function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

const EMBED_BATCH_SIZE = 20;

/**
 * Genera embeddings para un lote de textos. Devuelve los vectores en el
 * mismo orden que los textos de entrada, normalizados y truncados a
 * `aiConfig.embeddingDimensions` (1536, límite práctico del índice HNSW
 * de pgvector).
 */
export async function embedTexts(
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const response = await withGemini((ai) =>
      ai.models.embedContent({
        model: aiConfig.models.embedding,
        contents: batch,
        config: {
          taskType,
          outputDimensionality: aiConfig.embeddingDimensions,
        },
      }),
    );

    for (const embedding of response.embeddings ?? []) {
      const values = embedding.values ?? [];
      results.push(l2Normalize(values));
    }
  }

  return results;
}
