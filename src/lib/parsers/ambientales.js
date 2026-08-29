// Distingue las condiciones ambientales del inicio de las del final.
//
// El registro las anota dos veces —una antes de arrancar la etapa y otra
// antes de cerrarla— con exactamente las mismas etiquetas: "TEMPERATURA
// (15 °C - 30 °C)" y "HUMEDAD RELATIVA (% Referencial)". Sin distinguirlas,
// el informe enseña una sola lectura y se pierde la otra, que es justo la
// que dice si la sala se mantuvo en rango durante todo el proceso.
//
// Además, la segunda suele caer en una sección equivocada: aparece después
// del paso "EN CASO DE INCREMENTO DE CAPACIDAD Y/O CAMBIO DE TURNO", que el
// detector toma por encabezado, así que hereda ese título aunque no tenga
// nada que ver. Aquí se recolocan las dos bajo la etapa a la que pertenecen.

const AMBIENTAL_RE = /^(TEMPERATURA|HUMEDAD\s+RELATIVA)\b/i;

/**
 * En qué sección quedan las dos lecturas: en la de la primera, que es la que
 * el registro sitúa bien —dentro de la operación, justo antes de arrancar—.
 * La segunda es la que se descoloca, porque cae detrás de un paso que el
 * detector confunde con un encabezado.
 */
function seccionDestino(params, primerIndice) {
  return params[primerIndice]?.section || null;
}

/**
 * Marca cada lectura ambiental como de inicio o de final.
 *
 * Se toman en el orden del documento: la primera pareja es la del inicio y la
 * última la del final. Si sólo hay una, se deja como está — no se puede saber
 * si es la de entrada o la de salida, y ponerle una etiqueta sería inventarlo.
 */
export function conAmbientales(params) {
  const indices = params
    .map((p, i) => (AMBIENTAL_RE.test(p.label) ? i : -1))
    .filter((i) => i >= 0);

  // Dos lecturas por pareja (temperatura y humedad): con una sola pareja no
  // hay inicio y final que distinguir.
  if (indices.length < 4) return params;

  const primeras = indices.slice(0, 2);
  const destino = seccionDestino(params, primeras[0]);
  const ultimas = indices.slice(-2);

  const etiquetar = (i, momento) => {
    const p = params[i];
    return {
      ...p,
      id: `${p.id}::${momento.toLowerCase()}`,
      label: `${p.label} (${momento})`,
      baseLabel: p.baseLabel || p.label,
      section: destino || p.section,
    };
  };

  const salida = params.slice();
  for (const i of primeras) salida[i] = etiquetar(i, "INICIO");
  for (const i of ultimas) salida[i] = etiquetar(i, "FINAL");

  return salida;
}
