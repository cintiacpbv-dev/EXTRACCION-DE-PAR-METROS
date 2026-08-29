// Convierte los bloques de "OPCION ELEGIDA" en parámetros del cuadro.
//
// El detector genérico ve esos bloques como una sola línea suelta —
// "OPCION ELEGIDA = ü"— que no dice nada: ni qué se podía elegir ni qué se
// eligió. Aquí esa línea se sustituye por una fila por opción, con el equipo
// que se usó marcado como conforme y los demás con un guion, que es como los
// lista el informe de validación.

import { detectOpciones } from "./opciones.js";

// El valor que el cuadro entiende como "conforme" (ver valorParaCuadro en
// exportCuadros.js). Es el mismo carácter que el registro usa para sus vistos.
const CONFORME = "ü";
// Vacío es lo que el cuadro dibuja como "---------": aquí significa que ese
// equipo no se usó en este lote.
const NO_APLICA = "";

const ETIQUETA_RE = /OPCI[OÓ]N\s+ELEGIDA/i;

function idDe(seccion, texto) {
  return `opcion::${seccion || ""}::${texto}`
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w:-]/g, "");
}

/**
 * Sustituye cada "OPCION ELEGIDA" por una fila por opción.
 *
 * Los bloques que no se pudieron resolver —porque las casillas no se
 * distinguen entre sí— se dejan como estaban: es preferible la fila inútil de
 * siempre a decir que se usó un equipo que quizá no se usó.
 */
export function conOpciones(params, pages) {
  const bloques = detectOpciones(pages).filter((b) => b.resuelto);
  if (bloques.length === 0) return params;

  // Un bloque por sección: en el registro de acondicionado sólo hay uno, en la
  // operación de impresión de cajas.
  const porSeccion = new Map();
  for (const b of bloques) {
    if (!porSeccion.has(b.seccion)) porSeccion.set(b.seccion, b);
  }

  const salida = [];
  const usados = new Set();

  for (const p of params) {
    const bloque = ETIQUETA_RE.test(p.label) ? porSeccion.get(p.section) : null;
    if (!bloque || usados.has(bloque)) {
      salida.push(p);
      continue;
    }
    usados.add(bloque);

    for (const opcion of bloque.opciones) {
      salida.push({
        ...p,
        id: idDe(p.section, opcion.texto),
        // El equipo se nombra como lo nombra el registro ("LOTIZADORA HAPA
        // N°1", "CODIFICADORA 9040 SERIE 8400017U"). Traducirlo al nombre del
        // informe obligaría a mantener una tabla por producto, y con el
        // rótulo del registro cualquier equipo nuevo sale bien sin tocar nada.
        label: opcion.texto,
        baseLabel: opcion.texto,
        // El rango de operación de estos equipos no está en el registro —"Única
        // (79 cpm)", "Según lo observado" son criterio de quien valida—, así
        // que la casilla queda vacía en vez de decir "Referencial", que es lo
        // que el cuadro pone cuando el registro sí declara que no hay rango.
        setpoint: "",
        sinRango: true,
        unit: "",
        valueType: "text",
        value: opcion.elegida ? CONFORME : NO_APLICA,
      });
    }
  }

  return salida;
}
