// Normaliza signos de grado (° / º) y guiones tipográficos para que los
// patrones de búsqueda sean tolerantes a las variaciones del documento.
export function norm(text) {
  return text.replace(/[º]/g, "°").replace(/[–—]/g, "-");
}
