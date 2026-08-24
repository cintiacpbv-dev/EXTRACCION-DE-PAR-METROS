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

// Cualquier otro apartado numerado ("3.-CONDICIONES AMBIENTALES") cierra la
// sección. Hace falta porque la tabla puede seguir en la página siguiente y
// ya no se puede dar por terminada al acabarse la página.
const OTRA_SECCION_RE = /^\d+(\.\d+)*\.-\s*\S/;

// "<descripción> <código 10 dígitos> <cantidad> <UM> <cant. recibida> <UM> [<bulto>]"
// La cantidad puede traer un espacio como separador de miles ("65 980.000"),
// por eso admite un segundo grupo de dígitos opcional.
//
// Las unidades se aceptan en minúscula además de en mayúscula: conviven en el
// mismo registro ("1.356 KGP 1 356.000 g", "373.631 kg 373.631 kg"), y
// exigirlas en mayúscula dejaba sin materiales a Fabricación y Envase, donde
// se pesa en kilos y gramos.
const FILA_MATERIAL_RE =
  /^(.+?)\s+(\d{10})\s+(\d[\d.,]*(?:\s+\d[\d.,]*)?)\s+([A-Za-z]{1,4})\s+(\d[\d.,]*(?:\s+\d[\d.,]*)?)\s+([A-Za-z]{1,4})(?:\s+(\d{1,4}))?$/;

// Margen para dar dos líneas por alineadas en la misma columna. Las filas de
// material empiezan todas en la misma X; lo que viene del encabezado que se
// repite en cada página (el nombre del producto, el nº de orden, el lote)
// arranca en otra bien distinta.
const TOLERANCIA_X = 3;

function num(valor) {
  if (valor === null || valor === undefined) return null;
  const n = parseFloat(String(valor).replace(/\s+/g, "").replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

/** Materiales de la sección INSUMOS, tal como los declara el propio registro. */
export function detectInsumos(pages) {
  const materiales = [];

  // La sección no siempre cabe en una página: en Fabricación el título queda
  // al final de una y la tabla empieza en la siguiente, después de que se
  // repita el encabezado del documento. Por eso el estado se mantiene entre
  // páginas en vez de reiniciarse con cada una.
  let dentro = false;
  let xFilas = null;

  for (const page of pages) {
    for (const linea of page.lines) {
      const texto = norm(linea.text);

      if (!dentro) {
        if (SECCION_RE.test(texto)) dentro = true;
        continue;
      }

      if (VERIFICADO_RE.test(texto) || OTRA_SECCION_RE.test(texto)) {
        dentro = false;
        continue;
      }

      const m = texto.match(FILA_MATERIAL_RE);
      if (m) {
        if (xFilas === null) xFilas = linea.x0;
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

      // La descripción se parte en dos renglones cuando no cabe en uno. Se
      // reconoce porque el segundo renglón empieza en la misma columna que la
      // fila del material; así no se le pega el encabezado que el documento
      // repite al cambiar de página, ni las etiquetas de la cabecera de la
      // tabla, que además aparecen antes del primer material.
      if (materiales.length === 0 || CABECERA_RE.test(texto)) continue;
      if (xFilas !== null && Math.abs(linea.x0 - xFilas) > TOLERANCIA_X) continue;

      materiales[materiales.length - 1].descripcion += ` ${texto}`;
    }
  }

  return materiales;
}
