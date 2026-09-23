// El documento de la Evaluación de Criticidad y Riesgo: los 7 pasos, en Word
// para el expediente y en Excel para seguir trabajando la matriz.
//
// La estructura es la de las dos corridas reales (Producto 1 inyectable y
// Producto 2 tableta recubierta): declaración de gap, equipo, descripción del
// proceso, y después los Pasos 0 a 6 con sus cuadros y sus reglas escritas
// donde corresponde.
//
// Se puede emitir entero o por partes: `pasos` dice cuáles entran. Sale
// completo por defecto, que es como están hechos los bosquejos, pero la
// clasificación (0-3) y el FMEA con el vínculo estadístico (4-6) se pueden
// separar cuando se revisan en momentos distintos.

import {
  AlignmentType,
  Document,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import { encabezadoYPie } from "./exportEncabezado.js";
import { logoPorDefecto } from "./logoEmpresa.js";
import {
  CRITICO,
  ESCALA_DETECTABILIDAD,
  ESCALA_PROBABILIDAD,
  MATRIZ_SEVERIDAD,
  PREGUNTAS_SEVERIDAD,
  TRAMOS_NPR,
  nivelDeNpr,
} from "./criticidad/modelo.js";
import {
  DECLARACION_DE_GAP,
  DEFINICIONES,
  EQUIPO_MULTIDISCIPLINARIO,
  ESTADOS,
  EXPLICACION_ESTADISTICA,
  MOTIVOS_DE_REVISION,
  NOTA_DE_PROCEDENCIA,
  OBJETIVOS,
  PAUTA_CAUSA_EFECTO,
  PLAN_DE_REEVALUACION,
  REGLA_PARTIDA,
  REGLAS,
  VIA_NO_ESCRITA,
} from "./criticidad/textos.js";
import { formaDelProducto, partidaSinConfirmar } from "./criticidad/puntoDePartida.js";

const FUENTE = "Arial";
const TAM = 14;
const TAM_TITULO = 22;
const TAM_PASO = 18;
const AZUL_CABECERA = "C6D9F1";
const AMARILLO_CRITICO = "FFFF00";
// Los colores del NPR, los mismos que nombra el procedimiento.
const COLOR_NPR = { VERDE: "C6EFCE", AMARILLO: "FFEB9C", ROJO: "FFC7CE" };
const GRIS_REGLA = "F2F2F2";

// A4 apaisada: los cuadros del Paso 2 y del Paso 4 tienen siete columnas y
// sus justificaciones son frases. En vertical no se leen.
const A4_ANCHO = 11907;
const A4_ALTO = 16840;
const MARGEN = { top: 993, right: 993, bottom: 993, left: 993 };
const ANCHO_UTIL = A4_ALTO - MARGEN.left - MARGEN.right; // apaisada: el largo manda

export const TODOS_LOS_PASOS = [0, 1, 2, 3, 4, 5, 6];

function parrafo(texto, { bold, align, size = TAM, italic, espacio } = {}) {
  return new Paragraph({
    alignment: align,
    spacing: { before: espacio ? 160 : 20, after: espacio ? 80 : 20 },
    children: [new TextRun({ text: String(texto ?? ""), font: FUENTE, size, bold, italics: italic })],
  });
}

function titulo(texto, { size = TAM_PASO } = {}) {
  return new Paragraph({
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text: texto, font: FUENTE, size, bold: true })],
  });
}

/** Una regla del procedimiento, en su recuadro gris: se lee como lo que es. */
function regla(texto) {
  return new Table({
    width: { size: ANCHO_UTIL, type: WidthType.DXA },
    columnWidths: [ANCHO_UTIL],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: ANCHO_UTIL, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: GRIS_REGLA },
            children: [parrafo(texto, { size: 13, italic: true })],
          }),
        ],
      }),
    ],
  });
}

function celda(contenido, { bold, align, fill, width, colSpan } = {}) {
  const lineas = Array.isArray(contenido) ? contenido : [contenido];
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: lineas.map((l) => (typeof l === "object" && l !== null ? l : parrafo(l, { bold, align }))),
  });
}

