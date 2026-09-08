// Regresión lineal (simple y múltiple) por mínimos cuadrados, con el
// diagnóstico que pide una regresión de verdad: no basta con el R².
//
// No hay una librería de álgebra matricial en el proyecto —doe.js evita
// necesitarla porque un diseño factorial es ortogonal por construcción—,
// así que aquí sí hace falta invertir una matriz. Gauss-Jordan con pivoteo
// parcial: es el método de libro de texto (Numerical Recipes, cap. 2), no
// una fórmula cerrada que sólo valga para 2 o 3 predictores.
import jStat from "jstat";
import { pruebaNormalidad } from "./normalidad.js";

/** Multiplica dos matrices (arreglos de arreglos). */
function multiplicar(a, b) {
  const filas = a.length;
  const cols = b[0].length;
  const interno = b.length;
  const r = Array.from({ length: filas }, () => new Array(cols).fill(0));
  for (let i = 0; i < filas; i++) {
    for (let k = 0; k < interno; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < cols; j++) r[i][j] += aik * b[k][j];
    }
  }
  return r;
}

function transponer(a) {
  return a[0].map((_, j) => a.map((fila) => fila[j]));
}

/**
 * Inversa de una matriz cuadrada por Gauss-Jordan con pivoteo parcial.
 * Devuelve null si la matriz es singular (o casi): eso es multicolinealidad
 * perfecta —dos predictores que son combinación exacta el uno del otro—, y
 * hay que avisarlo, no devolver una inversa inventada.
 */
