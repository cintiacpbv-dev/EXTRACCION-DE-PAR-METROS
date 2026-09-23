// Cómo se identifica un parámetro y cómo se le pregunta a la bibliografía.
//
// Son las tres piezas que el Paso 2 del Procedimiento de Evaluación de
// Criticidad necesita de la etapa anterior: un identificador estable con el
// que casar respuestas, la pregunta que se le hace a Consulta PDF, y cómo
// queda escrita una cita.
//
// El resto de lo que vivía aquí —la clasificación simple de parámetro a
// atributo con un nivel de impacto— lo reemplazó el procedimiento completo:
// allí la criticidad la decide la severidad del atributo, fijada una sola
// vez, y no un nivel de impacto propuesto por parámetro. Ver
// lib/criticidad/modelo.js.

/** Un identificador estable para cada parámetro, con el que casar respuestas. */
export function idDe(parametro) {
  return `${parametro.etapa}|${parametro.seccion}|${parametro.magnitud}`
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, "-");
}

/**
 * La pregunta que se le hace a la bibliografía por un parámetro.
 *
 * Se le pide explícitamente que diga cuándo NO hay información: un RAG al que
 * no se le da esa salida redacta algo igual, y una relación inventada con
 * pinta de citada es peor que una casilla vacía.
 */
export function preguntaDe(parametro, { producto, atributos }) {
  const nombres = (atributos || []).map((a) => a.nombre).slice(0, 14).join(", ");
  return (
    `Producto: ${producto || "no indicado"}. ` +
    `Etapa: ${parametro.etapa}. Operación: ${parametro.seccion}. ` +
    `Parámetro de proceso: ${parametro.magnitud}` +
    (parametro.criterios?.length ? ` (criterio en el registro: ${parametro.criterios.join(" ; ")})` : "") +
    ".\n\n" +
    "¿A qué atributos de calidad del producto afecta este parámetro de proceso, y por qué mecanismo? " +
    (nombres ? `Los atributos que este proceso mide son: ${nombres}. ` : "") +
    "Indica también si se considera un parámetro crítico de proceso. " +
    "Cita el documento y la sección o página que lo sustenta. " +
    "Si en los documentos no hay información sobre esto, dilo claramente y no propongas nada por tu cuenta."
  );
}

/** Cómo queda una cita escrita: el documento y, cuando la hay, su página. */
function citaComoTexto(cita) {
  const documento = cita.documento || "Documento sin nombre";
  return cita.pagina ? `${documento} (p. ${cita.pagina})` : documento;
}

/** Las citas de una respuesta, en una línea, sin repetir documento. */
export function citasComoTexto(citas) {
  const vistas = new Set();
  const textos = [];
  for (const cita of citas || []) {
    const texto = citaComoTexto(cita);
    if (vistas.has(texto)) continue;
    vistas.add(texto);
    textos.push(texto);
    if (textos.length >= 3) break;
  }
  return textos.join(" · ");
}
