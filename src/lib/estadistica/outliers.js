// Detección de valores atípicos, como consulta aparte de "mira, esto se sale
// del resto" — nunca como una limpieza automática. Ninguna función de este
// archivo quita nada de la columna: sólo señala filas.
//
// Tres métodos, porque cada uno falla de una forma distinta:
//  - IQR (1.5×RIC): el de Minitab por defecto, el mismo que dibuja el boxplot
//    (ver resumenBoxplot en descriptiva.js) — aquí se repite el mismo cálculo
//    pero devolviendo la FILA de cada atípico, no sólo su valor.
//  - Z-score: cuántas desviaciones estándar se aleja de la media. Sensible a
//    los propios atípicos (la media y la SD que usa están contaminadas por
//    ellos), por eso conviene mirarlo junto con el siguiente.
//  - MAD (desviación absoluta mediana): la versión robusta del z-score — la
//    mediana y el MAD casi no se mueven aunque haya atípicos, así que no se
//    "esconden" a sí mismos como puede pasar con el z-score clásico.
import { valoresNumericos } from "./descriptiva.js";

/** Los índices de fila (0-based) que sí tienen un número, en orden. */
function filasConDato(values) {
  const filas = [];
  values.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) filas.push(i);
  });
  return filas;
}

function cuantil(ordenados, p) {
  const idx = (ordenados.length - 1) * p;
  const inf = Math.floor(idx);
  const sup = Math.ceil(idx);
  if (inf === sup) return ordenados[inf];
  return ordenados[inf] + (ordenados[sup] - ordenados[inf]) * (idx - inf);
}

export function outliersIQR(values) {
  const filas = filasConDato(values);
  const datos = filas.map((i) => values[i]);
  if (datos.length < 4) return { error: "Hacen falta al menos 4 valores para calcular cuartiles con sentido." };
  const ordenados = [...datos].sort((a, b) => a - b);
  const q1 = cuantil(ordenados, 0.25);
  const q3 = cuantil(ordenados, 0.75);
  const ric = q3 - q1;
  const limiteInferior = q1 - 1.5 * ric;
  const limiteSuperior = q3 + 1.5 * ric;
  const detectados = filas
    .map((fila, k) => ({ fila, valor: datos[k] }))
    .filter((d) => d.valor < limiteInferior || d.valor > limiteSuperior);
  return { metodo: "IQR (1.5×RIC)", n: datos.length, q1, q3, ric, limiteInferior, limiteSuperior, detectados };
}

export function outliersZScore(values, umbral = 3) {
  const filas = filasConDato(values);
  const datos = filas.map((i) => values[i]);
  if (datos.length < 3) return { error: "Hacen falta al menos 3 valores." };
  const media = datos.reduce((a, b) => a + b, 0) / datos.length;
  const desvEst = Math.sqrt(datos.reduce((acc, x) => acc + (x - media) ** 2, 0) / (datos.length - 1));
  if (desvEst === 0) return { error: "Todos los valores son idénticos: no hay variación que evaluar." };
  const detectados = filas
    .map((fila, k) => ({ fila, valor: datos[k], z: (datos[k] - media) / desvEst }))
    .filter((d) => Math.abs(d.z) > umbral);
  return { metodo: `Z-score (|z| > ${umbral})`, n: datos.length, media, desvEst, umbral, detectados };
}

/**
 * MAD: mediana de las desviaciones absolutas a la mediana, escalada por
 * 1.4826 para que sea comparable a una desviación estándar bajo normalidad
 * (el mismo factor que usa el paquete "robustbase" de referencia).
 */
export function outliersMAD(values, umbral = 3.5) {
  const filas = filasConDato(values);
  const datos = filas.map((i) => values[i]);
  if (datos.length < 3) return { error: "Hacen falta al menos 3 valores." };
  const ordenados = [...datos].sort((a, b) => a - b);
  const m = ordenados.length;
  const mediana = m % 2 === 0 ? (ordenados[m / 2 - 1] + ordenados[m / 2]) / 2 : ordenados[(m - 1) / 2];
  const desviaciones = datos.map((v) => Math.abs(v - mediana)).sort((a, b) => a - b);
  const mad = desviaciones.length % 2 === 0
    ? (desviaciones[desviaciones.length / 2 - 1] + desviaciones[desviaciones.length / 2]) / 2
    : desviaciones[(desviaciones.length - 1) / 2];
  if (mad === 0) return { error: "La desviación absoluta mediana es cero: más de la mitad de los valores son idénticos, el método no es aplicable." };
  const madEscalado = mad * 1.4826;
  const detectados = filas
    .map((fila, k) => ({ fila, valor: datos[k], puntuacion: (datos[k] - mediana) / madEscalado }))
    .filter((d) => Math.abs(d.puntuacion) > umbral);
  return { metodo: `MAD robusto (|puntuación| > ${umbral})`, n: datos.length, mediana, mad: madEscalado, umbral, detectados };
}

export function outliers(values, metodo) {
  const numericos = valoresNumericos(values);
  if (numericos.length === 0) return { error: "La columna no tiene datos numéricos." };
  if (metodo === "zscore") return outliersZScore(values);
  if (metodo === "mad") return outliersMAD(values);
  return outliersIQR(values);
}
