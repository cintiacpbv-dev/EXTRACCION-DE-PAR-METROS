// La bibliografía (Consulta PDF) vive en otra aplicación, con su propia base
// de datos; no hay una API propia a la que llamar desde aquí. Lo que sí
// permite esa aplicación es abrir su chat con una pregunta ya escrita —lee
// "?q=" y la envía sola en cuanto monta (ver su ChatView)—, así que "validar
// contra la biblioteca" se resuelve armando esa pregunta a partir de la
// tabla ya calculada y llevándola al chat embebido.

/**
 * A partir de la tabla de parámetros de un producto/etapa, arma una
 * pregunta en lenguaje llano con los parámetros críticos y sus rangos, para
 * preguntarle a la bibliografía si son consistentes con las guías.
 */
export function construirPreguntaValidacion(table, producto, stage) {
  if (!table?.sections?.length) return "";

  const criterios = table.sections.flatMap((s) =>
    s.rows
      .filter((r) => !r.banda && !r.enBlanco && (r.setpoint || r.sinRango === false))
      .map((r) => {
        const valor = [r.setpoint, r.unit].filter(Boolean).join(" ");
        return valor ? `${r.label} (${valor})` : r.label;
      })
  );

  if (!criterios.length) return "";

  const lista = criterios.slice(0, 15).join("; ");
  const etapa = stage ? ` en la etapa de ${stage}` : "";
  return (
    `Para el producto ${producto}${etapa}, ¿los siguientes parámetros críticos y sus rangos ` +
    `son consistentes con lo indicado en las guías de validación de procesos (ISPE, ICH)? ${lista}.`
  );
}
