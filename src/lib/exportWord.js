// Genera el informe de validación (RVP) en Word, con la misma estructura y
// formato de tablas del reporte de referencia: encabezado sombreado, bordes
// finos, Arial pequeño y una fila de sección por producto o etapa.

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { buildRvpModel } from "./rvpData.js";

const FUENTE = "Arial";
const GRIS_CABECERA = "D9D9D9";
const GRIS_SECCION = "E7E6E6";
const VERDE_STATS = "CCFFCC";

// A4 en DXA (1440 = 1"), con márgenes de ~0.7".
const A4_ANCHO = 11907;
const A4_ALTO = 16840;
const MARGEN = 1000;

// Igual que el reporte de referencia, el informe alterna orientaciones: los
// datos generales caben en vertical, pero la tabla de parámetros crece una
// columna por lote y necesita el ancho de una página horizontal.
const ANCHO_VERTICAL = A4_ANCHO - MARGEN * 2;
const ANCHO_HORIZONTAL = A4_ALTO - MARGEN * 2;

// Máximo de lotes por tabla de parámetros: por encima, las columnas quedan
// demasiado angostas para leerse.
const LOTES_POR_TABLA = 10;

const BORDES_FINOS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
};

function texto(contenido, { bold = false, size = 16, align } = {}) {
  return new Paragraph({
    alignment: align,
    children: [new TextRun({ text: String(contenido ?? ""), bold, font: FUENTE, size })],
  });
}

function celda(contenido, { bold, fill, width, align, colSpan, rowSpan } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    rowSpan,
    shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
    children: [texto(contenido, { bold, align })],
  });
}

/** Reparte el ancho disponible entre columnas fijas y columnas de lote. */
function anchos(fijas, nLotes, ancho) {
  const usado = fijas.reduce((a, b) => a + b, 0);
  const restante = Math.max(ancho - usado, nLotes * 400);
  const porLote = Math.floor(restante / Math.max(nLotes, 1));
  return [...fijas, ...Array(nLotes).fill(porLote)];
}

function tabla(columnWidths, filas) {
  return new Table({
    width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths,
    // Sin ancho fijo, Word ensancha las columnas según el contenido y una
    // tabla con muchos lotes termina saliéndose de la página.
    layout: TableLayoutType.FIXED,
    borders: BORDES_FINOS,
    rows: filas,
  });
}

/** Fila que abarca todo el ancho, usada como título de sección dentro de la tabla. */
function filaSeccion(titulo, nCols, widths) {
  return new TableRow({
    children: [
      celda(titulo, { bold: true, fill: GRIS_SECCION, colSpan: nCols, width: widths.reduce((a, b) => a + b, 0) }),
    ],
  });
}

// ---------------------------------------------------------------- tablas ---

function tablaLotes(model) {
  const { stages, filas } = model.lotes;
  const widths = anchos([600, 3600, 1400], stages.length * 2, ANCHO_HORIZONTAL);
  const nCols = 3 + stages.length * 2;

  // Las tres primeras columnas ocupan las dos filas de cabecera; cada etapa
  // abre dos columnas (inicio y término) bajo un título común.
  const cabecera1 = [
    celda("N°", { bold: true, fill: GRIS_CABECERA, width: widths[0], align: AlignmentType.CENTER, rowSpan: 2 }),
    celda("PRODUCTO", { bold: true, fill: GRIS_CABECERA, width: widths[1], align: AlignmentType.CENTER, rowSpan: 2 }),
    celda("LOTE", { bold: true, fill: GRIS_CABECERA, width: widths[2], align: AlignmentType.CENTER, rowSpan: 2 }),
  ];
  stages.forEach((stage, i) => {
    const w = widths[3 + i * 2] + widths[4 + i * 2];
    cabecera1.push(celda(stage, { bold: true, fill: GRIS_CABECERA, colSpan: 2, width: w, align: AlignmentType.CENTER }));
  });

  const cabecera2 = [];
  stages.forEach((_, i) => {
    cabecera2.push(celda("FECHA DE INICIO", { bold: true, fill: GRIS_CABECERA, width: widths[3 + i * 2], align: AlignmentType.CENTER }));
    cabecera2.push(celda("FECHA DE TERMINO", { bold: true, fill: GRIS_CABECERA, width: widths[4 + i * 2], align: AlignmentType.CENTER }));
  });

  const cuerpo = filas.map((fila, idx) => {
    const cells = [
      celda(idx + 1, { width: widths[0], align: AlignmentType.CENTER }),
      celda(fila.producto, { width: widths[1] }),
      celda(fila.lote, { width: widths[2], align: AlignmentType.CENTER }),
    ];
    stages.forEach((stage, i) => {
      const f = fila.etapas[stage] || {};
      cells.push(celda(f.inicio || "—", { width: widths[3 + i * 2], align: AlignmentType.CENTER }));
      cells.push(celda(f.fin || "—", { width: widths[4 + i * 2], align: AlignmentType.CENTER }));
    });
    return new TableRow({ children: cells });
  });

  return tabla(widths, [
    new TableRow({ children: cabecera1, tableHeader: true }),
    new TableRow({ children: cabecera2, tableHeader: true }),
    ...(cuerpo.length ? cuerpo : [new TableRow({ children: [celda("Sin datos", { colSpan: nCols, width: ANCHO_HORIZONTAL })] })]),
  ]);
}