/**
 * Un cuadro con su cabecera azul.
 *
 * `anchos` se dan en proporción y se reescalan para sumar exactamente el
 * ancho útil: una tabla que asoma fuera del margen se imprime cortada, y con
 * siete columnas es fácil pasarse sin darse cuenta.
 */
function cuadro(cabeceras, filas, proporciones, { vacio } = {}) {
  const suma = proporciones.reduce((a, b) => a + b, 0);
  const anchos = proporciones.map((p) => Math.round((p / suma) * ANCHO_UTIL));
  anchos[anchos.length - 1] += ANCHO_UTIL - anchos.reduce((a, b) => a + b, 0);

  const cuerpo = filas.map(
    (f) =>
      new TableRow({
        children: f.map((c, i) =>
          celda(c?.texto ?? c, { width: anchos[i], fill: c?.fill, align: c?.align })
        ),
      })
  );

  if (cuerpo.length === 0 && vacio) {
    cuerpo.push(
      new TableRow({
        children: [celda(vacio, { colSpan: cabeceras.length, align: AlignmentType.CENTER, width: ANCHO_UTIL })],
      })
    );
  }

  return new Table({
    width: { size: ANCHO_UTIL, type: WidthType.DXA },
    columnWidths: anchos,
    rows: [
      new TableRow({
        tableHeader: true,
        children: cabeceras.map((t, i) =>
          celda(t, { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: anchos[i] })
        ),
      }),
      ...cuerpo,
    ],
  });
}

/**
 * La respuesta a la pregunta de desempeño de proceso, para el cuadro.
 *
 * Es la que decide entre Clave y No Clave, así que tiene que constar junto a
 * la clasificación: un «No Clave» sin decir que se contestó que NO parece un
 * hueco, y es al revés — es el resultado correcto y esperado.
 */
export function respuestaDeDesempeno(fila) {
  if (fila.clasificacion === CRITICO) return "No aplica (Crítico por severidad)";
  const respuesta = fila.desempeno === true ? "Sí" : fila.desempeno === false ? "No" : "Sin responder";
  const marca = fila.desempenoRevisado ? " (revisada)" : "";
  return fila.desempenoMotivo ? `${respuesta}${marca} — ${fila.desempenoMotivo}` : `${respuesta}${marca}`;
}

/** Lo que se escribe en la columna «Estado» del Paso 2, con las palabras del procedimiento. */
export function estadoDe(fila) {
  return fila.sospecha ? ESTADOS.candidato : ESTADOS.sinSospecha;
}

/** Y de dónde salió esa sospecha, que es lo que hay que poder revisar. */
export function fuenteDe(fila) {
  if (fila.fuenteSospecha === "protocolo") {
    return fila.acopladoCon
      ? `Análisis de riesgo del protocolo (racional compartido con «${fila.acopladoCon}»)`
      : "Análisis de riesgo del protocolo";
  }
  if (fila.fuenteSospecha === "IA+bibliografía") {
    return `Propuesta por IA, respaldada por${fila.referencias ? `: ${fila.referencias}` : " la bibliografía"}`;
  }
  if (fila.fuenteSospecha === "bibliografía") return `Bibliografía — ${fila.referencias || "sin referencia"}`;
  if (fila.fuenteSospecha === "IA") return "Propuesta por IA — revisar";
  return "Sin resolver";
}

/** Paso 6 — qué parámetros conviene revisar cuando haya data histórica. */
export function paraRevisarConDataHistorica(filas) {
  const salida = [];
  for (const f of filas) {
    if (f.clasificacion !== CRITICO) continue;
    if (!f.criterios?.length) {
      salida.push({ parametro: f.magnitud, etapa: f.etapa, motivo: MOTIVOS_DE_REVISION.sinCriterio });
      continue;
    }
    if (f.fuenteSospecha === "IA") {
      salida.push({ parametro: f.magnitud, etapa: f.etapa, motivo: MOTIVOS_DE_REVISION.sinRespaldo });
    }
  }
  return salida;
}

