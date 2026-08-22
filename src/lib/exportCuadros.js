// Réplica exacta de los tres cuadros del reporte de validación de referencia.
//
// El formato no se aproxima: está tomado del XML del propio documento —
// cabeceras en azul C6D9F1, Arial 8 pt, bordes finos de media línea, celdas
// combinadas vertical y horizontalmente, alturas de fila y alineaciones.
//
//   Cuadro 1  LOTES CONTROLADOS EN LA VALIDACIÓN Y FECHAS DE PROCESO
//   Cuadro 2  MATERIALES UTILIZADOS EN LOS LOTES
//   Cuadro 3  PERSONAL QUE INTERVINO EN EL PROCESO

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { buildRvpModel } from "./rvpData.js";
import { formatPersonName } from "./personName.js";

// --- constantes tomadas del documento de referencia -------------------------

const FUENTE = "Arial";
const TAM = 16; // media-puntos → 8 pt
const AZUL_CABECERA = "C6D9F1";

const BORDE = { style: BorderStyle.SINGLE, size: 4, space: 0, color: "auto" };
const BORDES_TABLA = {
  top: BORDE,
  bottom: BORDE,
  left: BORDE,
  right: BORDE,
  insideHorizontal: BORDE,
  insideVertical: BORDE,
};

// Anchos de columna del original, en DXA.
const ANCHOS_LOTES = { num: 408, receta: 1135, producto: 2694, lote: 850, fecha: 1137 };
const ANCHOS_MATERIALES = [1890, 1353, 1085, 1484, 1554, 1649];
const ANCHO_TABLA_PERSONAL = 13780;
const SANGRIA_PERSONAL = 137;

// Alturas de fila del original.
const ALTO_CAB_1 = 411;
const ALTO_CAB_2 = 476;
const ALTO_SECCION = 303;
const ALTO_DATO = 482;
const ALTO_MAT_CAB = 310;
const ALTO_MAT_SECCION = 286;
const ALTO_MAT_DATO = 227;
const ALTO_PERS_CAB = 338;
const ALTO_PERS_FUNCION = 281;
const ALTO_PERS_NOMBRES = 454;

// A4 con los márgenes del reporte.
const A4_ANCHO = 11907;
const A4_ALTO = 16840;
const MARGEN = 1000;

const LOTES_POR_TABLA = 10; // como el original, una tabla por bloque de lotes

// --- utilidades -------------------------------------------------------------

function parrafo(texto, { bold = false, align } = {}) {
  return new Paragraph({
    alignment: align,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: String(texto ?? ""), font: FUENTE, size: TAM, bold })],
  });
}

function celda(texto, { bold, align, fill, width, colSpan, rowSpan } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    rowSpan,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: [parrafo(texto, { bold, align })],
  });
}

/** Celda con varias líneas (un párrafo por nombre), en vez de un texto unido por separadores. */
function celdaLineas(lineas, { align, fill, width, colSpan, rowSpan } = {}) {
  const filas = lineas.length > 0 ? lineas : [""];
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    rowSpan,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: filas.map((linea) => parrafo(linea, { align })),
  });
}

function fila(celdas, { alto, cabecera = false } = {}) {
  return new TableRow({
    children: celdas,
    tableHeader: cabecera,
    height: alto ? { value: alto, rule: HeightRule.ATLEAST } : undefined,
  });
}