function invertir(m) {
  const n = m.length;
  // Matriz aumentada [m | I].
  const a = m.map((fila, i) => [...fila, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);

  for (let col = 0; col < n; col++) {
    // Pivoteo parcial: la fila con el valor absoluto más grande en esta
    // columna, para no dividir por un número cercano a cero si se puede
    // evitar.
    let filaPivote = col;
    for (let f = col + 1; f < n; f++) {
      if (Math.abs(a[f][col]) > Math.abs(a[filaPivote][col])) filaPivote = f;
    }
    if (Math.abs(a[filaPivote][col]) < 1e-10) return null; // singular
    [a[col], a[filaPivote]] = [a[filaPivote], a[col]];

    const pivote = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= pivote;

    for (let f = 0; f < n; f++) {
      if (f === col) continue;
      const factor = a[f][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[f][j] -= factor * a[col][j];
    }
  }
  return a.map((fila) => fila.slice(n));
}

/** Filas completas (sin ningún hueco) entre la respuesta y los predictores, ya emparejadas. */
function filasCompletas(y, xs) {
  const n = Math.min(y.length, ...xs.map((x) => x.length));
  const filas = [];
  for (let i = 0; i < n; i++) {
    if (typeof y[i] !== "number") continue;
    if (xs.some((x) => typeof x[i] !== "number")) continue;
    filas.push({ y: y[i], x: xs.map((x) => x[i]) });
  }
  return filas;
}

/**
 * El núcleo de mínimos cuadrados: dada la matriz de diseño X (con su columna
 * de 1's para el intercepto) y el vector y, devuelve los coeficientes y la
 * inversa de X'X —que hace falta después para los errores estándar y el
 * VIF, así que se calcula una sola vez y se reutiliza—.
 */
function minimosCuadrados(X, y) {
  const Xt = transponer(X);
  const XtX = multiplicar(Xt, X);
  const inversa = invertir(XtX);
  if (!inversa) return { error: "Multicolinealidad perfecta: al menos un predictor es combinación exacta de los demás (o de la constante). No se puede resolver." };
  const Xty = multiplicar(Xt, y.map((v) => [v]));
  const beta = multiplicar(inversa, Xty).map((fila) => fila[0]);
  return { beta, inversaXtX: inversa };
}

/**
 * Regresión lineal de una respuesta sobre uno o más predictores numéricos.
 * Con un solo predictor es la regresión simple de siempre; con varios, la
 * múltiple — es la misma cuenta, la matriz de diseño simplemente tiene más
 * columnas.
 *
 * Verificada contra el dataset I de Anscombe (el clásico, con resultado
 * publicado): intercepto ≈ 3.0001, pendiente ≈ 0.5001, R² ≈ 0.6665 — y
 * contra una relación exacta sin ruido (y = 3 + 2·x1 − x2), que la
 * regresión debe recuperar con R² = 1 y SC del residuo = 0. Los dos casos
 * están en el archivo de pruebas.
 */
export function regresionLineal(nombreRespuesta, y, predictores) {
  const nombres = predictores.map((p) => p.name);
  const filas = filasCompletas(y, predictores.map((p) => p.values));
  const k = predictores.length;
  const n = filas.length;
  if (n < k + 2) return { error: `Hacen falta al menos ${k + 2} filas completas para ${k} predictor(es) (hay ${n}).` };

  const X = filas.map((f) => [1, ...f.x]);
  const yVec = filas.map((f) => f.y);

  const mc = minimosCuadrados(X, yVec);
  if (mc.error) return mc;
  const { beta, inversaXtX } = mc;

  const mediaY = yVec.reduce((a, b) => a + b, 0) / n;
  const ajustados = X.map((fila) => fila.reduce((acc, xij, j) => acc + xij * beta[j], 0));
  const residuos = yVec.map((yi, i) => yi - ajustados[i]);

  const scTotal = yVec.reduce((acc, yi) => acc + (yi - mediaY) ** 2, 0);
  const scResidual = residuos.reduce((acc, e) => acc + e * e, 0);
  const scModelo = scTotal - scResidual;

  const glModelo = k;
  const glResidual = n - k - 1;
  const r2 = scTotal > 0 ? 1 - scResidual / scTotal : 1;
  const r2Ajustado = 1 - (1 - r2) * ((n - 1) / glResidual);

  const cmModelo = scModelo / glModelo;
  const cmResidual = scResidual / glResidual;
  const F = cmModelo / cmResidual;
  const valorPModelo = 1 - jStat.centralF.cdf(F, glModelo, glResidual);
  const errorEstandarResidual = Math.sqrt(cmResidual);

  // Error estándar de cada coeficiente: la raíz de cmResidual · (X'X)⁻¹_jj.
  const coeficientes = beta.map((b, j) => {
    const errorEst = Math.sqrt(cmResidual * inversaXtX[j][j]);
    const t = b / errorEst;
    const valorP = 2 * (1 - jStat.studentt.cdf(Math.abs(t), glResidual));
    return { nombre: j === 0 ? "Constante" : nombres[j - 1], beta: b, errorEst, t, valorP };
  });

  // VIF de cada predictor: se regresa ese predictor contra todos los
  // demás (con su propia constante) y VIF = 1/(1−R²) de esa regresión
  // auxiliar. Un VIF alto (>5 o >10, según el criterio) dice que ese
  // predictor es casi combinación lineal de los otros, y sus coeficientes
  // no se pueden interpretar por separado con confianza.
  let vif = null;
  if (k >= 2) {
    vif = predictores.map((p, idx) => {
      const otros = predictores.filter((_, j) => j !== idx);
      const aux = regresionLineal(p.name, p.values, otros);
      if (aux.error) return { nombre: p.name, vif: null };
      return { nombre: p.name, vif: aux.r2 >= 1 ? Infinity : 1 / (1 - aux.r2) };
    });
  }

  // Normalidad de los residuos: la misma prueba de Anderson-Darling de
  // siempre, no una nueva — un residuo lejos de la normal es la señal
  // clásica de que el modelo lineal no es el correcto, o de que falta un
  // término.
  const normalidadResiduos = pruebaNormalidad(residuos);

  return {
    n,
    k,
    coeficientes,
    r2,
    r2Ajustado,
    F,
    glModelo,
    glResidual,
    valorPModelo,
    errorEstandarResidual,
    residuos,
    ajustados,
    vif,
    normalidadResiduos: normalidadResiduos.error ? null : normalidadResiduos,
  };
}

/**
 * Prueba de Breusch-Pagan para heterocedasticidad: se regresan los residuos
 * al cuadrado contra los mismos predictores del modelo original, y si esa
 * regresión auxiliar explica una parte importante de la varianza (LM = n·R²
 * de esa regresión, contra chi-cuadrado con k grados de libertad), la
 * varianza del error no es constante — el supuesto de homocedasticidad no
 * se sostiene.
 */
export function pruebaBreuschPagan(resultadoRegresion, predictores) {
  const { residuos, n, k } = resultadoRegresion;
  const residuosCuadrado = residuos.map((e) => e * e);
  const aux = regresionLineal("residuos²", residuosCuadrado, predictores);
  if (aux.error) return { error: aux.error };
  const LM = n * aux.r2;
  const valorP = 1 - jStat.chisquare.cdf(LM, k);
  return { LM, gl: k, valorP };
}