function porEtapa(filas) {
  const mapa = new Map();
  for (const f of filas) {
    if (!mapa.has(f.etapa)) mapa.set(f.etapa, []);
    mapa.get(f.etapa).push(f);
  }
  return [...mapa.entries()];
}

// --- los pasos, uno por uno -------------------------------------------------

function bloquePaso0(atributos) {
  // Dos cuadros, como en las corridas: la especificación del producto
  // terminado, y aparte los atributos que sólo aparecen citados en el
  // análisis de riesgo o medidos en el registro (los intermedios).
  const deEspecificacion = atributos.filter((a) => a.origen === "especificación");
  const adicionales = atributos.filter((a) => a.origen !== "especificación");
  const salida = [
    titulo("Paso 0 — Identificación de Atributos de Calidad"),
    parrafo(OBJETIVOS[0], { size: 13, italic: true }),
  ];

  if (deEspecificacion.length > 0) {
    salida.push(
      parrafo("Atributos de calidad del producto terminado (especificación)", { bold: true, espacio: true }),
      cuadro(
        ["Atributo de Calidad", "Ensayo", "Especificación", "NT", "Tipo de dato"],
        deEspecificacion.map((a) => [a.nombre, a.ensayo || "—", a.especificacion || "—", { texto: a.norma || "—", align: AlignmentType.CENTER }, a.tipoDeDato || "—"]),
        [3, 3.2, 4, 0.8, 1.5]
      )
    );
  }

  salida.push(
    parrafo(
      deEspecificacion.length > 0
        ? "Atributos adicionales encontrados en el análisis de riesgo o en el registro de manufactura"
        : "Atributos de calidad identificados",
      { bold: true, espacio: true }
    ),
    cuadro(
      ["Atributo de Calidad", "Criterio de aceptación", "Dónde se identificó", "Tipo de dato"],
      adicionales.map((a) => [
        a.nombre,
        a.criterios?.join(" ; ") || "—",
        `${a.origen === "análisis de riesgo" ? "Análisis de riesgo" : a.origen === "protocolo" ? "Protocolo" : "Registro de manufactura"} · ${(a.etapas || [a.etapa]).filter(Boolean).join(", ") || "—"}`,
        a.tipoDeDato || "—",
      ]),
      [3.5, 3.5, 3.5, 1.5],
      { vacio: deEspecificacion.length > 0 ? "Ninguno: todos los atributos citados están en la especificación." : "No se reconoció ningún atributo de calidad." }
    )
  );
  return salida;
}

function bloquePaso1(severidades) {
  return [
    titulo("Paso 1 — Severidad por Atributo"),
    parrafo(OBJETIVOS[1], { size: 13, italic: true }),
    regla(REGLAS.umbral),
    parrafo("Matriz de apoyo — Severidad × Incertidumbre (adaptada de PDA TR60, Fig. 6.1-2)", { bold: true, espacio: true }),
    cuadro(
      ["Tipo de impacto si el atributo falla", "Incertidumbre baja", "Incertidumbre alta"],
      MATRIZ_SEVERIDAD.map((m) => [m.impacto, { texto: String(m.certeza), align: AlignmentType.CENTER }, { texto: String(m.incertidumbre), align: AlignmentType.CENTER }]),
      [6, 2, 2]
    ),
    parrafo("Severidad asignada", { bold: true, espacio: true }),
    cuadro(
      ["Atributo", "Severidad", "Decisión", "Justificación", "Origen"],
      severidades.map((s) => [
        s.atributo,
        { texto: String(s.severidad), align: AlignmentType.CENTER, fill: s.severidad >= 4 ? AMARILLO_CRITICO : undefined },
        s.decision || "—",
        s.justificacion || "—",
        s.origen === "revisada" ? "Revisada" : "Propuesta por IA",
      ]),
      [3, 1, 2, 5, 2],
      { vacio: "Sin severidades asignadas." }
    ),
    parrafo("Preguntas guía por nivel (para reproducibilidad entre evaluadores)", { bold: true, espacio: true }),
    cuadro(
      ["Nivel", "Pregunta guía"],
      Object.entries(PREGUNTAS_SEVERIDAD).map(([n, q]) => [{ texto: n, align: AlignmentType.CENTER }, q]),
      [1, 11]
    ),
  ];
}

