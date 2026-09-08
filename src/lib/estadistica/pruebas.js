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

/** Correlación de Spearman: la de Pearson, pero sobre los rangos en vez de los valores — no exige relación lineal ni normalidad, sólo que la relación sea monótona. */
export function correlacionSpearman(valuesA, valuesB) {
  const pares = [];
  const n = Math.min(valuesA.length, valuesB.length);
  for (let i = 0; i < n; i++) {
    if (typeof valuesA[i] === "number" && typeof valuesB[i] === "number") pares.push([valuesA[i], valuesB[i]]);
  }
  if (pares.length < 3) return { error: "Hacen falta al menos 3 pares de valores completos." };
  const rangosA = rangosPromedio(pares.map((p) => p[0]));
  const rangosB = rangosPromedio(pares.map((p) => p[1]));
  const r = ss.sampleCorrelation(rangosA, rangosB);
  const gl = pares.length - 2;
  const t = r * Math.sqrt(gl / (1 - r * r));
  return { n: pares.length, r, gl, t, valorP: pBilateralT(t, gl) };
}

/**
 * Rango promedio de cada valor de un arreglo (1-indexado): los valores
 * empatados reciben el promedio de las posiciones que ocuparían — la
 * convención de siempre para romper empates en pruebas basadas en rangos
 * (Spearman, Kruskal-Wallis, Mann-Whitney), y la que da el resultado exacto
 * de R/Minitab en vez de uno que dependa del orden de entrada.
 */
function rangosPromedio(valores) {
  const indexados = valores.map((v, i) => ({ v, i }));
  indexados.sort((a, b) => a.v - b.v);
  const rangos = new Array(valores.length);
  let k = 0;
  while (k < indexados.length) {
    let j = k;
    while (j + 1 < indexados.length && indexados[j + 1].v === indexados[k].v) j++;
    // Posiciones k..j (0-indexadas) empatadas: su rango promedio es el
    // promedio de las posiciones 1-indexadas (k+1)..(j+1).
    const rangoPromedio = (k + 1 + j + 1) / 2;
    for (let m = k; m <= j; m++) rangos[indexados[m].i] = rangoPromedio;
    k = j + 1;
  }
  return rangos;
}

/**
 * Kruskal-Wallis: la alternativa no paramétrica al ANOVA de un factor —
 * compara las medianas (en rigor, las distribuciones) de tres o más grupos
 * sin asumir normalidad, usando los rangos de todos los datos juntos en vez
 * de los valores. Con corrección por empates (D'Agostino y Stephens no
 * aplica aquí; la corrección es la estándar de Kruskal-Wallis 1952),
 * necesaria porque muchos empates infla el estadístico H si no se corrige.
 */
export function kruskalWallis(columnas) {
  const grupos = columnas.map((c) => ({ nombre: c.name, valores: valoresNumericos(c.values) })).filter((g) => g.valores.length > 0);
  if (grupos.length < 3) return { error: "Hacen falta al menos 3 columnas con datos numéricos." };
  if (grupos.some((g) => g.valores.length < 2)) return { error: "Cada columna necesita al menos 2 valores." };

  const todos = grupos.flatMap((g) => g.valores);
  const N = todos.length;
  const rangos = rangosPromedio(todos);

  let sumaH = 0;
  let offset = 0;
  const resumenGrupos = grupos.map((g) => {
    const n = g.valores.length;
    const sumaRangos = rangos.slice(offset, offset + n).reduce((a, b) => a + b, 0);
    offset += n;
    sumaH += (sumaRangos * sumaRangos) / n;
    return { nombre: g.nombre, n, sumaRangos, rangoPromedio: sumaRangos / n };
  });

  const hSinCorregir = (12 / (N * (N + 1))) * sumaH - 3 * (N + 1);

  // Corrección por empates: se agrupan los rangos por su valor (no por su
  // posición) para contar cuántos datos —de cualquier grupo— comparten
  // cada valor.
  const conteoValores = new Map();
  for (const v of todos) conteoValores.set(v, (conteoValores.get(v) || 0) + 1);
  let sumaEmpates = 0;
  for (const t of conteoValores.values()) if (t > 1) sumaEmpates += t ** 3 - t;
  const correccion = 1 - sumaEmpates / (N ** 3 - N);
  const H = correccion > 0 ? hSinCorregir / correccion : hSinCorregir;

  const gl = grupos.length - 1;
  const valorP = 1 - jStat.chisquare.cdf(H, gl);

  return { k: grupos.length, N, resumenGrupos, H, gl, valorP, correccionEmpates: correccion };
}

