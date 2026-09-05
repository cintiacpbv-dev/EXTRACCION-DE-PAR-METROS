// Gráficas de control (SPC) y análisis de capacidad.
//
// Las constantes (d2, D3, D4, A2, B3, B4, c4) son las tabuladas de siempre
// en control de calidad (Montgomery, "Introduction to Statistical Quality
// Control", tabla de constantes para gráficas de variables) — no fórmulas
// propias, así que no hay margen para reinventar mal una integral. Se
// verificó su consistencia interna antes de usarlas: A2 = 3/(d2·√n),
// A3 = 3/(c4·√n), B4 = 1 + 3·√(1−c4²)/c4, B3 = max(0, 1 − esa misma raíz) —
// las tres relaciones cuadran exactamente con los valores tabulados.
//
// Sólo cubre subgrupos de 2 a 10: fuera de ese rango no tengo la constante
// verificada, y es mejor avisar que faltan datos a inventar un valor.
const TABLA_CONSTANTES = {
  2: { d2: 1.128, D3: 0, D4: 3.267, A2: 1.88, B3: 0, B4: 3.267, c4: 0.7979 },
  3: { d2: 1.693, D3: 0, D4: 2.574, A2: 1.023, B3: 0, B4: 2.568, c4: 0.8862 },
  4: { d2: 2.059, D3: 0, D4: 2.282, A2: 0.729, B3: 0, B4: 2.266, c4: 0.9213 },
  5: { d2: 2.326, D3: 0, D4: 2.114, A2: 0.577, B3: 0, B4: 2.089, c4: 0.94 },
  6: { d2: 2.534, D3: 0, D4: 2.004, A2: 0.483, B3: 0.03, B4: 1.97, c4: 0.9515 },
  7: { d2: 2.704, D3: 0.076, D4: 1.924, A2: 0.419, B3: 0.118, B4: 1.882, c4: 0.9594 },
  8: { d2: 2.847, D3: 0.136, D4: 1.864, A2: 0.373, B3: 0.185, B4: 1.815, c4: 0.965 },
  9: { d2: 2.97, D3: 0.184, D4: 1.816, A2: 0.337, B3: 0.239, B4: 1.761, c4: 0.9693 },
  10: { d2: 3.078, D3: 0.223, D4: 1.777, A2: 0.308, B3: 0.284, B4: 1.716, c4: 0.9727 },
};

export function constantesControl(n) {
  return TABLA_CONSTANTES[n] || null;
}

function soloNumericos(values) {
  return values.filter((v) => typeof v === "number" && !Number.isNaN(v));
}

/** Puntos fuera de [LCL, UCL] — la regla 1 de Western Electric, la más básica. */
function fueraDeControl(puntos, lcl, ucl) {
  return puntos.map((v, i) => ({ i, v, fuera: v > ucl || v < lcl }));
}

/**
 * Gráfica I-MR (individuos y rango móvil): para datos tomados de uno en
 * uno, sin subgrupos — el caso más común cuando cada fila es una medición
 * (un lote, un turno, una muestra), no un grupo de piezas del mismo
 * momento.
 */
export function graficaIndividuosMR(values) {
  const datos = soloNumericos(values);
  if (datos.length < 3) return { error: "Hacen falta al menos 3 valores." };

  const rangosMoviles = [];
  for (let i = 1; i < datos.length; i++) rangosMoviles.push(Math.abs(datos[i] - datos[i - 1]));

  const media = datos.reduce((a, b) => a + b, 0) / datos.length;
  const mrBarra = rangosMoviles.reduce((a, b) => a + b, 0) / rangosMoviles.length;
  const { d2, D4 } = TABLA_CONSTANTES[2]; // el rango móvil siempre se calcula de a 2 puntos

  const sigmaEstimada = mrBarra / d2;
  const ucl = media + 3 * sigmaEstimada;
  const lcl = media - 3 * sigmaEstimada;
  const uclMR = D4 * mrBarra;

  return {
    n: datos.length,
    media,
    sigmaEstimada,
    individuos: { cl: media, ucl, lcl, puntos: fueraDeControl(datos, lcl, ucl) },
    rangoMovil: { cl: mrBarra, ucl: uclMR, lcl: 0, puntos: fueraDeControl(rangosMoviles, 0, uclMR) },
  };
}

/**
 * Gráfica Xbar-R: agrupa los datos en subgrupos consecutivos de tamaño
 * fijo (tal como aparecen en la hoja, en el orden en que se midieron) y
 * calcula la media y el rango de cada uno.
 */