function bloquePaso2(filas) {
  const salida = [
    titulo("Paso 2 — Análisis Causa-Efecto (Screening por Parámetro)"),
    parrafo(OBJETIVOS[2], { size: 13, italic: true }),
    parrafo(
      "Los tres ingredientes obligatorios de cada fila: (1) sospecha sí/no, (2) qué Atributo de Calidad, (3) de dónde sale la sospecha. " +
        "«Estado» indica sólo si el parámetro pasa a evaluarse; no es la clasificación final.",
      { size: 13 }
    ),
    regla(PAUTA_CAUSA_EFECTO),
    regla(REGLAS.acoplados),
  ];

  for (const [etapa, suyas] of porEtapa(filas)) {
    salida.push(parrafo(`Etapa: ${etapa}`, { bold: true, espacio: true }));
    salida.push(
      cuadro(
        ["Parámetro", "Criterio del registro", "Origen de la sospecha", "Afecta a", "Estado", "Fuente"],
        suyas.map((f) => [
          f.magnitud,
          f.criterios?.join(" ; ") || "—",
          f.racional || "—",
          f.afecta?.join(" / ") || "No afecta ningún atributo",
          estadoDe(f),
          fuenteDe(f),
        ]),
        [3, 2, 5, 2.5, 2, 2.5]
      )
    );
  }
  return salida;
}

function bloquePaso3(filas, { forma } = {}) {
  const salida = [
    titulo("Paso 3 — Clasificación"),
    parrafo(OBJETIVOS[3], { size: 13, italic: true }),
    regla(REGLAS.clasificacion),
    regla(VIA_NO_ESCRITA),
    regla(REGLAS.severidadCalculada),
  ];

  // Cuando el protocolo traía su propio análisis, su clasificación (en el
  // esquema anterior: Crítico / Potencial / Clave) sale al lado de la nueva.
  // Es lo que hay que poder revisar al pasar de un esquema al otro.
  const conAnterior = filas.some((f) => f.clasificacionAnterior);

  for (const [etapa, suyas] of porEtapa(filas)) {
    salida.push(parrafo(`Etapa: ${etapa}`, { bold: true, espacio: true }));
    const cabeceras = ["Parámetro", "Atributo vinculado", "Severidad", "Vía de resolución", "¿Afecta al desempeño?"];
    const proporciones = [2.6, 2.6, 1.1, 3, 2.7];
    if (conAnterior) {
      cabeceras.push("Clasificación anterior");
      proporciones.push(1.6);
    }
    cabeceras.push("Clasificación");
    proporciones.push(1.8);

    salida.push(
      cuadro(
        cabeceras,
        suyas.map((f) => [
          f.magnitud,
          f.afecta?.join(" / ") || "—",
          { texto: f.severidad === null || f.severidad === undefined ? "N/A" : String(f.severidad), align: AlignmentType.CENTER },
          f.via,
          respuestaDeDesempeno(f),
          ...(conAnterior ? [{ texto: f.clasificacionAnterior || "—", align: AlignmentType.CENTER }] : []),
          {
            texto: f.clasificacion || "Pendiente",
            align: AlignmentType.CENTER,
            fill: f.clasificacion === CRITICO ? AMARILLO_CRITICO : undefined,
          },
        ]),
        proporciones
      )
    );
  }
  salida.push(regla(REGLAS.noClave));

  const partida = partidaSinConfirmar(filas, CRITICO, forma);
  salida.push(
    parrafo("Verificación de los parámetros críticos de punto de partida", { bold: true, espacio: true }),
    regla(REGLA_PARTIDA),
    cuadro(
      ["Etapa", "Parámetro", "Punto de partida del procedimiento", "Clasificación obtenida", "Motivo"],
      partida.map((x) => [x.etapa, x.parametro, `${x.partida}. ${x.fundamento}`, x.clasificacion, x.motivo]),
      [2, 2.6, 4, 1.6, 3.4],
      { vacio: "Todos los parámetros de punto de partida del procedimiento quedaron como Críticos." }
    )
  );
  return salida;
}

