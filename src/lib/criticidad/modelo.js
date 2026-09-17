// El Procedimiento de Evaluación de Criticidad y Riesgo, en código.
//
// La secuencia es la de las corridas de Producto 1 (solución inyectable) y
// Producto 2 (tableta recubierta), que siguen ICH Q9(R1) 2023 y PDA TR60:
//
//   Paso 0  Lista de Atributos de Calidad (ensayo · especificación · norma)
//   Paso 1  Severidad 1-5 por ATRIBUTO, una sola vez
//   Paso 2  Causa-efecto por PARÁMETRO: sospecha, qué CQA, origen
//   Paso 3  Clasificación: Crítico / Clave / No Clave
//   Paso 4  FMEA (P, D, NPR) sólo para los Críticos
//   Paso 5  Vínculo estadístico: Severidad → Confianza/Cobertura → n
//   Paso 6  Plan de reevaluación
//
// Este módulo es sólo la parte que DECIDE: no lee PDF, no llama a nadie y no
// dibuja nada. Así se puede correr entera contra las dos corridas reales y
// comprobar que da la misma clasificación que el documento impreso.

/** Las tres clasificaciones posibles. No hay una cuarta. */
export const CRITICO = "Crítico";
export const CLAVE = "Clave";
export const NO_CLAVE = "No Clave";

/**
 * El umbral. SOLO Severidad 4 o 5 puede producir Crítico.
 *
 * Es la regla que reencuadra todo el procedimiento: con severidad alta y
 * sospecha de impacto, el parámetro es Crítico sin evaluar Probabilidad ni
 * Detectabilidad. Con severidad 1-3 nunca lo es, y se resuelve por la
 * pregunta de desempeño de proceso.
 */
export const SEVERIDAD_CRITICA = 4;

/**
 * La severidad que gobierna a un parámetro es la MÁS ALTA de los atributos a
 * los que afecta.
 *
 * Un parámetro puede tocar varios: "Peso de excipientes" afecta a Descripción
 * (severidad 3) y a Eficacia de conservantes (4). Lo que decide es el 4 — el
 * daño posible es el peor de los posibles, no el promedio ni el primero de la
 * lista. En la corrida de Producto 1 esa fila salió impresa con un 3 en la
 * columna de severidad y con "Severidad 4 → Crítico automático" en la de al
 * lado; el FMEA la trae con S=4. La regla estaba bien aplicada y la celda mal
 * escrita: calcularla quita la posibilidad de que vuelva a pasar.
 */
export function severidadDe(parametro, severidadPorAtributo) {
  const severidades = (parametro?.afecta || [])
    .map((a) => severidadPorAtributo?.[typeof a === "string" ? a : a?.atributo])
    .filter((s) => Number.isFinite(s));
  return severidades.length > 0 ? Math.max(...severidades) : null;
}

/**
 * Paso 3 — la clasificación de un parámetro.
 *
 * Dos vías, y sólo dos:
 *
 *   1. Sospecha de impacto (Paso 2) + severidad 4 o 5 → Crítico automático.
 *   2. Todo lo demás —severidad 1-3, o sin sospecha— baja a la pregunta de
 *      desempeño de proceso: ¿afecta rendimiento, tiempo o consistencia?
 *      Sí → Clave. No → No Clave.
 *
 * "No Clave" es el resultado esperado y correcto cuando la respuesta es NO.
 * No existe motivo para subirlo a Clave por costumbre.
 *
 * `desempeno` es lo que responde esa pregunta: true, false, o null si todavía
 * no se ha contestado. Con null se devuelve la vía a la que bajó y la
 * clasificación queda pendiente, que es más honesto que suponer un NO.
 */
export function clasificar(parametro, severidadPorAtributo) {
  const severidad = severidadDe(parametro, severidadPorAtributo);
  const haySospecha = !!parametro?.sospecha && (parametro?.afecta || []).length > 0;

  if (haySospecha && severidad !== null && severidad >= SEVERIDAD_CRITICA) {
    return {
      clasificacion: CRITICO,
      severidad,
      via: `Severidad ${severidad} → Crítico automático`,
      requiereFmea: true,
    };
  }

  const via = haySospecha
    ? `Severidad ${severidad ?? "sin fijar"} → pasa a pregunta de desempeño`
    : "Sin sospecha (Paso 2) → pregunta de desempeño directa";

  if (parametro?.desempeno === true) {
    return { clasificacion: CLAVE, severidad, via, requiereFmea: false };
  }
  if (parametro?.desempeno === false) {
    return { clasificacion: NO_CLAVE, severidad, via, requiereFmea: false };
  }
  return { clasificacion: null, severidad, via, requiereFmea: false, pendiente: "pregunta de desempeño" };
}