function tabla(columnWidths, filas, { indent } = {}) {
  return new Table({
    width: { size: columnWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: BORDES_TABLA,
    alignment: AlignmentType.CENTER,
    indent: indent ? { size: indent, type: WidthType.DXA } : undefined,
    rows: filas,
  });
}

/** Fila de separación que abarca la tabla entera, con el nombre del producto. */
function filaProducto(texto, nCols, ancho, alto) {
  return fila([celda(texto, { bold: true, colSpan: nCols, width: ancho })], { alto });
}

// --- Cuadro 1: lotes controlados y fechas ----------------------------------

function cuadroLotes(model) {
  const { stages, filas: lotes } = model.lotes;
  const A = ANCHOS_LOTES;
  const anchos = [A.num, A.receta, A.producto, A.lote, ...Array(stages.length * 2).fill(A.fecha)];
  const total = anchos.reduce((a, b) => a + b, 0);
  const nCols = anchos.length;

  // Cabecera de dos filas: las cuatro primeras columnas se combinan en
  // vertical y cada etapa abre dos columnas bajo un título común.
  const cab1 = [
    celda("N°", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: A.num, rowSpan: 2 }),
    celda("RECETA", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: A.receta, rowSpan: 2 }),
    celda("PRODUCTO", { bold: true, fill: AZUL_CABECERA, width: A.producto, rowSpan: 2 }),
    celda("LOTE", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: A.lote, rowSpan: 2 }),
    ...stages.map((s) =>
      celda(s, { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: A.fecha * 2, colSpan: 2 })
    ),
  ];

  const cab2 = [];
  for (const _ of stages) {
    cab2.push(celda("FECHA DE INICIO", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: A.fecha }));
    cab2.push(celda("FECHA DE TERMINO", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: A.fecha }));
  }

  const filas = [fila(cab1, { alto: ALTO_CAB_1, cabecera: true }), fila(cab2, { alto: ALTO_CAB_2, cabecera: true })];

  // Los lotes se agrupan por presentación, con una fila de título por grupo,
  // igual que el original separa las presentaciones de 8 mL y 12 mL.
  const grupos = new Map();
  for (const f of lotes) {
    if (!grupos.has(f.producto)) grupos.set(f.producto, []);
    grupos.get(f.producto).push(f);
  }

  let n = 0;
  for (const [producto, delGrupo] of grupos) {
    filas.push(filaProducto(producto, nCols, total, ALTO_SECCION));

    for (const f of delGrupo) {
      n++;
      const celdas = [
        celda(n, { bold: true, align: AlignmentType.CENTER, width: A.num }),
        celda(model.recetas[f.lote] || "", { align: AlignmentType.CENTER, width: A.receta }),
        celda(f.producto, { align: AlignmentType.CENTER, width: A.producto }),
        celda(f.lote, { align: AlignmentType.CENTER, width: A.lote }),
      ];
      for (const s of stages) {
        const e = f.etapas[s] || {};
        celdas.push(celda(e.inicio || "", { align: AlignmentType.CENTER, width: A.fecha }));
        celdas.push(celda(e.fin || "", { align: AlignmentType.CENTER, width: A.fecha }));
      }
      filas.push(fila(celdas, { alto: ALTO_DATO }));
    }
  }

  return tabla(anchos, filas);
}

// --- Cuadro 2: materiales utilizados ---------------------------------------

function cuadroMateriales(model) {
  const anchos = ANCHOS_MATERIALES;
  const total = anchos.reduce((a, b) => a + b, 0);
  const cabecera = ["Nombre", "Lote ME", "Lote", "Proveedor", "Fabricante", "Fecha de vencimiento"];

  const filas = [
    fila(
      cabecera.map((h, i) =>
        celda(h, { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: anchos[i] })
      ),
      { alto: ALTO_MAT_CAB, cabecera: true }
    ),
  ];

  // Los materiales se agrupan por presentación y, dentro de cada una, las
  // filas del mismo material comparten una sola celda de nombre combinada
  // en vertical, como en el original.
  const porProducto = new Map();
  for (const m of model.materiales) {
    const clave = m.producto || model.familia;
    if (!porProducto.has(clave)) porProducto.set(clave, []);
    porProducto.get(clave).push(m);
  }

  let grupo = 0;
  for (const [producto, materiales] of porProducto) {
    grupo++;
    filas.push(filaProducto(`${grupo}.- ${producto}`, 6, total, ALTO_MAT_SECCION));

    // Se cuenta cuántas filas seguidas comparte cada nombre de material.
    let i = 0;
    while (i < materiales.length) {
      const nombre = materiales[i].nombre;
      let j = i;
      while (j < materiales.length && materiales[j].nombre === nombre) j++;
      const repeticiones = j - i;

      for (let k = i; k < j; k++) {
        const m = materiales[k];
        const celdas = [];

        if (k === i) {
          celdas.push(
            celda(nombre, {
              align: AlignmentType.CENTER,
              width: anchos[0],
              rowSpan: repeticiones > 1 ? repeticiones : undefined,
            })
          );
        }

        celdas.push(celda(m.loteMaterial || "", { align: AlignmentType.CENTER, width: anchos[1] }));
        celdas.push(celda(m.lote, { align: AlignmentType.CENTER, width: anchos[2] }));
        celdas.push(celda(m.proveedor || "", { align: AlignmentType.CENTER, width: anchos[3] }));
        celdas.push(celda(m.fabricante || "", { align: AlignmentType.CENTER, width: anchos[4] }));
        celdas.push(celda(m.fechaVencimiento || "", { align: AlignmentType.CENTER, width: anchos[5] }));

        filas.push(fila(celdas, { alto: ALTO_MAT_DATO }));
      }

      i = j;
    }
  }

  return tabla(anchos, filas);
}