function tablaMateriales(model) {
  const widths = anchos([3100, 1400, 1400, 1700, 1200, 1100], 0, ANCHO_VERTICAL);
  const cabecera = ["Nombre", "Código", "Lote", "Cantidad registrada", "Proveedor", "Fecha de vencimiento"];

  const filas = model.materiales.map((m) =>
    new TableRow({
      children: [
        celda(m.nombre, { width: widths[0] }),
        celda(m.codigo, { width: widths[1], align: AlignmentType.CENTER }),
        celda(m.lote, { width: widths[2], align: AlignmentType.CENTER }),
        celda(m.cantidad, { width: widths[3], align: AlignmentType.CENTER }),
        celda("", { width: widths[4] }),
        celda("", { width: widths[5] }),
      ],
    })
  );

  return tabla(widths, [
    new TableRow({
      tableHeader: true,
      children: cabecera.map((h, i) =>
        celda(h, { bold: true, fill: GRIS_CABECERA, width: widths[i], align: AlignmentType.CENTER })
      ),
    }),
    ...(filas.length ? filas : [new TableRow({ children: [celda("Sin insumos detectados", { colSpan: 6, width: ANCHO_VERTICAL })] })]),
  ]);
}

function tablaPersonal(entrada) {
  const widths = [2400, ANCHO_VERTICAL - 2400];

  const filas = [
    new TableRow({
      tableHeader: true,
      children: [
        celda(`LOTES – ${entrada.stage}`, {
          bold: true,
          fill: GRIS_CABECERA,
          colSpan: 2,
          width: ANCHO_VERTICAL,
          align: AlignmentType.CENTER,
        }),
      ],
    }),
    new TableRow({
      children: [
        celda("Lotes", { bold: true, width: widths[0] }),
        celda(entrada.lotes.join(" · "), { width: widths[1] }),
      ],
    }),
    filaSeccion("FUNCIÓN: OPERADOR", 2, widths),
    new TableRow({
      children: [
        celda("Realizado por", { bold: true, width: widths[0] }),
        celda(entrada.operarios.map((p) => p.name).join(" / ") || "—", { width: widths[1] }),
      ],
    }),
    filaSeccion("FUNCIÓN: SUPERVISOR", 2, widths),
    new TableRow({
      children: [
        celda("V°B°", { bold: true, width: widths[0] }),
        celda(entrada.supervisores.map((p) => p.name).join(" / ") || "—", { width: widths[1] }),
      ],
    }),
  ];

  return tabla(widths, filas);
}

function tablaParametros(table, lotes) {
  const nLotes = lotes.length;
  const widths = anchos([3600, 1900], nLotes, ANCHO_HORIZONTAL);
  const nCols = 2 + nLotes;

  const cabecera = [
    celda("Parámetros de proceso", { bold: true, fill: GRIS_CABECERA, width: widths[0], align: AlignmentType.CENTER }),
    celda("Rango de operación", { bold: true, fill: GRIS_CABECERA, width: widths[1], align: AlignmentType.CENTER }),
    ...lotes.map((lote, i) =>
      celda(lote, { bold: true, fill: VERDE_STATS, width: widths[2 + i], align: AlignmentType.CENTER })
    ),
  ];

  const filas = [new TableRow({ children: cabecera, tableHeader: true })];

  for (const section of table.sections) {
    filas.push(filaSeccion(section.title, nCols, widths));

    for (const row of section.rows) {
      const etiqueta = row.unit && !row.label.includes(row.unit) ? `${row.label} (${row.unit})` : row.label;
      filas.push(
        new TableRow({
          children: [
            celda(etiqueta, { width: widths[0] }),
            celda(row.setpoint || "Referencial", { width: widths[1], align: AlignmentType.CENTER }),
            ...lotes.map((lote, i) => {
              const v = row.values[lote];
              const txt = v === undefined || v === null || v === "" ? "—" : v === "ü" ? "Conforme" : String(v);
              return celda(txt, { width: widths[2 + i], align: AlignmentType.CENTER });
            }),
          ],
        })
      );
    }
  }

  return tabla(widths, filas);
}

