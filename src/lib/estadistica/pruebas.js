// Pruebas de hipótesis y correlación.
//
// Todas devuelven { ...estadísticos, t o z o F, gl, valorP }, listas para
// tabla de resultados. El valor p siempre es bilateral (dos colas), que es
// el que se usa por defecto en Minitab salvo que se pida lo contrario.
//
// Dos muestras independientes usa Welch (varianzas no necesariamente
// iguales) en vez de la t de Student clásica: es el valor por defecto de
// Minitab ("2-Sample t") desde hace años, y es más seguro cuando no se ha
// comprobado que las varianzas sean iguales — que es el caso general aquí,
// donde los datos los trae la propia persona sin haber corrido antes una
// prueba de varianzas.
import * as ss from "simple-statistics";
import jStat from "jstat";
import { valoresNumericos } from "./descriptiva.js";

function pBilateralT(t, gl) {
  return 2 * (1 - jStat.studentt.cdf(Math.abs(t), gl));
}

function pBilateralZ(z) {
  return 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1));
}

/** t de una muestra: ¿la media es distinta de mu0? */
export function tUnaMuestra(values, mu0) {
  const datos = valoresNumericos(values);
  const n = datos.length;
  if (n < 2) return { n, error: "Hacen falta al menos 2 valores." };
  const media = ss.mean(datos);
  const desvEst = ss.sampleStandardDeviation(datos);
  const errorEst = desvEst / Math.sqrt(n);
  const t = (media - mu0) / errorEst;
  const gl = n - 1;
  return { n, media, desvEst, errorEst, mu0, t, gl, valorP: pBilateralT(t, gl) };
}

/** t de dos muestras independientes (Welch, varianzas no asumidas iguales). */
export function tDosMuestras(valuesA, valuesB) {
  const a = valoresNumericos(valuesA);
  const b = valoresNumericos(valuesB);
  if (a.length < 2 || b.length < 2) return { error: "Cada columna necesita al menos 2 valores." };
  const nA = a.length;
  const nB = b.length;
  const mediaA = ss.mean(a);
  const mediaB = ss.mean(b);
  const varA = ss.sampleVariance(a);
  const varB = ss.sampleVariance(b);
  const seA = varA / nA;
  const seB = varB / nB;
  const errorEst = Math.sqrt(seA + seB);
  const t = (mediaA - mediaB) / errorEst;
  // Grados de libertad de Welch-Satterthwaite: no es un número entero.
  const gl = (seA + seB) ** 2 / (seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1));
  return {
    nA,
    nB,
    mediaA,
    mediaB,
    desvEstA: Math.sqrt(varA),
    desvEstB: Math.sqrt(varB),
    diferencia: mediaA - mediaB,
    errorEst,
    t,
    gl,
    valorP: pBilateralT(t, gl),
  };
}

/** t pareada: diferencia entre dos columnas medidas sobre los mismos sujetos/filas. */
export function tPareada(valuesA, valuesB) {
  const n = Math.min(valuesA.length, valuesB.length);
  const diferencias = [];
  for (let i = 0; i < n; i++) {
    const a = valuesA[i];
    const b = valuesB[i];
    if (typeof a === "number" && typeof b === "number") diferencias.push(a - b);
  }
  if (diferencias.length < 2) return { error: "Hacen falta al menos 2 pares de valores completos." };
  const resultado = tUnaMuestra(diferencias, 0);
  return { ...resultado, nPares: diferencias.length, mediaDiferencia: resultado.media };
}

/** F de varianzas: ¿las dos varianzas son distintas? */
export function pruebaVarianzas(valuesA, valuesB) {
  const a = valoresNumericos(valuesA);
  const b = valoresNumericos(valuesB);
  if (a.length < 2 || b.length < 2) return { error: "Cada columna necesita al menos 2 valores." };
  const varA = ss.sampleVariance(a);
  const varB = ss.sampleVariance(b);
  const F = varA / varB;
  const glA = a.length - 1;
  const glB = b.length - 1;
  const cola = jStat.centralF.cdf(F, glA, glB);
  const valorP = 2 * Math.min(cola, 1 - cola);
  return {
    nA: a.length,
    nB: b.length,
    varianzaA: varA,
    varianzaB: varB,
    desvEstA: Math.sqrt(varA),
    desvEstB: Math.sqrt(varB),
    F,
    glA,
    glB,
    valorP,
  };
}

/** Proporción de una muestra (aproximación normal): ¿la proporción es distinta de p0? */
export function proporcionUnaMuestra(values, valorExito, p0) {
  const noVacios = values.filter((v) => v != null && String(v).trim() !== "");
  const n = noVacios.length;
  if (n === 0) return { error: "La columna no tiene datos." };
  const exitos = noVacios.filter((v) => String(v).trim() === String(valorExito).trim()).length;
  const pMuestra = exitos / n;
  const errorEst = Math.sqrt((p0 * (1 - p0)) / n);
  const z = (pMuestra - p0) / errorEst;
  return { n, exitos, pMuestra, p0, errorEst, z, valorP: pBilateralZ(z) };
}

/**
 * ANOVA de un factor: ¿al menos una de las medias es distinta de las
 * demás? La extensión de la t de dos muestras a tres o más grupos —el
 * mismo análisis que corre "Stat > ANOVA > One-Way" en Minitab.
 */