function bloquePaso4(fmea) {
  const salida = [
    titulo("Paso 4 — FMEA (exclusivo para parámetros Críticos)"),
    parrafo(OBJETIVOS[4], { size: 13, italic: true }),
    parrafo(
      "Se documenta en el formato FASC-252 vigente «Análisis de Riesgo». Severidad: la definida para el atributo en el Paso 1. " +
        "Ocurrencia: las desviaciones y/o no conformidades registradas asociadas al punto evaluado. " +
        "Detectabilidad: en qué parte de la secuencia de validación se detecta.",
      { size: 13 }
    ),
    parrafo("Ocurrencia / Probabilidad (P)", { bold: true, espacio: true }),
    cuadro(
      ["Valor", "Nivel", "Historial", "Criterio de apoyo"],
      ESCALA_PROBABILIDAD.map((e) => [{ texto: String(e.valor), align: AlignmentType.CENTER }, e.nivel, e.historial, e.descripcion]),
      [0.8, 1.6, 4.8, 4.8]
    ),
    parrafo("Detectabilidad (D)", { bold: true, espacio: true }),
    cuadro(
      ["Valor", "Nivel", "Momento de la secuencia de validación", "Criterio de apoyo"],
      ESCALA_DETECTABILIDAD.map((e) => [{ texto: String(e.valor), align: AlignmentType.CENTER }, e.nivel, e.momento, e.descripcion]),
      [0.8, 2, 4.4, 4.8]
    ),
    parrafo(`Parámetros Críticos evaluados (${fmea.length})`, { bold: true, espacio: true }),
    cuadro(
      ["Parámetro", "Atributo vinculado", "S", "P", "D", "NPR", "Nivel de riesgo", "Racional / evidencia"],
      fmea.map((f) => {
        const nivel = nivelDeNpr(f.npr);
        return [
          f.magnitud,
          f.afecta?.join(" / ") || "—",
          { texto: String(f.severidad ?? "—"), align: AlignmentType.CENTER },
          { texto: String(f.probabilidad ?? "—"), align: AlignmentType.CENTER },
          { texto: String(f.detectabilidad ?? "—"), align: AlignmentType.CENTER },
          { texto: String(f.npr ?? "—"), align: AlignmentType.CENTER },
          nivel
            ? { texto: `${nivel.color} — ${nivel.nivel}`, align: AlignmentType.CENTER, fill: COLOR_NPR[nivel.color] }
            : { texto: "—", align: AlignmentType.CENTER },
          f.racionalFmea || "—",
        ];
      }),
      [2.8, 2.4, 0.6, 0.6, 0.6, 0.8, 1.8, 4.4],
      { vacio: "No hay parámetros Críticos que evaluar." }
    ),
    parrafo("Nivel de riesgo (NPR) — herramienta secundaria, no determina la clasificación", { bold: true, espacio: true }),
    cuadro(
      ["Rango NPR", "Color", "Nivel", "Consecuencia"],
      [...TRAMOS_NPR].reverse().map((t) => {
        const i = TRAMOS_NPR.indexOf(t);
        return [
          { texto: `${i === 0 ? 1 : TRAMOS_NPR[i - 1].hasta + 1} – ${t.hasta}`, align: AlignmentType.CENTER },
          { texto: t.color, align: AlignmentType.CENTER, fill: COLOR_NPR[t.color] },
          t.nivel,
          t.uso,
        ];
      }),
      [1.4, 1.4, 1.6, 7.6]
    ),
    regla(REGLAS.npr),
    regla(REGLAS.redundancia),
  ];
  return salida;
}