export function graficaXbarR(values, tamanoSubgrupo) {
  const constantes = constantesControl(tamanoSubgrupo);
  if (!constantes) return { error: `Tamaño de subgrupo no soportado (usa de 2 a 10). Diste ${tamanoSubgrupo}.` };

  const datos = soloNumericos(values);
  const numSubgrupos = Math.floor(datos.length / tamanoSubgrupo);
  if (numSubgrupos < 2) return { error: "Hacen falta al menos 2 subgrupos completos." };

  const medias = [];
  const rangos = [];
  for (let g = 0; g < numSubgrupos; g++) {
    const subgrupo = datos.slice(g * tamanoSubgrupo, (g + 1) * tamanoSubgrupo);
    medias.push(subgrupo.reduce((a, b) => a + b, 0) / tamanoSubgrupo);
    rangos.push(Math.max(...subgrupo) - Math.min(...subgrupo));
  }

  const xBarraBarra = medias.reduce((a, b) => a + b, 0) / medias.length;
  const rBarra = rangos.reduce((a, b) => a + b, 0) / rangos.length;
  const { A2, D3, D4, d2 } = constantes;

  const uclX = xBarraBarra + A2 * rBarra;
  const lclX = xBarraBarra - A2 * rBarra;
  const uclR = D4 * rBarra;
  const lclR = D3 * rBarra;

  return {
    numSubgrupos,
    tamanoSubgrupo,
    xBarraBarra,
    rBarra,
    sigmaEstimada: rBarra / d2,
    medias: { cl: xBarraBarra, ucl: uclX, lcl: lclX, puntos: fueraDeControl(medias, lclX, uclX) },
    rangos: { cl: rBarra, ucl: uclR, lcl: lclR, puntos: fueraDeControl(rangos, lclR, uclR) },
  };
}

/**
 * Capacidad de proceso. Pp/Ppk siempre se pueden calcular (usan la
 * variación total de los datos); Cp/Cpk necesitan una estimación de la
 * variación "dentro" del proceso, que sale de un tamaño de subgrupo — sin
 * uno, sólo se devuelve Pp/Ppk, que es información real y no un valor
 * inventado.
 */
export function capacidadProceso(values, { lsl, usl, tamanoSubgrupo } = {}) {
  const datos = soloNumericos(values);
  if (datos.length < 2) return { error: "Hacen falta al menos 2 valores." };
  if (lsl == null && usl == null) return { error: "Da al menos un límite de especificación (inferior o superior)." };

  const n = datos.length;
  const media = datos.reduce((a, b) => a + b, 0) / n;
  const varianza = datos.reduce((acc, x) => acc + (x - media) ** 2, 0) / (n - 1);
  const sigmaGlobal = Math.sqrt(varianza);

  const resultado = { n, media, sigmaGlobal, lsl: lsl ?? null, usl: usl ?? null };

  if (lsl != null && usl != null) {
    resultado.pp = (usl - lsl) / (6 * sigmaGlobal);
  }
  const ppkSuperior = usl != null ? (usl - media) / (3 * sigmaGlobal) : null;
  const ppkInferior = lsl != null ? (media - lsl) / (3 * sigmaGlobal) : null;
  resultado.ppk = Math.min(...[ppkSuperior, ppkInferior].filter((v) => v != null));

  if (tamanoSubgrupo && tamanoSubgrupo >= 2) {
    let sigmaDentro = null;
    if (tamanoSubgrupo === 2 && datos.length >= 3) {
      // Sin agrupar de a pares: el rango móvil punto-a-punto es la forma
      // habitual de estimar sigma "dentro" cuando no hay subgrupos reales.
      const g = graficaIndividuosMR(datos);
      if (!g.error) sigmaDentro = g.sigmaEstimada;
    } else {
      const g = graficaXbarR(datos, tamanoSubgrupo);
      if (!g.error) sigmaDentro = g.sigmaEstimada;
    }
    if (sigmaDentro) {
      resultado.sigmaDentro = sigmaDentro;
      if (lsl != null && usl != null) resultado.cp = (usl - lsl) / (6 * sigmaDentro);
      const cpuSuperior = usl != null ? (usl - media) / (3 * sigmaDentro) : null;
      const cpkInferior = lsl != null ? (media - lsl) / (3 * sigmaDentro) : null;
      resultado.cpk = Math.min(...[cpuSuperior, cpkInferior].filter((v) => v != null));
    }
  }

  return resultado;
}
