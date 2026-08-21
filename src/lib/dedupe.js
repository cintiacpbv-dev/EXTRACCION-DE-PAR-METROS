// Huella de contenido de un documento procesado, usada para detectar PDF
// duplicados aunque lleguen con nombres de archivo distintos (p. ej. el mismo
// registro exportado dos veces, o "copia de..."). No se compara el archivo
// en bruto: se compara lo que el detector realmente extrajo, así que dos PDF
// "que contienen lo mismo" se reconocen aunque difieran en metadatos internos
// del PDF (fecha de exportación, etc.) que no cambian ningún parámetro.

/** Cadena estable e independiente del orden, a partir de los parámetros detectados. */
function canonicalParams(params) {
  return params
    .map((p) => `${p.section}|${p.label}|${p.value}`)
    .sort()
    .join("\n");
}

/** SHA-256 en hexadecimal de la huella de contenido de un documento. */
export async function computeContentHash(params) {
  const text = canonicalParams(params);
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Busca, entre los documentos ya cargados, uno con la misma huella de
 * contenido. No se guarda la huella en cada documento (evita tocar el
 * esquema de Supabase); se recalcula al vuelo, que con pocas decenas de
 * parámetros por documento es prácticamente instantáneo.
 */
export async function findDuplicateDocument(documents, contentHash) {
  for (const doc of documents) {
    if ((await computeContentHash(doc.params)) === contentHash) return doc;
  }
  return null;
}
