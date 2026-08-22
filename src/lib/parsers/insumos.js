// Lector de la sección INSUMOS del Registro de Manufactura: la tabla de
// materiales realmente usados en la etapa (cajas, etiquetas y folletos en
// Acondicionado; alupol, palupol y PVC en Envase; materias primas y
// principios activos en Fabricación).
//
// No es el patrón "etiqueta + relleno + valor" que usa el detector genérico:
// es una tabla de columnas reales (Descripción, Código, Cantidad, UM,
// Cantidad recibida, UM, Bulto), así que necesita su propio lector, igual
// que la orden de producción.

import { norm } from "./utils.js";

const SECCION_RE = /^\d+(\.\d+)*\.-\s*INSUMOS\b/i;
const VERIFICADO_RE = /^VERIFICADO\s+POR/i;
const CABECERA_RE = /^\(Colocar\b|^\(CP\)$/i;

// "<descripción> <código 10 dígitos> <cantidad> <UM> <cant. recibida> <UM> [<bulto>]"
// La cantidad puede traer un espacio como separador de miles ("65 980.000"),
// por eso admite un segundo grupo de dígitos opcional.
const FILA_MATERIAL_RE =
  /^(.+?)\s+(\d{10})\s+(\d[\d.,]*(?:\s+\d[\d.,]*)?)\s+([A-Z]{1,4})\s+(\d[\d.,]*(?:\s+\d[\d.,]*)?)\s+([A-Z]{1,4})(?:\s+(\d{1,4}))?$/;

function num(valor) {
  if (valor === null || valor === undefined) return null;
  const n = parseFloat(String(valor).replace(/\s+/g, "").replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

/** Materiales de la sección INSUMOS, tal como los declara el propio registro. */
export function detectInsumos(pages) {
  const materiales = [];

  for (const page of pages) {
    let dentro = false;

    for (const linea of page.lines.map((l) => norm(l.text))) {
      if (!dentro) {
        if (SECCION_RE.test(linea)) dentro = true;
        continue;
      }

      if (VERIFICADO_RE.test(linea)) {
        dentro = false;
        continue;
      }

      const m = linea.match(FILA_MATERIAL_RE);
      if (m) {
        materiales.push({
          descripcion: m[1].replace(/\s{2,}/g, " ").trim(),
          codigo: m[2],
          cantidad: num(m[3]),
          unidad: m[4],
          cantidadRecibida: num(m[5]),
          unidadRecibida: m[6],
          bulto: m[7] ? num(m[7]) : null,
        });
        continue;
      }

      // La descripción se parte en dos renglones cuando no cabe en uno; el
      // resto son las etiquetas de la cabecera de la tabla, que aparecen
      // antes del primer material y no hay que confundir con continuaciones.
      if (materiales.length > 0 && !CABECERA_RE.test(linea)) {
        materiales[materiales.length - 1].descripcion += ` ${linea}`;
      }
    }
  }

  return materiales;
}