function bloquePaso5(estadistico) {
  return [
    titulo("Paso 5 — Vínculo Estadístico"),
    parrafo(OBJETIVOS[5], { size: 13, italic: true }),
    regla(REGLAS.confianza),
    cuadro(
      ["Calificación de Severidad", "Confianza", "Cobertura", "Dato continuo — intervalo de tolerancia (Promedio ± k·s)", "Dato de atributo — confianza-confiabilidad, cero defectos"],
      estadistico.map((e) => [
        e.etiqueta,
        { texto: `${Math.round(e.confianza * 100)} %`, align: AlignmentType.CENTER },
        { texto: `${Math.round(e.cobertura * 100)} %`, align: AlignmentType.CENTER },
        (e.continuos || []).join(", ") || "—",
        (e.deAtributo || []).length ? `n ≈ ${e.n} · ${e.deAtributo.join(", ")}` : "—",
      ]),
      [2, 1.2, 1.2, 4, 4],
      { vacio: "Sin atributos con severidad asignada." }
    ),
    parrafo("Cómo se traduce el nivel de confianza y cobertura en un requisito de muestreo real", { bold: true, espacio: true }),
    ...EXPLICACION_ESTADISTICA.map((t) => parrafo(`· ${t}`, { size: 13 })),
  ];
}

function bloquePaso6(filas) {
  const aRevisar = paraRevisarConDataHistorica(filas);
  return [
    titulo("Paso 6 — Plan de Reevaluación"),
    parrafo(OBJETIVOS[6], { size: 13, italic: true }),
    cuadro(
      ["Disparador de reevaluación", "Responsable", "Acción"],
      PLAN_DE_REEVALUACION.map((p) => [p.disparador, p.responsable, p.accion]),
      [4, 3, 5]
    ),
    parrafo("Parámetros a revisar con data histórica", { bold: true, espacio: true }),
    cuadro(
      ["Parámetro", "Etapa", "Por qué es sensible"],
      aRevisar.map((r) => [r.parametro, r.etapa, r.motivo]),
      [3, 2.5, 6.5],
      { vacio: "Ninguno: todos los Críticos tienen criterio impreso y respaldo." }
    ),
  ];
}

// --- el documento entero ----------------------------------------------------

export function construirCriticidad({
  producto = "",
  forma = "",
  lote = "",
  etapas = [],
  atributos = [],
  severidades = [],
  filas = [],
  fmea = [],
  estadistico = [],
  resumen = null,
  pasos = TODOS_LOS_PASOS,
  opciones = {},
}) {
  const incluye = (n) => pasos.includes(n);
  const hijos = [
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `EVALUACIÓN DE CRITICIDAD Y RIESGO${producto ? ` — ${producto}` : ""}`,
          font: FUENTE,
          size: TAM_TITULO,
          bold: true,
        }),
      ],
    }),
    parrafo(`Producto: ${producto || "_____________________"}${forma ? `  |  Forma farmacéutica: ${forma}` : ""}`),
    parrafo(`Lote: ${lote || "_____________________"}`),
  ];

  if (resumen) {
    hijos.push(
      parrafo(
        `${resumen.total} parámetros evaluados: ${resumen.criticos} Críticos, ${resumen.claves} Clave, ` +
          `${resumen.noClaves} No Clave${resumen.pendientes ? `, ${resumen.pendientes} pendientes de la pregunta de desempeño` : ""}.`,
        { bold: true }
      )
    );
  }

  // Las secciones de contexto sólo tienen sentido con el documento completo.
  if (incluye(0)) {
    hijos.push(
      titulo("Definiciones", { size: 16 }),
      cuadro(["Término", "Definición"], DEFINICIONES.map(([a, b]) => [{ texto: a }, b]), [3, 9]),
      titulo("Declaración de Gap", { size: 16 }),
      parrafo(DECLARACION_DE_GAP, { size: 13 }),
      titulo("Equipo Multidisciplinario", { size: 16 }),
      parrafo(EQUIPO_MULTIDISCIPLINARIO, { size: 13 }),
      titulo("Descripción del Proceso — Etapas", { size: 16 }),
      cuadro(
        ["N°", "Etapa", "Parámetros evaluados", "Atributos que se miden en ella"],
        etapas.map((e, i) => [
          { texto: String(i + 1), align: AlignmentType.CENTER },
          e.etapa,
          { texto: String(e.parametros), align: AlignmentType.CENTER },
          e.atributos.join(", ") || "—",
        ]),
        [0.8, 3, 2, 6.2],
        { vacio: "Sin etapas reconocidas." }
      )
    );
  }

  if (incluye(0)) hijos.push(...bloquePaso0(atributos));
  if (incluye(1)) hijos.push(...bloquePaso1(severidades));
  if (incluye(2)) hijos.push(...bloquePaso2(filas));
  if (incluye(3)) hijos.push(...bloquePaso3(filas, { forma: formaDelProducto(forma, producto) }));
  if (incluye(4)) hijos.push(...bloquePaso4(fmea));
  if (incluye(5)) hijos.push(...bloquePaso5(estadistico));
  if (incluye(6)) hijos.push(...bloquePaso6(filas));

  hijos.push(
    new Paragraph({ spacing: { before: 240, after: 120 }, children: [] }),
    parrafo(NOTA_DE_PROCEDENCIA, { size: 12 }),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
    parrafo("Cumple criterios de aceptación: (SI/NO): ______, en caso de NO refiera N° de desviación: ______"),
    new Paragraph({ spacing: { after: 200 }, children: [] }),
    cuadro(["Elaborado por", "Fecha", "Revisado por", "Fecha", "Aprobado por", "Fecha"], [["", "", "", "", "", ""]], [2.5, 1.5, 2.5, 1.5, 2.5, 1.5])
  );

  const doc = new Document({
    styles: { default: { document: { run: { font: FUENTE, size: TAM } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_ANCHO, height: A4_ALTO, orientation: PageOrientation.LANDSCAPE },
            margin: MARGEN,
          },
        },
        ...encabezadoYPie({
          ancho: ANCHO_UTIL,
          titulo: ["EVALUACIÓN DE CRITICIDAD Y RIESGO", producto || ""],
          codigo: opciones.codigo,
          empresa: opciones.empresa,
          planta: opciones.planta,
          logo: opciones.logo || logoPorDefecto(),
        }),
        children: hijos,
      },
    ],
  });

  return { doc };
}

