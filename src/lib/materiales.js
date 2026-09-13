// Los materiales de un producto, reunidos para el Formato 6.
//
// De dónde salen. El mismo material está en dos sitios y no se escribe igual
// en los dos: la Orden de Producción lo trae con la descripción completa del
// maestro de materiales ("ALUMINIO 174mm DOLORAL CB 400mg CAP BLA"), y el
// Registro de Manufactura con la abreviada de su tabla de insumos ("ALU
// 174mm…"). El Formato 6 de la empresa usa la larga, así que cuando hay
// orden manda la orden, y el registro es el respaldo para cuando no la hay.
//
// Ojo con el orden de las etapas. El cuadro se lee de principio a fin del
// proceso —las materias primas de fabricación arriba, el material de
// embalaje de acondicionado abajo—, que es como está hecho el formato de la
// empresa y como se ordena también el Formato 8. Se reutiliza `ordenDeRol`,
// que ya sabe esa secuencia.

import { ordenDeRol } from "./personal.js";

/** Un material sale una sola vez aunque lo pidan dos etapas. */
function clave(m) {
  return String(m.codigo || "").trim();
}

/**
 * Qué descripción se queda cuando el mismo código viene de dos sitios.
 *
 * La más larga, que es la de la orden. No es un criterio estético: la
 * abreviada del registro recorta el nombre a mitad de palabra ("CJA DE
 * EMBALAJE", "ALU 174mm") y en un formato que va al expediente el material
 * tiene que quedar nombrado como lo nombra el maestro.
 */
function mejorDescripcion(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  return y.length > x.length ? y : x;
}

/**
 * Reúne los materiales de los documentos de un producto.
 *
 * `documentos` son los que ya están cargados en el análisis (registros y
 * órdenes mezclados, como los guarda la aplicación); `ordenes` son las que se
 * hayan subido aparte en el panel, que mandan sobre lo demás.
 */
export function materialesDe(documentos = [], ordenes = []) {
  const porCodigo = new Map();

  const anotar = (m, doc, deOrden) => {
    const codigo = clave(m);
    if (!codigo) return;
    const etapa = doc?.stage || doc?.meta?.stage || "";
    const previo = porCodigo.get(codigo);

    if (!previo) {
      porCodigo.set(codigo, {
        codigo,
        descripcion: String(m.descripcion || "").trim(),
        etapa,
        deOrden,
        // Las etapas donde interviene, para poder decirlo en el panel: el
        // mismo material aparece en la orden y en el registro de su etapa.
        etapas: etapa ? [etapa] : [],
      });
      return;
    }

    previo.descripcion = mejorDescripcion(previo.descripcion, m.descripcion);
    previo.deOrden = previo.deOrden || deOrden;
    // La etapa del primero que lo pidió es la que ordena la fila; las demás
    // se anotan para poder enseñarlas.
    if (etapa && !previo.etapas.includes(etapa)) previo.etapas.push(etapa);
    if (!previo.etapa && etapa) previo.etapa = etapa;
  };

  // Primero las órdenes subidas en el panel, luego las que ya estaban
  // cargadas, y al final los registros: así la descripción larga y la etapa
  // de la orden son las que quedan.
  for (const orden of ordenes) {
    for (const m of orden?.orden?.insumos || []) anotar(m, orden, true);
  }
  for (const doc of documentos) {
    if (doc?.kind !== "orden") continue;
    for (const m of doc.orden?.insumos || []) anotar(m, doc, true);
  }
  for (const doc of documentos) {
    if (doc?.kind === "orden") continue;
    for (const m of doc.insumos || []) anotar(m, doc, false);
  }

  return ordenarPorProceso([...porCodigo.values()]);
}

/**
 * De principio a fin del proceso: fabricación arriba, acondicionado abajo.
 *
 * Dentro de cada etapa se respeta el orden en que el documento los lista, que
 * es el de la fórmula: no se reordena por código ni por nombre, porque ese
 * orden dice algo (el principio activo primero, los excipientes después).
 */
export function ordenarPorProceso(materiales) {
  return materiales
    .map((m, i) => ({ m, i, orden: ordenDeRol(m.etapa) }))
    .sort((a, b) => a.orden - b.orden || a.i - b.i)
    .map((x) => x.m);
}

/**
 * El lote del formato, cuando no hay duda de cuál es.
 *
 * El Formato 6 es de un lote. Si lo cargado son las etapas de un mismo lote
 * —que es el caso normal: fabricación, envase y acondicionado comparten
 * número— se pone. Si hay varios, se deja en blanco para escribirlo: elegir
 * uno a ojo en un formato que va al expediente sería peor que dejar la línea.
 */
export function loteComun(documentos = []) {
  const lotes = [...new Set(documentos.map((d) => d?.lote || d?.meta?.lote).filter(Boolean))];
  return lotes.length === 1 ? lotes[0] : "";
}
