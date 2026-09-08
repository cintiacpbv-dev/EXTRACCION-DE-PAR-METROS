// El informe con la estructura de 18 secciones de un protocolo de
// validación, armado con lo que de verdad se corrió en la sesión.
//
// La regla que manda aquí: cada sección se llena con los análisis que le
// corresponden, y la que no tiene ninguno se rotula "NO EVALUADO" — nunca
// se rellena con texto de relleno ni se omite en silencio. Un informe al
// que le falta una sección y no lo dice es peor que uno que dice qué le
// falta.
//
// Las dos primeras secciones (Objetivo y Alcance) no salen de los datos:
// las sabe la persona, no la hoja de cálculo. Se dejan con una marca
// "[Completar]" bien visible en vez de inventarlas.
import { ESTADO } from "./estado.js";
import { motorConclusion, ETAPAS, ultimoHallazgoPorEtapa } from "./dashboard.js";
import { hastaElUltimoDato } from "./descriptiva.js";

/**
 * A qué sección va cada resultado o gráfico, por cómo se titula.
 *
 * Los títulos no son texto libre: los arma AnalysisAssistant con un prefijo
 * fijo por análisis ("Prueba de normalidad: pH", "Tukey HSD (…)", "I-MR —
 * Espesor"), así que reconocerlos por ahí es fiable. El orden de esta lista
 * importa: "Residuos vs. ajustados" tiene que probarse ANTES que la regla
 * genérica de los diagramas de dispersión ("Y vs. X"), o los residuos de
 * una regresión acabarían archivados como correlación.
 */
const REGLAS = [
  { seccion: 4, patron: /^Calidad de datos/i },
  { seccion: 8, patron: /^Valores atípicos/i },
  { seccion: 9, patron: /Gage R&R|^Componentes de varianza/i },
  { seccion: 10, patron: /^I-MR —|^Xbar-R —|^Carta I-MR|^Carta Xbar-R/i },
  { seccion: 11, patron: /^Capacidad/i },
  { seccion: 14, patron: /^Regresión:|^Ajuste del modelo|^Normalidad de los residuos|heterocedasticidad|^Residuos vs\. ajustados/i },
  { seccion: 12, patron: /ANOVA|Tukey|Welch|Games-Howell|Kruskal-Wallis|^Prueba de varianzas|^Prueba t|^Gráfica de intervalos|^Prueba de proporción/i },
  { seccion: 13, patron: /^Correlación|^Matriz de correlación|Spearman/i },
  { seccion: 7, patron: /^Prueba de normalidad|^Gráfica de probabilidad/i },
  { seccion: 15, patron: /^Variables críticas/i },
  { seccion: 17, patron: /^Estado del proyecto por etapa/i },
  { seccion: 6, patron: /^Estadística descriptiva|^Histograma|^Diagrama de caja/i },
  { seccion: 18, patron: /^Diseño factorial|^Pareto de efectos/i },
  // Un diagrama de dispersión suelto se titula "Y vs. X", sin prefijo: va a
  // Correlación, pero sólo después de haber descartado todo lo de arriba.
  { seccion: 13, patron: / vs\. /i },
];

function seccionDe(titulo) {
  for (const r of REGLAS) if (r.patron.test(titulo)) return r.seccion;
  // Lo que no encaje en ninguna no se pierde: cae en Anexos. Es la red de
  // seguridad para que el informe nunca tenga menos elementos que la sesión.
  return 18;
}

const TITULOS = [
  "Objetivo",
  "Alcance",
  "Fuente de datos",
  "Calidad de datos",
  "Variables analizadas",
  "Estadística descriptiva",
  "Distribución",
  "Outliers",
  "Sistema de medición",
  "Estabilidad",
  "Capacidad",
  "Comparación de lotes",
  "Correlación",
  "Regresión",
  "Variables críticas",
  "Limitaciones",
  "Conclusión",
  "Anexos estadísticos",
];

