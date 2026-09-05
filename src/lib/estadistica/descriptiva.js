// Estadística descriptiva sobre una columna de la hoja de trabajo.
//
// Se apoya en simple-statistics (mean, sampleStandardDeviation, etc.), ya
// verificadas contra el ejemplo de libro de texto [2,4,4,4,5,5,7,9] →
// media 5, mediana 4.5, desv. estándar muestral ≈ 2.138 — no fórmulas
// propias reinventadas, que es donde se cuelan errores silenciosos.
import * as ss from "simple-statistics";

export function valoresNumericos(values) {
  return values.filter((v) => typeof v === "number" && !Number.isNaN(v));
}

/**
 * Resumen descriptivo de una columna numérica. Devuelve `vacio: true`
 * cuando no hay ningún valor numérico (columna de texto, o toda en blanco).
 */
export function estadisticaDescriptiva(values) {
  const n = values.length;
  const numericos = valoresNumericos(values);
  const faltantes = n - numericos.length;

  if (numericos.length === 0) {
    return { n, faltantes, vacio: true };
  }

  const ordenados = [...numericos].sort((a, b) => a - b);
  const q1 = ss.quantileSorted(ordenados, 0.25);
  const q3 = ss.quantileSorted(ordenados, 0.75);

  return {
    n,
    faltantes,
    vacio: false,
    media: ss.mean(numericos),
    mediana: ss.median(numericos),
    desvEst: numericos.length > 1 ? ss.sampleStandardDeviation(numericos) : 0,
    varianza: numericos.length > 1 ? ss.sampleVariance(numericos) : 0,
    minimo: ordenados[0],
    maximo: ordenados[ordenados.length - 1],
    rango: ordenados[ordenados.length - 1] - ordenados[0],
    q1,
    q3,
    rangoIntercuartil: q3 - q1,
    asimetria: numericos.length > 2 ? ss.sampleSkewness(numericos) : null,
  };
}

/**
 * Los cinco puntos de un boxplot (mínimo, Q1, mediana, Q3, máximo) más los
 * valores atípicos por la regla de 1.5×RIC — la misma que usa Minitab por
 * defecto para marcar puntos fuera de los bigotes.
 */
export function resumenBoxplot(values) {
  const numericos = valoresNumericos(values);
  if (numericos.length === 0) return null;
  const ordenados = [...numericos].sort((a, b) => a - b);
  const q1 = ss.quantileSorted(ordenados, 0.25);
  const mediana = ss.quantileSorted(ordenados, 0.5);
  const q3 = ss.quantileSorted(ordenados, 0.75);
  const ric = q3 - q1;
  const bigoteInf = Math.max(ordenados[0], q1 - 1.5 * ric);
  const bigoteSup = Math.min(ordenados[ordenados.length - 1], q3 + 1.5 * ric);
  const atipicos = ordenados.filter((v) => v < bigoteInf || v > bigoteSup);
  return { minimo: bigoteInf, q1, mediana, q3, maximo: bigoteSup, atipicos };
}

/**
 * Bins de un histograma por la regla de Sturges, como referencia razonable
 * por defecto. "rango" fuerza el mínimo/máximo del eje en vez de tomarlo de
 * los datos — hace falta para el histograma de capacidad, donde los
 * límites de especificación pueden caer fuera del rango de los datos (un
 * proceso capaz, centrado, es justo cuando eso pasa) y aun así tienen que
 * verse dentro del gráfico.
 */
export function binsHistograma(values, numBins, rango) {
  const numericos = valoresNumericos(values);
  if (numericos.length === 0) return { bins: [], ancho: 0, inicio: 0 };
  const minimo = Math.min(rango?.minimo ?? Infinity, ...numericos);
  const maximo = Math.max(rango?.maximo ?? -Infinity, ...numericos);
  const n = numBins || Math.max(1, Math.ceil(Math.log2(numericos.length) + 1));
  const ancho = maximo === minimo ? 1 : (maximo - minimo) / n;
  const bins = new Array(n).fill(0);
  for (const v of numericos) {
    let idx = Math.floor((v - minimo) / ancho);
    if (idx >= n) idx = n - 1;
    if (idx < 0) idx = 0;
    bins[idx] += 1;
  }
  return { bins, ancho, inicio: minimo };
}