/**
 * Paso 4 — el NPR, para priorizar entre los Críticos.
 *
 * NUNCA decide la clasificación. Un parámetro con Severidad 5 y NPR 10 sigue
 * siendo Crítico; un NPR alto no vuelve crítico a uno de severidad baja. Está
 * para ordenar el trabajo sobre los que ya se sabe que son críticos.
 */
export function npr(s, p, d) {
  if (![s, p, d].every((x) => Number.isFinite(x) && x >= 1 && x <= 5)) return null;
  return s * p * d;
}

/** Los tramos con los que se lee ese número. */
export const TRAMOS_NPR = [
  { hasta: 15, nivel: "Bajo", uso: "Monitoreo estándar" },
  { hasta: 35, nivel: "Medio", uso: "Monitoreo reforzado / revisión periódica" },
  { hasta: 125, nivel: "Alto", uso: "Prioridad de atención inmediata; revisar controles antes del PPQ" },
];

export function nivelDeNpr(valor) {
  if (!Number.isFinite(valor)) return null;
  return TRAMOS_NPR.find((t) => valor <= t.hasta) || TRAMOS_NPR[TRAMOS_NPR.length - 1];
}

/**
 * Paso 5 — el vínculo estadístico.
 *
 * Traduce la severidad del atributo en el requisito de confianza del muestreo
 * del PPQ: mientras más alta la severidad, más alta la confianza exigida. La
 * CONFIANZA no se ajusta —la fija el TR60—; lo que se ajusta es la cobertura.
 */
export const VINCULO_ESTADISTICO = [
  { severidades: [4, 5], etiqueta: "Alta (S=4-5)", confianza: 0.99, cobertura: 0.95 },
  { severidades: [3], etiqueta: "Media (S=3)", confianza: 0.95, cobertura: 0.9 },
  { severidades: [1, 2], etiqueta: "Baja (S=1-2)", confianza: 0.9, cobertura: 0.9 },
];

export function requisitoEstadistico(severidad) {
  return VINCULO_ESTADISTICO.find((v) => v.severidades.includes(severidad)) || null;
}

/**
 * El tamaño de muestra para un atributo de tipo pasa/no pasa, con cero
 * defectos: n = ln(1 − Confianza) / ln(Cobertura).
 *
 * Se calcula en vez de copiar la tabla porque la tabla son estos mismos tres
 * casos redondeados —≈90, ≈29, ≈22— y tenerlos como fórmula deja cambiar la
 * cobertura sin que el número se quede viejo.
 */
export function muestraPorAtributo(confianza, cobertura) {
  if (!(confianza > 0 && confianza < 1 && cobertura > 0 && cobertura < 1)) return null;
  return Math.ceil(Math.log(1 - confianza) / Math.log(cobertura));
}

/**
 * Paso 1 — la matriz de apoyo, adaptada del TR60 (Fig. 6.1-2).
 *
 * Cruza el tipo de impacto si el atributo falla con lo bien que se conoce esa
 * relación. La incertidumbre alta sube la severidad un punto: no saber es, a
 * efectos de riesgo, peor que saber.
 */
export const MATRIZ_SEVERIDAD = [
  { impacto: "Riesgo directo a seguridad del paciente o eficacia", certeza: 5, incertidumbre: 5 },
  { impacto: "Vínculo directo hacia una consecuencia grave, pero mitigado por controles aguas abajo", certeza: 4, incertidumbre: 5 },
  { impacto: "Vínculo indirecto (varios pasos causales) o CQA redefinido de forma más angosta por redundancia estructural", certeza: 3, incertidumbre: 4 },
  { impacto: "Atributo cosmético con posible correlación funcional", certeza: 2, incertidumbre: 3 },
  { impacto: "Atributo puramente estético, sin correlación funcional", certeza: 1, incertidumbre: 2 },
];

/** Las preguntas guía por nivel, para que dos evaluadores den lo mismo. */
export const PREGUNTAS_SEVERIDAD = {
  1: "¿Una variación del atributo prácticamente no tendría consecuencia para el paciente ni para el desempeño del producto?",
  2: "¿La variación tendría una consecuencia limitada y reversible, sin afectar seguridad ni eficacia?",
  3: "¿Existe una posibilidad razonable de que la variación afecte el desempeño del producto, por una vía indirecta?",
  4: "¿La variación podría afectar significativamente un atributo de calidad, aunque existan controles aguas abajo?",
  5: "¿La variación podría comprometer directamente la seguridad del paciente o la eficacia del medicamento?",
};

