// Identidad de producto tolerante a texto adicional en el nombre.
//
// El mismo registro de manufactura puede nombrar al producto de forma
// distinta según la presentación ("FLUIBRONCOL ORAL 600mg GRN",
// "...GRN SAC3g", "...GRN 3g CJA x20"), o traer texto extra por cómo quedó
// maquetado el PDF. Dos nombres se consideran el mismo producto cuando su
// primera palabra coincide: es la parte del nombre que nunca varía entre
// presentaciones de un mismo producto, y evita depender de coincidencias
// exactas de cadena que el texto adicional rompería.

/** Primera palabra del nombre del producto, normalizada para comparar. */
export function firstWord(producto) {
  const w = (producto || "").trim().split(/\s+/)[0] || "";
  return w.toUpperCase();
}

/**
 * Identificador de la "casilla" en la que vive un documento: mismo producto
 * (por primera palabra), mismo lote, misma etapa. Cargar un PDF que caiga en
 * la misma casilla actualiza ese documento en vez de crear uno nuevo, aunque
 * el nombre completo del producto no sea idéntico letra por letra.
 */
export function slotKey({ producto, lote, stage }) {
  return `${firstWord(producto)}::${lote}::${stage}`;
}