/**
 * Tukey HSD (comparaciones múltiples por pares) sobre el resultado ya
 * calculado de un ANOVA de un factor — no reinventa el CM del error ni sus
 * grados de libertad, los toma de anovaUnFactor(). Usa la forma de
 * Tukey-Kramer (válida también con grupos de distinto tamaño; se reduce a
 * la fórmula clásica cuando todos son iguales) y el valor p exacto de la
 * distribución del rango studentizado (jStat.tukey), no un único corte.
 */
export function tukeyHSD(resultadoAnova, nivelConfianza = 0.95) {
  const { resumenGrupos, cmDentro, glDentro, k } = resultadoAnova;
  if (!resumenGrupos || cmDentro == null) return { error: "Hace falta el resultado de un ANOVA de un factor." };
  if (k < 3) return { error: "Tukey compara tres o más grupos; para dos, usa la prueba t de 2 muestras." };

  const comparaciones = [];
  for (let i = 0; i < resumenGrupos.length; i++) {
    for (let j = i + 1; j < resumenGrupos.length; j++) {
      const gi = resumenGrupos[i];
      const gj = resumenGrupos[j];
      const diferencia = gi.media - gj.media;
      const errorEst = Math.sqrt((cmDentro / 2) * (1 / gi.n + 1 / gj.n));
      const q = Math.abs(diferencia) / errorEst;
      const valorP = 1 - jStat.tukey.cdf(q, k, glDentro);
      const qCritico = jStat.tukey.inv(nivelConfianza, k, glDentro);
      const margen = qCritico * errorEst;
      comparaciones.push({
        grupoA: gi.nombre,
        grupoB: gj.nombre,
        diferencia,
        errorEst,
        q,
        valorP,
        limiteInferior: diferencia - margen,
        limiteSuperior: diferencia + margen,
      });
    }
  }
  return { k, glDentro, cmDentro, nivelConfianza, comparaciones };
}

/**
 * ANOVA de Welch: la versión del ANOVA de un factor que NO asume que los
 * grupos tengan la misma varianza —el mismo motivo por el que la prueba t
 * de 2 muestras de este archivo usa Welch en vez de la t de Student
 * clásica—. Cada grupo pesa según el inverso de su propia varianza, así
 * que un grupo con mucho ruido no puede arrastrar la conclusión de otro
 * más estable con el mismo peso que él (Welch, B.L. 1951, "On the
 * comparison of several mean values: an alternative approach", Biometrika
 * 38, 330–336).
 *
 * Se apoya en anovaUnFactor() para la agrupación y su validación —no
 * repite esa lógica—, y sólo recalcula las cuentas que de verdad cambian
 * con Welch: los pesos, la F y sus dos grados de libertad (el segundo, a
 * diferencia del ANOVA clásico, casi nunca es un entero).
 *
 * Con dos grupos, coincide exactamente con el cuadrado del estadístico t
 * de tDosMuestras() —la misma Welch, mirada como ANOVA o como prueba t—:
 * verificado en el archivo de pruebas, no es una suposición.
 *
 * Con varianzas iguales entre grupos NO coincide con el ANOVA clásico —ni
 * siquiera entonces—: el término de corrección del denominador
 * (2(k−2)/(k²−1)·Σ(1−wᵢ/W)²/(nᵢ−1)) sigue sumando algo salvo que k=2, así
 * que Welch da un F un poco más chico incluso cuando la suposición que
 * evita resulta ser cierta. No es un error de este archivo: es una
 * propiedad conocida de la aproximación de Welch (más conservadora por
 * construcción), y está verificada contra la forma cerrada de ese término
 * calculada a mano, no comparándola con el ANOVA clásico.
 */