export function anovaUnFactor(columnas) {
  const grupos = columnas.map((c) => ({ nombre: c.name, valores: valoresNumericos(c.values) })).filter((g) => g.valores.length > 0);
  if (grupos.length < 3) return { error: "Hacen falta al menos 3 columnas con datos numéricos." };
  if (grupos.some((g) => g.valores.length < 2)) return { error: "Cada columna necesita al menos 2 valores." };

  const todos = grupos.flatMap((g) => g.valores);
  const nTotal = todos.length;
  const mediaGlobal = todos.reduce((a, b) => a + b, 0) / nTotal;

  const resumenGrupos = grupos.map((g) => {
    const n = g.valores.length;
    const media = g.valores.reduce((a, b) => a + b, 0) / n;
    const desvEst = n > 1 ? Math.sqrt(g.valores.reduce((acc, x) => acc + (x - media) ** 2, 0) / (n - 1)) : 0;
    return { nombre: g.nombre, n, media, desvEst };
  });

  const k = grupos.length;
  let scEntre = 0;
  let scDentro = 0;
  grupos.forEach((g, i) => {
    const media = resumenGrupos[i].media;
    scEntre += g.valores.length * (media - mediaGlobal) ** 2;
    scDentro += g.valores.reduce((acc, x) => acc + (x - media) ** 2, 0);
  });

  const glEntre = k - 1;
  const glDentro = nTotal - k;
  const cmEntre = scEntre / glEntre;
  const cmDentro = scDentro / glDentro;
  const F = cmEntre / cmDentro;
  const valorP = 1 - jStat.centralF.cdf(F, glEntre, glDentro);

  return { k, nTotal, mediaGlobal, resumenGrupos, scEntre, scDentro, glEntre, glDentro, cmEntre, cmDentro, F, valorP };
}

/**
 * Igualdad de varianzas entre tres o más grupos — método de Levene con la
 * mediana de cada grupo (la versión de Brown-Forsythe, más robusta que la
 * de Bartlett cuando los datos no son perfectamente normales, y la que
 * suele preferirse por defecto en la práctica). Para dos grupos, usa la F
 * de siempre (pruebaVarianzas); esto es específicamente para 3 o más.
 */
export function pruebaVarianzasMultiple(columnas) {
  const grupos = columnas.map((c) => ({ nombre: c.name, valores: valoresNumericos(c.values) })).filter((g) => g.valores.length > 0);
  if (grupos.length < 3) return { error: "Hacen falta al menos 3 columnas con datos numéricos." };
  if (grupos.some((g) => g.valores.length < 2)) return { error: "Cada columna necesita al menos 2 valores." };

  function mediana(valores) {
    const ord = [...valores].sort((a, b) => a - b);
    const m = ord.length;
    return m % 2 === 0 ? (ord[m / 2 - 1] + ord[m / 2]) / 2 : ord[(m - 1) / 2];
  }

  // Las desviaciones absolutas respecto a la mediana de cada grupo, para
  // correr sobre ellas el mismo ANOVA de un factor de siempre: eso es
  // Levene — un ANOVA disfrazado, no una fórmula nueva y aparte.
  const columnasZ = grupos.map((g) => {
    const med = mediana(g.valores);
    return { name: g.nombre, values: g.valores.map((v) => Math.abs(v - med)) };
  });

  const resultadoAnova = anovaUnFactor(columnasZ);
  if (resultadoAnova.error) return resultadoAnova;

  // La varianza real de cada grupo (no la de las desviaciones a la
  // mediana, que sólo sirve para el cálculo interno) es lo que de verdad
  // se quiere mostrar en la tabla.
  const resumenGrupos = grupos.map((g) => {
    const n = g.valores.length;
    const media = g.valores.reduce((a, b) => a + b, 0) / n;
    const varianza = n > 1 ? g.valores.reduce((acc, x) => acc + (x - media) ** 2, 0) / (n - 1) : 0;
    return { nombre: g.nombre, n, varianza, desvEst: Math.sqrt(varianza) };
  });

  return {
    k: grupos.length,
    resumenGrupos,
    F: resultadoAnova.F,
    glEntre: resultadoAnova.glEntre,
    glDentro: resultadoAnova.glDentro,
    valorP: resultadoAnova.valorP,
  };
}

/**
 * Intervalo de confianza para la media de una columna (t de Student) — el
 * dato que arma la Gráfica de intervalos, comparando varios grupos por su
 * media y la incertidumbre alrededor de ella.
 */
export function intervaloConfianza(values, nivelConfianza = 0.95) {
  const datos = valoresNumericos(values);
  const n = datos.length;
  if (n < 2) return { error: "Hacen falta al menos 2 valores." };
  const media = datos.reduce((a, b) => a + b, 0) / n;
  const desvEst = Math.sqrt(datos.reduce((acc, x) => acc + (x - media) ** 2, 0) / (n - 1));
  const gl = n - 1;
  const alfa = 1 - nivelConfianza;
  const tCritico = jStat.studentt.inv(1 - alfa / 2, gl);
  const margen = tCritico * (desvEst / Math.sqrt(n));
  return { n, media, desvEst, gl, nivelConfianza, limiteInferior: media - margen, limiteSuperior: media + margen };
}

/** Correlación de Pearson entre dos columnas, con su prueba de significancia. */
export function correlacion(valuesA, valuesB) {
  const pares = [];
  const n = Math.min(valuesA.length, valuesB.length);
  for (let i = 0; i < n; i++) {
    if (typeof valuesA[i] === "number" && typeof valuesB[i] === "number") pares.push([valuesA[i], valuesB[i]]);
  }
  if (pares.length < 3) return { error: "Hacen falta al menos 3 pares de valores completos." };
  const a = pares.map((p) => p[0]);
  const b = pares.map((p) => p[1]);
  const r = ss.sampleCorrelation(a, b);
  const gl = pares.length - 2;
  const t = r * Math.sqrt(gl / (1 - r * r));
  return { n: pares.length, r, gl, t, valorP: pBilateralT(t, gl) };
}
