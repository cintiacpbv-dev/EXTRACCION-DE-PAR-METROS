// Gage R&R (Análisis del Sistema de Medición) por el método ANOVA — el que
// usa Minitab por defecto, más preciso que el método X-bar/R porque separa
// la interacción operador×parte en vez de mezclarla con la repetibilidad.
//
// Exige un diseño cruzado y balanceado: cada operador mide cada parte el
// mismo número de veces (n ensayos). Sin eso, las sumas de cuadrados de un
// ANOVA de dos vías no se pueden repartir limpiamente entre parte, operador
// e interacción, y cualquier resultado sería un cálculo aproximado
// disfrazado de exacto.
import jStat from "jstat";

// 5.15·σ cubre el 99% de una normal (±2.575σ) — el multiplicador que usa el
// manual MSA de AIAG por defecto para "Study Variation". Minitab deja
// elegir 6·σ (99.73%) en su lugar; aquí se fija en 5.15 por ser el más
// citado como estándar de la industria, y se nombra explícitamente en el
// resultado para que no se confunda con el otro.
const K_STUDY_VAR = 5.15;

function agrupar(partes, operadores, mediciones) {
  const n = Math.min(partes.length, operadores.length, mediciones.length);
  const filas = [];
  for (let i = 0; i < n; i++) {
    const parte = partes[i];
    const operador = operadores[i];
    const medicion = mediciones[i];
    if (parte == null || operador == null || typeof medicion !== "number") continue;
    filas.push({ parte: String(parte), operador: String(operador), medicion });
  }
  return filas;
}

