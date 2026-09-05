// Diseño de Experimentos: factoriales completos 2^k.
//
// Los efectos se calculan por contraste directo —promedio de la respuesta
// con el término en +1 menos el promedio con el término en −1—, no por
// regresión con matrices: en un diseño factorial completo las columnas
// codificadas (±1) son ortogonales entre sí, así que el contraste da
// exactamente el mismo resultado que una regresión de mínimos cuadrados,
// sin necesitar álgebra matricial ni una librería para invertir nada.
import jStat from "jstat";

const LETRAS = ["A", "B", "C", "D", "E"];

/**
 * Genera la tabla de corridas de un factorial completo 2^k, en orden
 * estándar (de Yates): el factor A cambia de signo cada fila, B cada 2
 * filas, C cada 4, etc. Con réplicas, el bloque completo se repite tantas
 * veces como réplicas se pidan.
 *
 * El orden de corrida sugerido sí se aleatoriza aparte —es buena práctica
 * experimental, para que una deriva del proceso en el tiempo no se
 * confunda con el efecto de un factor—, aunque las filas de la hoja
 * queden en orden estándar para que se lean y verifiquen más fácil.
 */
export function generarDisenoFactorial(k, replicas = 1) {
  if (!Number.isInteger(k) || k < 2 || k > 5) return { error: "El número de factores debe ser un entero entre 2 y 5." };
  if (!Number.isInteger(replicas) || replicas < 1) return { error: "El número de réplicas debe ser un entero de al menos 1." };

  const factores = LETRAS.slice(0, k);
  const numCorridas = 2 ** k;
  const base = [];
  for (let fila = 0; fila < numCorridas; fila++) {
    const combinacion = {};
    for (let f = 0; f < k; f++) {
      combinacion[factores[f]] = Math.floor(fila / 2 ** f) % 2 === 0 ? -1 : 1;
    }
    base.push(combinacion);
  }

  const corridas = [];
  for (let r = 1; r <= replicas; r++) {
    for (const combinacion of base) corridas.push({ ...combinacion, Réplica: r });
  }

  const ordenAleatorio = [...Array(corridas.length).keys()];
  for (let i = ordenAleatorio.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ordenAleatorio[i], ordenAleatorio[j]] = [ordenAleatorio[j], ordenAleatorio[i]];
  }
  corridas.forEach((c, i) => {
    c["Orden de corrida"] = ordenAleatorio[i] + 1;
  });

  return { factores, corridas };
}

/** Todas las combinaciones de "tamano" índices distintos de 0..k-1, en orden. */
function combinacionesDeIndices(k, tamano) {
  const resultado = [];
  function recorrer(inicio, actual) {
    if (actual.length === tamano) {
      resultado.push([...actual]);
      return;
    }
    for (let i = inicio; i < k; i++) {
      actual.push(i);
      recorrer(i + 1, actual);
      actual.pop();
    }
  }
  recorrer(0, []);
  return resultado;
}

/**
 * Efectos principales y de interacción de un factorial 2^k ya con
 * resultados. Si hay corridas repetidas con exactamente la misma
 * combinación de factores (réplicas de verdad, no sólo "Réplica" en el
 * nombre), su variación se usa como error puro para dar significancia
 * (t, valor p) a cada efecto; sin repetición no hay con qué estimar el
 * error, así que sólo se devuelve la magnitud de los efectos, sin p —
 * mostrar una significancia inventada sería peor que no mostrar ninguna.
 */
export function analizarFactorial(columnasFactor, respuesta) {
  const k = columnasFactor.length;
  if (k < 2) return { error: "Hacen falta al menos 2 columnas de factor." };
  if (k > 5) return { error: "Como máximo 5 factores." };

  const filas = [];
  const n = Math.min(...columnasFactor.map((c) => c.values.length), respuesta.length);
  for (let i = 0; i < n; i++) {
    const y = respuesta[i];
    const signos = columnasFactor.map((c) => c.values[i]);
    if (typeof y !== "number") continue;
    if (signos.some((s) => s !== 1 && s !== -1)) continue;
    filas.push({ signos, y });
  }
  if (filas.length < 2 ** k) return { error: `Hacen falta más corridas completas: un factorial de ${k} factores necesita al menos ${2 ** k}.` };

  const nombres = columnasFactor.map((c) => c.name);
  const terminos = [];
  for (let orden = 1; orden <= k; orden++) terminos.push(...combinacionesDeIndices(k, orden));

  const efectos = terminos.map((combo) => {
    const etiqueta = combo.map((i) => nombres[i]).join("·");
    let sumaPos = 0,
      sumaNeg = 0,
      nPos = 0,
      nNeg = 0;
    for (const fila of filas) {
      const signoTermino = combo.reduce((acc, i) => acc * fila.signos[i], 1);
      if (signoTermino === 1) {
        sumaPos += fila.y;
        nPos++;
      } else {
        sumaNeg += fila.y;
        nNeg++;
      }
    }
    return { etiqueta, orden: combo.length, efecto: sumaPos / nPos - sumaNeg / nNeg };
  });

  // Error puro: filas con exactamente la misma combinación de signos.
  const grupos = new Map();
  for (const fila of filas) {
    const clave = fila.signos.join(",");
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(fila.y);
  }
  let sceError = 0;
  let glError = 0;
  for (const valores of grupos.values()) {
    if (valores.length < 2) continue;
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    sceError += valores.reduce((acc, v) => acc + (v - media) ** 2, 0);
    glError += valores.length - 1;
  }
  const hayReplicas = glError > 0;
  const msError = hayReplicas ? sceError / glError : null;

  if (hayReplicas) {
    // Var(efecto) = 4·σ²/N: el efecto es la resta de dos medias, cada una
    // sobre N/2 observaciones, y Var(media) = σ²/(N/2), así que
    // Var(diferencia) = 2·σ²/(N/2) = 4·σ²/N.
    const N = filas.length;
    const errorEst = Math.sqrt((4 * msError) / N);
    for (const e of efectos) {
      e.errorEst = errorEst;
      e.t = e.efecto / errorEst;
      e.gl = glError;
      e.valorP = 2 * (1 - jStat.studentt.cdf(Math.abs(e.t), glError));
    }
  }

  efectos.sort((a, b) => Math.abs(b.efecto) - Math.abs(a.efecto));
  return { efectos, hayReplicas, msError, glError, n: filas.length };
}