export function welchAnova(columnas) {
  const base = anovaUnFactor(columnas);
  if (base.error) return base;
  const { k, resumenGrupos } = base;

  const grupos = resumenGrupos.map((g) => ({ ...g, varianza: g.desvEst ** 2 }));
  if (grupos.some((g) => g.varianza === 0)) {
    return { error: "Al menos un grupo tiene varianza cero (todos sus valores son idénticos): Welch no se puede calcular, necesita variación dentro de cada grupo." };
  }

  const pesos = grupos.map((g) => g.n / g.varianza);
  const sumaPesos = pesos.reduce((a, b) => a + b, 0);
  const mediaPonderada = grupos.reduce((acc, g, i) => acc + pesos[i] * g.media, 0) / sumaPesos;

  const numerador = grupos.reduce((acc, g, i) => acc + pesos[i] * (g.media - mediaPonderada) ** 2, 0) / (k - 1);

  const terminoGl = grupos.reduce((acc, g, i) => acc + (1 - pesos[i] / sumaPesos) ** 2 / (g.n - 1), 0);
  const denominador = 1 + (2 * (k - 2) * terminoGl) / (k * k - 1);

  const F = numerador / denominador;
  const gl1 = k - 1;
  const gl2 = 1 / (3 * terminoGl / (k * k - 1));
  const valorP = 1 - jStat.centralF.cdf(F, gl1, gl2);

  return { k, resumenGrupos: grupos, mediaPonderada, F, gl1, gl2, valorP };
}

/**
 * Games-Howell: el post-hoc que corresponde a Welch, igual que Tukey le
 * corresponde al ANOVA clásico — no asume varianzas iguales entre grupos,
 * así que no pide el CM del error de un ANOVA que ya asumió lo que Welch
 * evita asumir.
 *
 * Cada par se compara con SU PROPIO error estándar y SUS PROPIOS grados de
 * libertad (Welch-Satterthwaite, la misma fórmula de tDosMuestras()), no
 * con un valor común para toda la tabla — es exactamente lo que hace
 * tDosMuestras() para cada par, sólo que evaluado en la distribución del
 * rango studentizado en vez de la t, para que el valor p ya venga
 * ajustado por hacer varias comparaciones a la vez.
 *
 * La relación con tDosMuestras() es exacta y es la verificación: para
 * cualquier par, q = √2·|t de Welch| y los grados de libertad son
 * IDÉNTICOS a los de tDosMuestras() para ese mismo par — están
 * comprobados en el archivo de pruebas, no son una coincidencia de
 * redondeo.
 */
export function gamesHowell(columnas, nivelConfianza = 0.95) {
  const base = anovaUnFactor(columnas);
  if (base.error) return base;
  const { k, resumenGrupos } = base;
  if (k < 3) return { error: "Games-Howell compara tres o más grupos; para dos, usa la prueba t de 2 muestras (Welch)." };

  const grupos = resumenGrupos.map((g) => ({ ...g, varianza: g.desvEst ** 2 }));
  const comparaciones = [];
  for (let i = 0; i < grupos.length; i++) {
    for (let j = i + 1; j < grupos.length; j++) {
      const gi = grupos[i];
      const gj = grupos[j];
      const seA = gi.varianza / gi.n;
      const seB = gj.varianza / gj.n;
      const diferencia = gi.media - gj.media;
      const errorEstGH = Math.sqrt((seA + seB) / 2);
      const q = Math.abs(diferencia) / errorEstGH;
      const gl = (seA + seB) ** 2 / (seA ** 2 / (gi.n - 1) + seB ** 2 / (gj.n - 1));
      const valorP = 1 - jStat.tukey.cdf(q, k, gl);
      const qCritico = jStat.tukey.inv(nivelConfianza, k, gl);
      const margen = qCritico * errorEstGH;
      comparaciones.push({
        grupoA: gi.nombre,
        grupoB: gj.nombre,
        diferencia,
        errorEst: errorEstGH,
        gl,
        q,
        valorP,
        limiteInferior: diferencia - margen,
        limiteSuperior: diferencia + margen,
      });
    }
  }
  return { k, nivelConfianza, comparaciones };
}
