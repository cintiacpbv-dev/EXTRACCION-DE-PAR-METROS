// El documento con la clasificación de parámetros: en Word para el
// expediente y en Excel para seguir trabajando la matriz.
//
// Una fila por parámetro de proceso, con los atributos de calidad a los que
// afecta, el impacto sobre cada uno, el veredicto de criticidad y —la columna
// que hace que esto sirva— DE DÓNDE sale cada relación: del criterio impreso
// en el registro, de la bibliografía con su cita, o de la IA.
//
// Esa última columna no es un adorno. Un cuadro de clasificación que no
// distingue lo que está escrito en el registro de lo que redactó un modelo no
// se puede firmar: quien revisa tiene que saber cuáles mirar con más cuidado.

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
  VerticalMergeType,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import { encabezadoYPie } from "./exportEncabezado.js";
import { logoPorDefecto } from "./logoEmpresa.js";

const FUENTE = "Arial";
const TAM = 14;
const AZUL_CABECERA = "C6D9F1";
const AMARILLO_CRITICO = "FFFF00";

// Hoja A4 apaisada: son siete columnas y las justificaciones son frases, no
// cifras. En vertical el cuadro sale ilegible.
const A4_ANCHO = 11907;
const A4_ALTO = 16840;
const MARGEN = { top: 993, right: 993, bottom: 993, left: 993 };
const ANCHO_UTIL = A4_ALTO - MARGEN.left - MARGEN.right; // apaisada: el largo es el ancho

const COLS = [1300, 2000, 1900, 900, 4400, 2100, 2254];
const CABECERAS = [
  "Etapa",
  "Operación",
  "Parámetro de proceso",
  "Criterio",
  "Atributo(s) de calidad que afecta",
  "Clasificación",
  "Fuente",
];

function pagina() {
  return {
    page: {
      // La librería intercambia las medidas cuando la orientación es
      // apaisada, así que aquí van las de la hoja vertical.
      size: { width: A4_ANCHO, height: A4_ALTO, orientation: PageOrientation.LANDSCAPE },
      margin: MARGEN,
    },
  };
}

function parrafo(texto, { bold, align, size = TAM } = {}) {
  return new Paragraph({
    alignment: align,
    spacing: { before: 20, after: 20 },
    children: [new TextRun({ text: String(texto ?? ""), font: FUENTE, size, bold })],
  });
}

function celda(lineas, { bold, align, fill, width, colSpan, merge } = {}) {
  const contenido = Array.isArray(lineas) ? lineas : [lineas];
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    verticalMerge: merge,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: contenido.map((l) =>
      typeof l === "string" || typeof l === "number" ? parrafo(l, { bold, align }) : l
    ),
  });
}

/** Los atributos que toca un parámetro, uno por línea con su impacto. */
export function atributosComoLineas(fila) {
  if (!fila.afecta?.length) return ["—"];
  return fila.afecta.map((a) => {
    const impacto = a.impacto ? ` · impacto ${a.impacto}` : "";
    // Un atributo que la IA nombra y que el registro no mide se marca: puede
    // ser un hallazgo válido, pero no sale de lo que este proceso controla.
    const marca = a.enElRegistro ? "" : " (no medido en el registro)";
    return `${a.atributo}${impacto}${marca}${a.justificacion ? `: ${a.justificacion}` : ""}`;
  });
}

/** El veredicto, en las palabras del expediente. */
export function veredicto(fila) {
  if (fila.critico === true) return "Parámetro Crítico de Proceso (PCP)";
  if (fila.critico === false) return "No crítico";
  return "Sin clasificar";
}

/**
 * De dónde sale la relación, dicho para quien revisa.
 *
 * La distinción que importa: la bibliografía responde en prosa y cita dónde
 * lo dice; quien convierte eso en un atributo con su nivel de impacto es la
 * IA. Una fila con cita es una propuesta RESPALDADA, no una fila
 * bibliográfica — y un cuadro que las confunda hace pasar por documentado un
 * nivel de impacto que nadie documentó.
 */
export function fuenteLegible(fila) {
  if (fila.fuente === "IA+bibliografía") {
    return `Propuesta por IA, respaldada por${fila.referencias ? `: ${fila.referencias}` : " la bibliografía"}`;
  }
  if (fila.fuente === "bibliografía") {
    return `Bibliografía${fila.referencias ? ` — ${fila.referencias}` : ""} (sin clasificar)`;
  }
  if (fila.fuente === "IA") return "Propuesta por IA — revisar";
  if (fila.fuente === "registro") return "Criterio impreso en el registro";
  return "Sin fuente";
}

/** El impacto más fuerte que tiene esta fila, para poder ordenar y contar. */
export function impactoMaximo(fila) {
  const orden = { alto: 3, medio: 2, bajo: 1 };
  return (fila.afecta || []).reduce((max, a) => Math.max(max, orden[a.impacto] || 0), 0);
}