// --------------------------------------------------------------- informe ---

function encabezado(nivel, txt) {
  return new Paragraph({
    heading: nivel,
    children: [new TextRun({ text: txt, bold: true, font: FUENTE, size: nivel === HeadingLevel.HEADING_1 ? 24 : 20 })],
  });
}

const MARGENES = { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN };

function pagina(horizontal) {
  return {
    page: {
      margin: MARGENES,
      // docx-js intercambia ancho y alto al aplicar la orientación, así que
      // siempre se pasan las medidas en vertical.
      size: horizontal
        ? { width: A4_ANCHO, height: A4_ALTO, orientation: PageOrientation.LANDSCAPE }
        : { width: A4_ANCHO, height: A4_ALTO },
    },
  };
}

export function buildRvpDocument(documents, familia, options) {
  const model = buildRvpModel(documents, familia, options);
  const hoy = new Date().toISOString().slice(0, 10);

  // Sección vertical: portada, materiales y personal.
  const vertical = [
    texto(`REPORTE DE VALIDACIÓN DE PROCESO — ${familia}`, { bold: true, size: 28, align: AlignmentType.CENTER }),
    texto(`Generado el ${hoy} a partir de los registros de manufactura`, { size: 16, align: AlignmentType.CENTER }),
    texto(""),
    encabezado(HeadingLevel.HEADING_1, "1. RECOLECCIÓN DE DATOS DEL PROCESO"),
    encabezado(HeadingLevel.HEADING_2, "1.2 MATERIALES UTILIZADOS EN LOS LOTES"),
    texto(
      "Las columnas de proveedor y fecha de vencimiento no figuran en el registro de manufactura; deben completarse desde el sistema de almacén.",
      { size: 15 }
    ),
    tablaMateriales(model),
    texto(""),
    encabezado(HeadingLevel.HEADING_2, "1.3 PERSONAL QUE INTERVINO EN EL PROCESO"),
  ];

  for (const entrada of model.personal) {
    vertical.push(tablaPersonal(entrada));
    vertical.push(texto(""));
  }

  // Sección horizontal: las tablas que crecen una columna por lote.
  const horizontal = [
    encabezado(HeadingLevel.HEADING_2, "1.1 LOTES CONTROLADOS EN LA VALIDACIÓN Y FECHAS DE PROCESO"),
    tablaLotes(model),
    texto(""),
    encabezado(HeadingLevel.HEADING_1, "2. RESULTADOS DE LA VALIDACIÓN"),
    encabezado(HeadingLevel.HEADING_2, "2.1 VERIFICACIONES DE PARÁMETROS DE PROCESO"),
  ];

  for (const table of model.tablas) {
    if (table.lotes.length === 0 || table.rowCount === 0) continue;

    // Con muchos lotes las columnas quedarían ilegibles: se parte en bloques,
    // igual que el reporte de referencia, que usa una tabla por presentación.
    for (let i = 0; i < table.lotes.length; i += LOTES_POR_TABLA) {
      const grupo = table.lotes.slice(i, i + LOTES_POR_TABLA);
      const rango =
        table.lotes.length > LOTES_POR_TABLA
          ? ` (lotes ${i + 1}–${i + grupo.length} de ${table.lotes.length})`
          : "";

      horizontal.push(encabezado(HeadingLevel.HEADING_3, `Etapa: ${table.stage}${rango}`));
      horizontal.push(tablaParametros(table, grupo));
      horizontal.push(texto(""));
    }
  }

  return new Document({
    styles: { default: { document: { run: { font: FUENTE, size: 16 } } } },
    sections: [
      { properties: pagina(false), children: vertical },
      { properties: pagina(true), children: horizontal },
    ],
  });
}

/** Descarga el informe como archivo .docx. */
export async function exportRvpToWord(documents, familia, options) {
  const doc = buildRvpDocument(documents, familia, options);
  const blob = await Packer.toBlob(doc);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${familia.replace(/[^\w.-]+/g, "_").slice(0, 60)}_RVP.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
