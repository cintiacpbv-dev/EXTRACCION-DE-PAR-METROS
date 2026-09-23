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
  EQUIPO_MULTIDISCIPLINARIO,
  EXPLICACION_ESTADISTICA,
  MOTIVOS_DE_REVISION,
  NOTA_DE_PROCEDENCIA,
  OBJETIVOS,
  PLAN_DE_REEVALUACION,
  REGLAS,
} from "./criticidad/textos.js";

const FUENTE = "Arial";
const TAM = 14;
const TAM_TITULO = 22;
const TAM_PASO = 18;
const AZUL_CABECERA = "C6D9F1";
const AMARILLO_CRITICO = "FFFF00";
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

/** Lo que se escribe en la columna «Estado» del Paso 2. */
export function estadoDe(fila) {
  return fila.sospecha ? "CPP candidato" : "Sin sospecha de impacto en atributo";
}

/** Y de dónde salió esa sospecha, que es lo que hay que poder revisar. */
export function fuenteDe(fila) {
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
  return [
    titulo("Paso 0 — Identificación de Atributos de Calidad"),
    parrafo(OBJETIVOS[0], { size: 13, italic: true }),
    cuadro(
      ["Atributo de Calidad", "Criterio de aceptación", "Dónde se identificó"],
      atributos.map((a) => [a.nombre, a.criterios?.join(" ; ") || "—", `${a.origen === "protocolo" ? "Protocolo" : "Registro de manufactura"} · ${a.etapa || "—"}`]),
      [3, 4, 3],
      { vacio: "No se reconoció ningún atributo de calidad." }
    ),
  ];
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

function bloquePaso3(filas) {
  const salida = [
    titulo("Paso 3 — Clasificación"),
    parrafo(OBJETIVOS[3], { size: 13, italic: true }),
    regla(REGLAS.clasificacion),
    regla(REGLAS.severidadCalculada),
  ];

  for (const [etapa, suyas] of porEtapa(filas)) {
    salida.push(parrafo(`Etapa: ${etapa}`, { bold: true, espacio: true }));
    salida.push(
      cuadro(
        ["Parámetro", "Atributo vinculado", "Severidad", "Vía de resolución", "¿Afecta al desempeño?", "Clasificación"],
        suyas.map((f) => [
          f.magnitud,
          f.afecta?.join(" / ") || "—",
          { texto: f.severidad === null || f.severidad === undefined ? "N/A" : String(f.severidad), align: AlignmentType.CENTER },
          f.via,
          respuestaDeDesempeno(f),
          {
            texto: f.clasificacion || "Pendiente",
            align: AlignmentType.CENTER,
            fill: f.clasificacion === CRITICO ? AMARILLO_CRITICO : undefined,
          },
        ]),
        [2.6, 2.6, 1.1, 3, 2.7, 2]
      )
    );
  }
  salida.push(regla(REGLAS.noClave));
  return salida;
}

function bloquePaso4(fmea) {
  const salida = [
    titulo("Paso 4 — FMEA (exclusivo para parámetros Críticos)"),
    parrafo(OBJETIVOS[4], { size: 13, italic: true }),
    parrafo("Probabilidad (P) — qué tan probable es que el parámetro se salga de su rango", { bold: true, espacio: true }),
    cuadro(
      ["Valor", "Nivel", "Descripción"],
      ESCALA_PROBABILIDAD.map((e) => [{ texto: String(e.valor), align: AlignmentType.CENTER }, e.nivel, e.descripcion]),
      [1, 2, 9]
    ),
    parrafo("Detectabilidad (D) — qué tan difícil es darse cuenta a tiempo", { bold: true, espacio: true }),
    cuadro(
      ["Valor", "Nivel", "Descripción"],
      ESCALA_DETECTABILIDAD.map((e) => [{ texto: String(e.valor), align: AlignmentType.CENTER }, e.nivel, e.descripcion]),
      [1, 2, 9]
    ),
    parrafo(`Parámetros Críticos evaluados (${fmea.length})`, { bold: true, espacio: true }),
    cuadro(
      ["Parámetro", "Atributo vinculado", "S", "P", "D", "NPR", "Racional / evidencia"],
      fmea.map((f) => [
        f.magnitud,
        f.afecta?.join(" / ") || "—",
        { texto: String(f.severidad ?? "—"), align: AlignmentType.CENTER },
        { texto: String(f.probabilidad ?? "—"), align: AlignmentType.CENTER },
        { texto: String(f.detectabilidad ?? "—"), align: AlignmentType.CENTER },
        { texto: String(f.npr ?? "—"), align: AlignmentType.CENTER },
        f.racionalFmea || "—",
      ]),
      [3, 2.6, 0.7, 0.7, 0.7, 0.9, 5],
      { vacio: "No hay parámetros Críticos que evaluar." }
    ),
    parrafo("Interpretación del NPR (herramienta secundaria — no determina la clasificación)", { bold: true, espacio: true }),
    cuadro(
      ["Rango NPR", "Nivel", "Uso sugerido"],
      TRAMOS_NPR.map((t, i) => [
        { texto: `${i === 0 ? 1 : TRAMOS_NPR[i - 1].hasta + 1} – ${t.hasta}`, align: AlignmentType.CENTER },
        t.nivel,
        t.uso,
      ]),
      [1.5, 1.5, 9]
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
      ["Calificación de Severidad", "Confianza (TR60, fija)", "Cobertura", "n aprox. (atributo, cero defectos)", "Atributos en este nivel"],
      estadistico.map((e) => [
        e.etiqueta,
        { texto: `${Math.round(e.confianza * 100)} %`, align: AlignmentType.CENTER },
        { texto: `${Math.round(e.cobertura * 100)} %`, align: AlignmentType.CENTER },
        { texto: `≈ ${e.n}`, align: AlignmentType.CENTER },
        e.atributos.join(", "),
      ]),
      [2.2, 2, 1.5, 2.3, 4],
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
  if (incluye(3)) hijos.push(...bloquePaso3(filas));
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
  const nombre = String(datos.producto || "").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const sufijo = (datos.pasos || TODOS_LOS_PASOS).length === TODOS_LOS_PASOS.length ? "" : "_PARCIAL";
  descargar(blob, `${nombre || "EVALUACION"}_CRITICIDAD${sufijo}.docx`);
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
    ["Etapa", "Operación", "Parámetro", "Criterio del registro", "Atributo vinculado", "Severidad", "Origen de la sospecha", "Estado", "Vía de resolución", "¿Afecta al desempeño?", "Clasificación", "Fuente"],
    [16, 26, 28, 24, 26, 11, 60, 26, 34, 40, 16, 32],
    filas.map((f) => [
      f.etapa, f.seccion, f.magnitud, f.criterios?.join(" ; ") || "", f.afecta?.join(" / ") || "",
      f.severidad ?? "", f.racional || "", estadoDe(f), f.via, respuestaDeDesempeno(f),
      f.clasificacion || "Pendiente", fuenteDe(f),
    ]),
    (r, d) => { if (d[10] === CRITICO) amarillo(r.getCell(11)); });

  hoja("Paso 4 - FMEA", ["Etapa", "Parámetro", "Atributo vinculado", "S", "P", "D", "NPR", "Nivel", "Racional / evidencia"],
    [16, 28, 26, 6, 6, 6, 8, 12, 70],
    fmea.map((f) => [
      f.etapa, f.magnitud, f.afecta?.join(" / ") || "", f.severidad ?? "", f.probabilidad ?? "",
      f.detectabilidad ?? "", f.npr ?? "", nivelDeNpr(f.npr)?.nivel || "", f.racionalFmea || "",
    ]));

  hoja("Paso 5 - Muestreo", ["Calificación de Severidad", "Confianza", "Cobertura", "n aprox.", "Atributos"],
    [26, 12, 12, 11, 70],
    estadistico.map((e) => [e.etiqueta, `${Math.round(e.confianza * 100)} %`, `${Math.round(e.cobertura * 100)} %`, e.n, e.atributos.join(", ")]));

  hoja("Paso 0 - Atributos", ["Atributo", "Criterio de aceptación", "Origen", "Etapa"],
    [34, 40, 22, 20],
    atributos.map((a) => [a.nombre, a.criterios?.join(" ; ") || "", a.origen === "protocolo" ? "Protocolo" : "Registro", a.etapa || ""]));

  return wb;
}

export async function exportarCriticidadExcel(datos) {
  const wb = construirLibroCriticidad(datos);
  const buffer = await wb.xlsx.writeBuffer();
  const nombre = String(datos.producto || "evaluacion").replace(/[^\w.-]+/g, "_").slice(0, 60);
  descargar(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${nombre}_CRITICIDAD.xlsx`
  );
  return true;
}