function cuadro(filas) {
  const cabecera = new TableRow({
    tableHeader: true,
    children: CABECERAS.map((t, i) =>
      celda(t, { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[i] })
    ),
  });

  const cuerpo = [];
  let etapaPrevia = null;

  for (const fila of filas) {
    // La etapa se combina en vertical sobre sus parámetros: el cuadro se lee
    // por etapas y repetir "FABRICACION" cuarenta veces sólo la hace ruido.
    const nuevaEtapa = fila.etapa !== etapaPrevia;
    etapaPrevia = fila.etapa;

    cuerpo.push(
      new TableRow({
        children: [
          celda(nuevaEtapa ? fila.etapa : "", {
            width: COLS[0],
            merge: nuevaEtapa ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE,
          }),
          celda(fila.seccion, { width: COLS[1] }),
          celda(fila.magnitud, { width: COLS[2] }),
          celda(fila.criterios?.join(" ; ") || "—", { width: COLS[3] }),
          celda(atributosComoLineas(fila), { width: COLS[4] }),
          celda(veredicto(fila), {
            width: COLS[5],
            align: AlignmentType.CENTER,
            // Amarillo sólo en los críticos: es el color que esta aplicación
            // usa siempre para "mira aquí", igual que en el Formato 01 y el 8.
            fill: fila.critico === true ? AMARILLO_CRITICO : undefined,
          }),
          celda(fuenteLegible(fila), { width: COLS[6] }),
        ],
      })
    );
  }

  if (filas.length === 0) {
    cuerpo.push(
      new TableRow({
        children: [
          celda("No se clasificó ningún parámetro.", {
            colSpan: CABECERAS.length,
            align: AlignmentType.CENTER,
            width: ANCHO_UTIL,
          }),
        ],
      })
    );
  }

  return new Table({
    width: { size: COLS.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: COLS,
    rows: [cabecera, ...cuerpo],
  });
}

/** El recuento, que es lo primero que mira quien abre el cuadro. */
export function resumenDe(filas) {
  return {
    total: filas.length,
    criticos: filas.filter((f) => f.critico === true).length,
    sinClasificar: filas.filter((f) => f.critico === null || f.critico === undefined).length,
    // Respaldadas: las que llevan cita, hayan sido clasificadas por la IA o no.
    respaldadas: filas.filter((f) => f.fuente === "IA+bibliografía" || f.fuente === "bibliografía").length,
    // Y las que son sólo propuesta, que son las que hay que revisar de veras.
    soloIA: filas.filter((f) => f.fuente === "IA").length,
    delRegistro: filas.filter((f) => f.fuente === "registro").length,
  };
}

function lineaDeResumen(r) {
  return (
    `${r.total} ${r.total === 1 ? "parámetro clasificado" : "parámetros clasificados"}: ` +
    `${r.criticos} crítico(s)` +
    (r.sinClasificar ? `, ${r.sinClasificar} sin clasificar` : "") +
    `. Procedencia: ${r.respaldadas} con respaldo bibliográfico citado, ${r.soloIA} sólo propuestos por la IA, ` +
    `${r.delRegistro} apoyados únicamente en el criterio impreso en el registro.`
  );
}

function bloqueFirma() {
  const anchos = [3000, 5000, 1500, 5454];
  return new Table({
    width: { size: anchos.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: anchos,
    rows: [
      new TableRow({
        children: [
          celda("Revisado por:", { width: anchos[0] }),
          celda("", { width: anchos[1] }),
          celda("Fecha:", { width: anchos[2] }),
          celda("", { width: anchos[3] }),
        ],
      }),
    ],
  });
}

export function construirClasificacion({ filas = [], atributos = [], producto = "", lote = "", opciones = {} }) {
  const resumen = resumenDe(filas);

  const hijos = [
    new Paragraph({
      spacing: { after: 160 },
      children: [
        new TextRun({
          text: "CLASIFICACIÓN DE PARÁMETROS DE PROCESO Y ATRIBUTOS DE CALIDAD",
          font: FUENTE,
          size: 22,
          bold: true,
        }),
      ],
    }),
    parrafo(`Producto: ${producto || "_____________________"}`),
    parrafo(`Lote: ${lote || "_____________________"}`),
    parrafo(
      `Atributos de calidad considerados: ${
        atributos.map((a) => a.nombre).join(", ") || "ninguno reconocido"
      }`
    ),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
    cuadro(filas),
    new Paragraph({ spacing: { before: 200, after: 120 }, children: [] }),
    parrafo(lineaDeResumen(resumen), { size: 12 }),
    parrafo(
      "Toda fila que diga «Propuesta por IA» es un borrador que hay que revisar y sustentar antes de firmar, " +
        "lleve respaldo bibliográfico o no: la referencia respalda el mecanismo descrito, no el nivel de impacto " +
        "ni el veredicto de criticidad, que los propone el modelo.",
      { size: 12 }
    ),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
    parrafo("Cumple criterios de aceptación: (SI/NO): ______, en caso de NO refiera N° de desviación: ______"),
    new Paragraph({ spacing: { after: 200 }, children: [] }),
    bloqueFirma(),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: FUENTE, size: TAM } } } },
    sections: [
      {
        properties: pagina(),
        ...encabezadoYPie({
          ancho: ANCHO_UTIL,
          titulo: ["CLASIFICACIÓN DE PARÁMETROS Y ATRIBUTOS DE CALIDAD", producto || ""],
          codigo: opciones.codigo,
          empresa: opciones.empresa,
          planta: opciones.planta,
          logo: opciones.logo || logoPorDefecto(),
        }),
        children: hijos,
      },
    ],
  });

  return { doc, resumen };
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