/** Las escalas de Probabilidad y Detectabilidad del Paso 4. */
export const ESCALA_PROBABILIDAD = [
  { valor: 5, nivel: "Muy alta", descripcion: "Rango de control estrecho respecto a la variabilidad natural del proceso" },
  { valor: 4, nivel: "Alta", descripcion: "Rango moderadamente estrecho; desviaciones registradas en procesos similares" },
  { valor: 3, nivel: "Media", descripcion: "Control demostrado pero sin amplio margen; requiere monitoreo" },
  { valor: 2, nivel: "Baja", descripcion: "Rango amplio respecto a la variabilidad esperada; control demostrado" },
  { valor: 1, nivel: "Muy baja", descripcion: "Parámetro fácilmente controlado, automatizado, o con rango muy holgado" },
];

export const ESCALA_DETECTABILIDAD = [
  { valor: 5, nivel: "Muy baja", descripcion: "Sin control en línea; se detecta sólo en análisis de producto terminado" },
  { valor: 4, nivel: "Baja", descripcion: "Detección fuera de línea, tras el lote, con retraso significativo" },
  { valor: 3, nivel: "Media", descripcion: "Muestreo en proceso a intervalos definidos" },
  { valor: 2, nivel: "Alta", descripcion: "Monitoreo en línea frecuente con alarmas/alertas" },
  { valor: 1, nivel: "Muy alta", descripcion: "Control continuo automatizado (PAT / control en tiempo real)" },
];

/**
 * Parámetros acoplados: los que comparten el mismo racional de riesgo en la
 * fuente heredan la misma severidad y el mismo CQA.
 *
 * El caso típico son el tiempo y la velocidad de una misma agitación: la
 * fuente los justifica con una sola frase, y separarlos en dos filas de la
 * tabla no crea dos causalidades distintas. Sin esto, la misma agitación
 * salía clasificada de dos formas según qué fila leyera quien evaluaba.
 */
export function acoplar(parametros) {
  const porRacional = new Map();
  for (const p of parametros) {
    const racional = String(p.racional || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!racional || racional.length < 25) continue;
    const clave = `${p.etapa}|${racional}`;
    if (!porRacional.has(clave)) porRacional.set(clave, []);
    porRacional.get(clave).push(p);
  }

  const salida = parametros.map((p) => ({ ...p }));
  for (const grupo of porRacional.values()) {
    if (grupo.length < 2) continue;
    // La unión de los atributos que cualquiera de ellos nombra: si la fuente
    // los justifica igual, afectan a lo mismo.
    const atributos = [];
    for (const p of grupo) {
      for (const a of p.afecta || []) {
        const nombre = typeof a === "string" ? a : a?.atributo;
        if (nombre && !atributos.includes(nombre)) atributos.push(nombre);
      }
    }
    const sospecha = grupo.some((p) => p.sospecha);
    for (const p of grupo) {
      const i = parametros.indexOf(p);
      salida[i] = { ...salida[i], afecta: atributos, sospecha, acoplado: grupo.length };
    }
  }
  return salida;
}

/**
 * La evaluación completa: Paso 3 sobre todos los parámetros, más el recuento.
 *
 * Devuelve también `paraFmea`, que es lo único que el Paso 4 tiene que mirar.
 * Antes el FMEA se hacía sobre todos los candidatos; ahora la severidad ya
 * resolvió la clasificación, y el FMEA se reserva a los Críticos para
 * priorizar entre ellos y diseñar su control.
 */
export function evaluar(parametros, severidadPorAtributo) {
  const acoplados = acoplar(parametros);
  const filas = acoplados.map((p) => ({ ...p, ...clasificar(p, severidadPorAtributo) }));

  return {
    filas,
    paraFmea: filas.filter((f) => f.requiereFmea),
    resumen: {
      total: filas.length,
      criticos: filas.filter((f) => f.clasificacion === CRITICO).length,
      claves: filas.filter((f) => f.clasificacion === CLAVE).length,
      noClaves: filas.filter((f) => f.clasificacion === NO_CLAVE).length,
      pendientes: filas.filter((f) => f.clasificacion === null).length,
    },
  };
}