/**
 * El nombre del producto, apto para un nombre de archivo.
 *
 * Las tildes se quitan ANTES de sanear: si no, la «Á» de «CÁPSULA» se
 * cambiaba por un guion bajo y el archivo se llamaba «C_PSULA». Con el
 * producto leído del protocolo —que va con tildes, no abreviado como en el
 * registro— pasaba siempre.
 */
export function nombreDeArchivo(texto, respaldo) {
  const limpio = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return limpio || respaldo;
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportarCriticidadWord(datos) {
  const { doc } = construirCriticidad(datos);
  const blob = await Packer.toBlob(doc);
  const sufijo = (datos.pasos || TODOS_LOS_PASOS).length === TODOS_LOS_PASOS.length ? "" : "_PARCIAL";
  descargar(blob, `${nombreDeArchivo(datos.producto, "EVALUACION")}_CRITICIDAD${sufijo}.docx`);
  return true;
}

// --- Excel ------------------------------------------------------------------

/**
 * Cuatro hojas, una por cosa que se filtra distinto: los atributos con su
 * severidad, la clasificación parámetro a parámetro, el FMEA de los Críticos
 * y el requisito de muestreo.
 */
export function construirLibroCriticidad({ producto = "", lote = "", atributos = [], severidades = [], filas = [], fmea = [], estadistico = [] }) {
  const wb = new ExcelJS.Workbook();
  const AZUL = "FFC6D9F1";

  const hoja = (nombre, cabeceras, anchos, datos, pintar) => {
    const ws = wb.addWorksheet(nombre);
    ws.addRow([`${nombre} — ${producto || "producto sin identificar"}${lote ? ` · lote ${lote}` : ""}`]);
    ws.getRow(1).font = { bold: true, size: 12 };
    ws.addRow([]);
    const cab = ws.addRow(cabeceras);
    cab.font = { bold: true };
    cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    anchos.forEach((a, i) => { ws.getColumn(i + 1).width = a; });
    for (const d of datos) {
      const r = ws.addRow(d);
      r.alignment = { vertical: "top", wrapText: true };
      pintar?.(r, d);
    }
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cabeceras.length } };
    ws.views = [{ state: "frozen", ySplit: 3 }];
    return ws;
  };

  const amarillo = (celda) => {
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  };

  hoja("Paso 1 - Severidad", ["Atributo", "Severidad", "Decisión", "Justificación", "Origen"],
    [34, 11, 26, 70, 18],
    severidades.map((s) => [s.atributo, s.severidad, s.decision || "", s.justificacion || "", s.origen === "revisada" ? "Revisada" : "Propuesta por IA"]),
    (r, d) => { if (d[1] >= 4) amarillo(r.getCell(2)); });

  hoja("Pasos 2-3 - Clasificacion",
    ["Etapa", "Operación", "Parámetro", "Set-point / criterio", "Atributo vinculado", "Severidad", "Origen de la sospecha", "Estado", "Vía de resolución", "¿Afecta al desempeño?", "Clasificación anterior", "Clasificación", "Fuente"],
    [16, 26, 28, 24, 26, 11, 60, 22, 34, 40, 16, 16, 34],
    filas.map((f) => [
      f.etapa, f.seccion, f.magnitud, f.criterios?.join(" ; ") || "", f.afecta?.join(" / ") || "",
      f.severidad ?? "", f.racional || "", estadoDe(f), f.via, respuestaDeDesempeno(f),
      f.clasificacionAnterior || "", f.clasificacion || "Pendiente", fuenteDe(f),
    ]),
    (r, d) => { if (d[11] === CRITICO) amarillo(r.getCell(12)); });

  const ARGB_NPR = { VERDE: "FFC6EFCE", AMARILLO: "FFFFEB9C", ROJO: "FFFFC7CE" };
  hoja("Paso 4 - FMEA", ["Etapa", "Parámetro", "Atributo vinculado", "S", "P", "D", "NPR", "Nivel de riesgo", "Racional / evidencia"],
    [16, 28, 26, 6, 6, 6, 8, 22, 70],
    fmea.map((f) => {
      const nivel = nivelDeNpr(f.npr);
      return [
        f.etapa, f.magnitud, f.afecta?.join(" / ") || "", f.severidad ?? "", f.probabilidad ?? "",
        f.detectabilidad ?? "", f.npr ?? "", nivel ? `${nivel.color} — ${nivel.nivel}` : "", f.racionalFmea || "",
      ];
    }),
    (r, d) => {
      const color = String(d[7]).split(" — ")[0];
      if (ARGB_NPR[color]) r.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB_NPR[color] } };
    });

  hoja("Paso 5 - Muestreo", ["Calificación de Severidad", "Confianza", "Cobertura", "Continuos (intervalo de tolerancia)", "De atributo (cero defectos)", "n aprox. (atributo)"],
    [26, 12, 12, 50, 50, 14],
    estadistico.map((e) => [e.etiqueta, `${Math.round(e.confianza * 100)} %`, `${Math.round(e.cobertura * 100)} %`,
      (e.continuos || []).join(", "), (e.deAtributo || []).join(", "), (e.deAtributo || []).length ? e.n : ""]));

  hoja("Paso 0 - Atributos", ["Atributo", "Ensayo", "Criterio de aceptación", "NT", "Tipo de dato", "Origen", "Etapa"],
    [34, 34, 40, 6, 12, 20, 22],
    atributos.map((a) => [a.nombre, a.ensayo || "", a.criterios?.join(" ; ") || "", a.norma || "", a.tipoDeDato || "",
      a.origen === "especificación" ? "Especificación" : a.origen === "análisis de riesgo" ? "Análisis de riesgo" : a.origen === "protocolo" ? "Protocolo" : "Registro",
      (a.etapas || [a.etapa]).filter(Boolean).join(", ")]));

  return wb;
}

export async function exportarCriticidadExcel(datos) {
  const wb = construirLibroCriticidad(datos);
  const buffer = await wb.xlsx.writeBuffer();
  descargar(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${nombreDeArchivo(datos.producto, "EVALUACION")}_CRITICIDAD.xlsx`
  );
  return true;
}