export async function exportarClasificacionWord(datos) {
  const { doc, resumen } = construirClasificacion(datos);
  const blob = await Packer.toBlob(doc);
  const nombre = String(datos.producto || "").replace(/[^\w.-]+/g, "_").slice(0, 60);
  descargar(blob, nombre ? `${nombre}_CLASIFICACION_PARAMETROS.docx` : "CLASIFICACION_PARAMETROS.docx");
  return resumen;
}

// --- Excel ------------------------------------------------------------------

const COLUMNAS_EXCEL = [
  { header: "Etapa", key: "etapa", width: 16 },
  { header: "Operación", key: "seccion", width: 28 },
  { header: "Parámetro de proceso", key: "magnitud", width: 30 },
  { header: "Etiqueta en el registro", key: "ejemplo", width: 32 },
  { header: "Criterio del registro", key: "criterio", width: 24 },
  { header: "Veces anotado", key: "veces", width: 13 },
  { header: "Atributo de calidad", key: "atributo", width: 26 },
  { header: "Impacto", key: "impacto", width: 10 },
  { header: "Mecanismo", key: "mecanismo", width: 60 },
  { header: "Clasificación", key: "clasificacion", width: 26 },
  { header: "Justificación", key: "justificacion", width: 60 },
  { header: "Fuente", key: "fuente", width: 34 },
];

/**
 * En Excel se abre una fila POR ATRIBUTO, no por parámetro.
 *
 * En Word interesa el cuadro compacto para leerlo; en Excel interesa poder
 * filtrar y ordenar por atributo o por impacto, y para eso cada relación
 * tiene que ser su propia fila. Un parámetro que no afecta a ninguno sale
 * igual, con el atributo vacío: si desapareciera, el recuento de la hoja no
 * cuadraría con el del Word.
 */
export function filasDeExcel(filas) {
  const salida = [];
  for (const fila of filas) {
    const comunes = {
      etapa: fila.etapa,
      seccion: fila.seccion,
      magnitud: fila.magnitud,
      ejemplo: fila.ejemplo,
      criterio: fila.criterios?.join(" ; ") || "",
      veces: fila.veces,
      clasificacion: veredicto(fila),
      justificacion: fila.justificacion,
      fuente: fuenteLegible(fila),
    };
    if (!fila.afecta?.length) {
      salida.push({ ...comunes, atributo: "", impacto: "", mecanismo: "" });
      continue;
    }
    for (const a of fila.afecta) {
      salida.push({
        ...comunes,
        atributo: a.atributo + (a.enElRegistro ? "" : " (no medido en el registro)"),
        impacto: a.impacto,
        mecanismo: a.justificacion,
      });
    }
  }
  return salida;
}

export function construirLibroClasificacion({ filas = [], producto = "", lote = "" }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clasificación");

  ws.addRow([`Clasificación de parámetros de proceso — ${producto || "producto sin identificar"}`]);
  ws.addRow([lote ? `Lote: ${lote}` : ""]);
  ws.addRow([]);
  ws.getRow(1).font = { bold: true, size: 12 };

  const cabecera = ws.addRow(COLUMNAS_EXCEL.map((c) => c.header));
  cabecera.font = { bold: true };
  cabecera.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6D9F1" } };
  COLUMNAS_EXCEL.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  for (const fila of filasDeExcel(filas)) {
    const r = ws.addRow(COLUMNAS_EXCEL.map((c) => fila[c.key] ?? ""));
    r.alignment = { vertical: "top", wrapText: true };
    if (fila.clasificacion.startsWith("Parámetro Crítico")) {
      r.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    }
  }

  // El filtro puesto: la hoja está para filtrar por atributo y por impacto.
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: COLUMNAS_EXCEL.length } };
  ws.views = [{ state: "frozen", ySplit: 4 }];

  return wb;
}

export async function exportarClasificacionExcel(datos) {
  const wb = construirLibroClasificacion(datos);
  const buffer = await wb.xlsx.writeBuffer();
  const nombre = String(datos.producto || "clasificacion").replace(/[^\w.-]+/g, "_").slice(0, 60);
  descargar(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${nombre}_CLASIFICACION_PARAMETROS.xlsx`
  );
  return true;
}