export function gageRR(partes, operadores, mediciones) {
  const filas = agrupar(partes, operadores, mediciones);
  if (filas.length < 4) return { error: "Hacen falta más filas completas (parte, operador y medición)." };

  const listaPartes = [...new Set(filas.map((f) => f.parte))];
  const listaOperadores = [...new Set(filas.map((f) => f.operador))];
  const p = listaPartes.length;
  const o = listaOperadores.length;
  if (p < 2) return { error: "Hacen falta al menos 2 partes distintas." };
  if (o < 2) return { error: "Hacen falta al menos 2 operadores distintos." };

  // Celdas parte×operador, y comprobación de que el diseño es cruzado y
  // balanceado (mismo número de ensayos en cada celda).
  const celdas = new Map(); // clave "parte::operador" -> [mediciones]
  for (const f of filas) {
    const clave = `${f.parte}::${f.operador}`;
    if (!celdas.has(clave)) celdas.set(clave, []);
    celdas.get(clave).push(f.medicion);
  }
  if (celdas.size !== p * o) {
    return { error: "El diseño no está completo: falta que algún operador mida alguna parte (o sobra alguna combinación)." };
  }
  const tamanos = new Set([...celdas.values()].map((v) => v.length));
  if (tamanos.size !== 1) {
    return { error: "Cada operador debe medir cada parte el mismo número de veces (mismo número de ensayos en todas las celdas)." };
  }
  const n = [...tamanos][0];
  if (n < 2) return { error: "Hace falta al menos 2 ensayos (repeticiones) por cada combinación de parte y operador." };

  // Medias: de celda, de parte, de operador, y gran media.
  const mediaCelda = new Map();
  for (const [clave, vals] of celdas) mediaCelda.set(clave, vals.reduce((a, b) => a + b, 0) / vals.length);

  const mediaParte = new Map();
  for (const parte of listaPartes) {
    const vals = listaOperadores.map((op) => mediaCelda.get(`${parte}::${op}`));
    mediaParte.set(parte, vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  const mediaOperador = new Map();
  for (const op of listaOperadores) {
    const vals = listaPartes.map((parte) => mediaCelda.get(`${parte}::${op}`));
    mediaOperador.set(op, vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  const granMedia = filas.reduce((a, f) => a + f.medicion, 0) / filas.length;

  // Sumas de cuadrados del ANOVA de dos vías con interacción.
  let ssParte = 0;
  for (const parte of listaPartes) ssParte += (mediaParte.get(parte) - granMedia) ** 2;
  ssParte *= o * n;

  let ssOperador = 0;
  for (const op of listaOperadores) ssOperador += (mediaOperador.get(op) - granMedia) ** 2;
  ssOperador *= p * n;

  let ssInteraccion = 0;
  for (const parte of listaPartes) {
    for (const op of listaOperadores) {
      const mCelda = mediaCelda.get(`${parte}::${op}`);
      ssInteraccion += (mCelda - mediaParte.get(parte) - mediaOperador.get(op) + granMedia) ** 2;
    }
  }
  ssInteraccion *= n;

  let ssError = 0;
  for (const [clave, vals] of celdas) {
    const m = mediaCelda.get(clave);
    for (const v of vals) ssError += (v - m) ** 2;
  }

  const glParte = p - 1;
  const glOperador = o - 1;
  const glInteraccion = (p - 1) * (o - 1);
  const glError = p * o * (n - 1);

  const msParte = ssParte / glParte;
  const msOperador = ssOperador / glOperador;
  const msInteraccion = ssInteraccion / glInteraccion;
  const msError = ssError / glError;

  const fParte = msParte / msInteraccion;
  const fOperador = msOperador / msInteraccion;
  const fInteraccion = msInteraccion / msError;

  const tabla = [
    { fuente: "Parte", gl: glParte, sc: ssParte, cm: msParte, F: fParte, valorP: 1 - jStat.centralF.cdf(fParte, glParte, glInteraccion) },
    { fuente: "Operador", gl: glOperador, sc: ssOperador, cm: msOperador, F: fOperador, valorP: 1 - jStat.centralF.cdf(fOperador, glOperador, glInteraccion) },
    { fuente: "Parte × Operador", gl: glInteraccion, sc: ssInteraccion, cm: msInteraccion, F: fInteraccion, valorP: 1 - jStat.centralF.cdf(fInteraccion, glInteraccion, glError) },
    { fuente: "Repetibilidad (error)", gl: glError, sc: ssError, cm: msError, F: null, valorP: null },
  ];

  // Componentes de varianza — método ANOVA de AIAG. Nunca negativos: una
  // varianza no puede serlo, así que un MS más chico que el que le resta
  // (ruido de muestreo) se trata como cero, no como un número negativo sin
  // sentido físico.
  const varRepetibilidad = msError;
  const varInteraccion = Math.max(0, (msInteraccion - msError) / n);
  const varOperador = Math.max(0, (msOperador - msInteraccion) / (p * n));
  const varReproducibilidad = varOperador + varInteraccion;
  const varGRR = varRepetibilidad + varReproducibilidad;
  const varParte = Math.max(0, (msParte - msInteraccion) / (o * n));
  const varTotal = varGRR + varParte;

  const componentes = [
    { nombre: "Repetibilidad (equipo)", varianza: varRepetibilidad },
    { nombre: "Reproducibilidad (operadores)", varianza: varReproducibilidad },
    { nombre: "Gage R&R (total)", varianza: varGRR },
    { nombre: "Variación entre partes", varianza: varParte },
    { nombre: "Total", varianza: varTotal },
  ].map((c) => ({
    ...c,
    desvEst: Math.sqrt(c.varianza),
    studyVar: K_STUDY_VAR * Math.sqrt(c.varianza),
    porcentajeContribucion: varTotal > 0 ? (c.varianza / varTotal) * 100 : 0,
    porcentajeStudyVar: varTotal > 0 ? Math.sqrt(c.varianza / varTotal) * 100 : 0,
  }));

  const sigmaGRR = Math.sqrt(varGRR);
  const sigmaParte = Math.sqrt(varParte);
  const ndc = sigmaGRR > 0 ? Math.floor(1.41 * (sigmaParte / sigmaGRR)) : null;

  return {
    p,
    o,
    n,
    tabla,
    componentes,
    ndc,
    kStudyVar: K_STUDY_VAR,
    aceptable: componentes[2].porcentajeStudyVar < 30, // menos del 30% de %StudyVar es el corte habitual de AIAG para "aceptable"
  };
}