// Qué etapa del dashboard respalda cada sección, para poder poner su estado
// al lado del título. Las secciones que no son un análisis (Objetivo,
// Alcance, Limitaciones…) no llevan estado: no hay nada que clasificar.
const ETAPA_DE_SECCION = {
  4: "calidad",
  7: "distribucion",
  9: "msa",
  10: "estabilidad",
  11: "capacidad",
  12: "lotes",
  13: "variables_criticas",
  14: "variables_criticas",
  15: "variables_criticas",
};

/**
 * Lo que este módulo NO comprueba, dicho en el propio informe.
 *
 * Va escrito a mano porque son límites de la implementación, no de los
 * datos: quien firma el protocolo tiene que saber qué alcance real tiene
 * cada número que está leyendo. Sólo se incluyen las que aplican a lo que
 * de verdad se corrió — enumerar limitaciones de un análisis que nadie hizo
 * es ruido.
 */
const LIMITACIONES = [
  { etapa: "estabilidad", texto: "Las cartas de control evalúan sólo la regla 1 de Western Electric (puntos fuera de los límites de 3σ). No se evalúan rachas, tendencias ni los demás patrones de causa especial, así que \"sin puntos fuera de control\" no equivale a \"proceso estadísticamente estable\" en el sentido completo del término." },
  { etapa: "msa", texto: "El estudio del sistema de medición cubre repetibilidad y reproducibilidad (Gage R&R cruzado y balanceado, método ANOVA de AIAG). No incluye estudios de sesgo, linealidad ni estabilidad del instrumento, que requieren patrones de referencia con valor conocido." },
  { etapa: "capacidad", texto: "Los índices de capacidad asumen que los datos siguen una distribución normal. Si la sección de Distribución encontró evidencia en contra de la normalidad, los índices y las PPM esperadas deben interpretarse con reserva o recalcularse con un método para distribuciones no normales." },
  { etapa: "lotes", texto: "No rechazar la hipótesis de igualdad entre grupos no demuestra que los grupos sean equivalentes: sólo indica que, con el tamaño de muestra y el α usados, no se detectó evidencia suficiente de diferencia. Una prueba de equivalencia formal (TOST) responde a una pregunta distinta y no está implementada." },
  { etapa: "variables_criticas", texto: "La correlación y la regresión establecen asociación estadística, no causalidad. Atribuir una relación causa-efecto exige el conocimiento del proceso y, cuando corresponde, un diseño experimental." },
];

/**
 * Arma el informe completo.
 *
 * Devuelve una estructura de secciones que exportar.js convierte en .docx —
 * este archivo no sabe nada de Word, y así se puede probar la lógica de
 * clasificación sin generar un documento.
 */