// --- Cuadro 3: personal que intervino --------------------------------------

function tablaPersonalBloque(entrada, lotes) {
  const n = lotes.length;
  const ancho = Math.floor(ANCHO_TABLA_PERSONAL / n);
  const anchos = Array(n).fill(ancho);
  const total = anchos.reduce((a, b) => a + b, 0);

  const nombres = (lote, rol) => (entrada.porLote[lote]?.[rol] || []).map((n) => formatPersonName(n));

  return tabla(
    anchos,
    [
      fila([celda(`LOTES – ${entrada.stage}`, { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, colSpan: n, width: total })], { alto: ALTO_PERS_CAB, cabecera: true }),
      fila(
        lotes.map((l) => celda(l, { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: ancho })),
        { alto: ALTO_PERS_CAB, cabecera: true }
      ),
      fila([celda(entrada.producto, { bold: true, colSpan: n, width: total })], { alto: ALTO_PERS_CAB, cabecera: true }),
      fila([celda("FUNCIÓN: OPERADOR", { bold: true, colSpan: n, width: total })], { alto: ALTO_PERS_FUNCION }),
      fila([celda(entrada.stage, { bold: true, colSpan: n, width: total })], { alto: ALTO_PERS_FUNCION }),
      fila(
        lotes.map((l) => celdaLineas(nombres(l, "operarios"), { align: AlignmentType.CENTER, width: ancho })),
        { alto: ALTO_PERS_NOMBRES }
      ),
      fila([celda("FUNCIÓN: SUPERVISOR (Q.F.)", { bold: true, colSpan: n, width: total })], { alto: ALTO_PERS_FUNCION }),
      fila(
        lotes.map((l) => celdaLineas(nombres(l, "supervisores"), { align: AlignmentType.CENTER, width: ancho })),
        { alto: ALTO_PERS_NOMBRES }
      ),
    ],
    { indent: SANGRIA_PERSONAL }
  );
}

// --- documento --------------------------------------------------------------

function titulo(texto) {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text: texto, font: FUENTE, size: 20, bold: true })],
  });
}

function pagina(horizontal) {
  return {
    page: {
      margin: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
      size: horizontal
        ? { width: A4_ANCHO, height: A4_ALTO, orientation: PageOrientation.LANDSCAPE }
        : { width: A4_ANCHO, height: A4_ALTO },
    },
  };
}

export function buildCuadrosDocument(documents, familia, options) {
  const model = buildRvpModel(documents, familia, options);

  // El cuadro de lotes crece dos columnas por etapa y el de personal una por
  // lote: ambos van en horizontal, como el original hace con los suyos.
  const horizontal = [
    titulo("1. LOTES CONTROLADOS EN LA VALIDACIÓN Y FECHAS DE PROCESO"),
    cuadroLotes(model),
  ];

  const vertical = [titulo("2. MATERIALES UTILIZADOS EN LOS LOTES"), cuadroMateriales(model)];

  const personal = [titulo("3. PERSONAL QUE INTERVINO EN EL PROCESO")];
  for (const entrada of model.personalPorLote) {
    if (entrada.lotes.length === 0) continue;
    for (let i = 0; i < entrada.lotes.length; i += LOTES_POR_TABLA) {
      personal.push(tablaPersonalBloque(entrada, entrada.lotes.slice(i, i + LOTES_POR_TABLA)));
      personal.push(new Paragraph({ children: [] }));
    }
  }

  return new Document({
    styles: { default: { document: { run: { font: FUENTE, size: TAM } } } },
    sections: [
      { properties: pagina(true), children: horizontal },
      { properties: pagina(false), children: vertical },
      { properties: pagina(true), children: personal },
    ],
  });
}

export async function exportCuadrosToWord(documents, familia, options) {
  const doc = buildCuadrosDocument(documents, familia, options);
  const blob = await Packer.toBlob(doc);

  const sufijoEtapa = options?.stage ? `_${options.stage.replace(/[^\w.-]+/g, "_")}` : "";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${familia.replace(/[^\w.-]+/g, "_").slice(0, 60)}${sufijoEtapa}_FORMATO_A09.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
