// Identidad de producto tolerante a texto adicional en el nombre.
//
// El mismo registro de manufactura puede nombrar al producto de forma
// distinta según la presentación ("FLUIBRONCOL ORAL 600mg GRN",
// "...GRN SAC3g", "...GRN 3g CJA x20"), o traer texto extra por cómo quedó
// maquetado el PDF. Dos nombres se consideran el mismo producto cuando su
// primera palabra coincide: es la parte del nombre que nunca varía entre
// presentaciones de un mismo producto, y evita depender de coincidencias
// exactas de cadena que el texto adicional rompería.

import { esMuestraMedica } from "./muestraMedica.js";

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
 *
 * La muestra médica forma parte de la casilla porque un mismo lote fabrica a
 * la vez producto de venta y muestra médica, en la misma etapa: el lote
 * 2036006 tiene "…3g CJA x20" y "…3g CJA x2MM" bajo ACONDICIONADO. Sin
 * distinguirlas, ambas caerían en la misma casilla y una borraría a la otra.
 */
export function slotKey({ producto, lote, stage }) {
  const muestra = esMuestraMedica(producto) ? "::MM" : "";
  return `${firstWord(producto)}::${lote}::${stage}${muestra}`;
}

/**
 * Un lote y etapa tienen dos documentos distintos y complementarios: el
 * registro de manufactura (parámetros y personal de planta) y la orden de
 * producción (materiales con su lote, rendimiento oficial y fechas). Se
 * guardan en casillas separadas para que cargar uno no reemplace al otro.
 */
export function documentKey(doc) {
  return `${slotKey(doc)}::${doc.kind || "registro"}`;
}