export function construirInforme({ resultados = [], graficos = [], hallazgos = [], columns = [], hojas = [] }) {
  const items = [
    ...resultados.map((r) => ({ ...r, tipo: "resultado" })),
    ...graficos.map((g) => ({ ...g, tipo: "grafico" })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  const porSeccion = {};
  for (let i = 1; i <= 18; i++) porSeccion[i] = [];
  for (const item of items) porSeccion[seccionDe(item.titulo)].push(item);

  const porEtapa = ultimoHallazgoPorEtapa(hallazgos);
  const conclusion = motorConclusion(hallazgos);

  // --- las secciones que se arman con texto, no con análisis ---------------

  const columnasConDatos = columns.filter((c) => c.values.some((v) => v != null));
  const filasUsadas = Math.max(0, ...columnasConDatos.map((c) => hastaElUltimoDato(c.values).length));

  const fuenteDatos = [
    `Informe generado el ${new Date().toLocaleString("es-PE")}.`,
    hojas.length > 0
      ? `Hoja(s) de trabajo del proyecto: ${hojas.map((h) => h.nombre).join(", ")}.`
      : "Sin hojas de trabajo registradas.",
    `${columnasConDatos.length} columna(s) con datos, hasta ${filasUsadas} fila(s) por columna.`,
    "[Completar] Origen de los datos: registro de lote, número de protocolo, equipo e instrumentos, y responsable de la toma de datos.",
  ];

  const variablesAnalizadas =
    columnasConDatos.length > 0
      ? {
          encabezados: ["Variable", "Tipo", "Datos"],
          filas: columnasConDatos.map((c) => [
            c.name,
            c.type === "numeric" ? "Numérica" : c.type === "date" ? "Fecha" : "Texto",
            String(hastaElUltimoDato(c.values).filter((v) => v != null).length),
          ]),
        }
      : null;

  const limitacionesAplicables = LIMITACIONES.filter((l) => porEtapa[l.etapa]).map((l) => l.texto);
  const sinEvaluar = ETAPAS.filter((e) => !porEtapa[e.id]);
  if (sinEvaluar.length > 0) {
    limitacionesAplicables.unshift(
      `NO EVALUADO — no se corrió ningún análisis para: ${sinEvaluar.map((e) => e.nombre).join(", ")}. Este informe no dice nada sobre esos aspectos, ni a favor ni en contra.`
    );
  }

  // --- el montaje final ----------------------------------------------------

  const secciones = TITULOS.map((titulo, i) => {
    const numero = i + 1;
    const etapa = ETAPA_DE_SECCION[numero];
    const propios = porSeccion[numero];
    // El estado se muestra sólo si la sección tiene análisis propios. Tres
    // secciones (Correlación, Regresión, Variables críticas) comparten la
    // misma etapa del dashboard, así que sin esto una correlación dejaba a
    // Regresión rotulada "REQUIERE REVISIÓN" sin que nadie hubiera corrido
    // ninguna regresión — un estado prestado de otro análisis, que es
    // justamente lo que no debe pasar en un informe.
    const hallazgo = etapa && propios.length > 0 ? porEtapa[etapa] : null;
    const seccion = {
      numero,
      titulo,
      estado: etapa ? hallazgo?.estado ?? ESTADO.NO_EVALUADO : null,
      parrafos: [],
      tablas: [],
      items: propios,
    };

    if (numero === 1) {
      seccion.parrafos.push(
        "[Completar] Objetivo del análisis: qué se quiere demostrar con estos datos (por ejemplo, que el proceso de fabricación de un producto es capaz y reproducible en tres lotes consecutivos)."
      );
    } else if (numero === 2) {
      seccion.parrafos.push(
        "[Completar] Alcance: producto, presentación, lotes incluidos, etapas del proceso cubiertas y periodo de fabricación."
      );
    } else if (numero === 3) {
      seccion.parrafos.push(...fuenteDatos);
    } else if (numero === 5) {
      if (variablesAnalizadas) seccion.tablas.push(variablesAnalizadas);
      else seccion.parrafos.push("NO EVALUADO — la hoja de trabajo no tiene datos.");
    } else if (numero === 16) {
      seccion.parrafos.push(...limitacionesAplicables);
      if (limitacionesAplicables.length === 0) seccion.parrafos.push("No aplica: no se corrió ningún análisis todavía.");
    } else if (numero === 17) {
      seccion.parrafos.push(conclusion.texto);
      seccion.tablas.push({
        encabezados: ["Etapa", "Estado", "Último hallazgo"],
        filas: conclusion.filas.map((f) => [f.etapa, f.estado, f.resumen]),
      });
    }

    // Cualquier sección de análisis que se quedó sin nada lo dice, en vez de
    // aparecer vacía y dejar pensando si es que no se hizo o si es que salió
    // bien y no había nada que reportar.
    if (seccion.items.length === 0 && seccion.parrafos.length === 0 && seccion.tablas.length === 0) {
      seccion.parrafos.push("NO EVALUADO — no se corrió ningún análisis de esta sección.");
    }

    return seccion;
  });

  return { secciones, totalItems: items.length, conclusion };
}
