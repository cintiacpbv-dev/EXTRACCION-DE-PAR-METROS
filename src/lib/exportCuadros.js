// Réplica exacta de los tres cuadros del reporte de validación de referencia.
//
// El formato no se aproxima: está tomado del XML del propio documento —
// cabeceras en azul C6D9F1, Arial 8 pt, bordes finos de media línea, celdas
// combinadas vertical y horizontalmente, alturas de fila y alineaciones.
//
//   Cuadro 1  LOTES CONTROLADOS EN LA VALIDACIÓN Y FECHAS DE PROCESO
//   Cuadro 2  MATERIALES UTILIZADOS EN LOS LOTES
//   Cuadro 3  PERSONAL QUE INTERVINO EN EL PROCESO
//   Cuadro 4  VERIFICACIÓN DE PARÁMETROS DE PROCESO (págs. 8-15 del original)

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
  TextDirection,
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

// El cuadro de personal aprovecha el ancho entero de la hoja horizontal en
// vez de cortar cada diez lotes: se meten todas las columnas que quepan y,
// sólo si sobran, continúan en la hoja siguiente. Por debajo de este ancho
// los nombres dejan de leerse.
const ANCHO_UTIL_HORIZONTAL = A4_ALTO - MARGEN * 2;
const ANCHO_MIN_COL_PERSONAL = 650;

function lotesPorHoja(total) {
  const caben = Math.max(1, Math.floor(ANCHO_UTIL_HORIZONTAL / ANCHO_MIN_COL_PERSONAL));
  return Math.min(total, caben);
}

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
  // Con pocos lotes se conserva el ancho del original; con muchos se estira
  // hasta el borde de la hoja para que quepan todos.
  const disponible = Math.max(ANCHO_TABLA_PERSONAL, Math.min(ANCHO_UTIL_HORIZONTAL, n * ANCHO_MIN_COL_PERSONAL));
  const ancho = Math.floor(disponible / n);
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

// --- Cuadro 4: verificación de parámetros de proceso ------------------------
//
// Réplica del cuadro de las páginas 8 a 15 del formato de referencia. Sus
// medidas salen del XML de ese documento: tabla de 14454 DXA centrada, con
// una primera columna estrecha de texto girado, el nombre del parámetro
// ocupando tres columnas, el rango de operación, y una columna por lote.

const ANCHOS_PARAM = { rotulo: 422, nombreA: 707, nombreB: 34, nombreC: 881, rango: 1353 };
const ANCHO_TABLA_PARAM = 14454;

// El original usa 7,5 pt en la cabecera y 7 pt en los datos, más pequeño que
// los otros cuadros.
const TAM_PARAM_CAB = 15;
const TAM_PARAM_DATO = 14;

const ALTO_PAR_CAB1 = 248;
const ALTO_PAR_CAB2 = 280;
const ALTO_PAR_SECCION = 286;
const ALTO_PAR_DATO = 400;

// Por debajo de esta cantidad de filas el rótulo girado no cabe.
const MIN_FILAS_ROTULO = 4;

function parrafoParam(texto, { bold = false, align, size = TAM_PARAM_DATO } = {}) {
  return new Paragraph({
    alignment: align,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text: String(texto ?? ""), font: FUENTE, size, bold })],
  });
}

function celdaParam(texto, opciones = {}) {
  const { bold, align, fill, width, colSpan, rowSpan, size, girado } = opciones;
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    rowSpan,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    // La primera columna lleva el texto girado de abajo arriba, como el
    // rótulo "MATERIAL DE ACONDICIONADO" del original.
    textDirection: girado ? TextDirection.BOTTOM_TO_TOP_LEFT_TO_RIGHT : undefined,
    children: [parrafoParam(texto, { bold, align, size })],
  });
}

function valorParaCuadro(valor) {
  if (valor === undefined || valor === null || valor === "") return "---";
  if (valor === "ü") return "Conforme";
  return typeof valor === "number" ? String(Math.round(valor * 1000) / 1000) : String(valor);
}

/** Un bloque del cuadro 4: la tabla de parámetros para un grupo de lotes. */
function cuadroParametros(datos, lotes, etapa) {
  const A = ANCHOS_PARAM;
  const fijas = A.rotulo + A.nombreA + A.nombreB + A.nombreC + A.rango;
  const anchoLote = Math.floor((ANCHO_TABLA_PARAM - fijas) / Math.max(lotes.length, 1));
  const anchos = [A.rotulo, A.nombreA, A.nombreB, A.nombreC, A.rango, ...Array(lotes.length).fill(anchoLote)];
  const nCols = anchos.length;
  const total = anchos.reduce((a, b) => a + b, 0);

  const filas = [
    // Cabecera de dos filas: los rótulos fijos se combinan en vertical y
    // "RESULTADOS" abarca todas las columnas de lote.
    fila(
      [
        celdaParam("Parámetros de proceso", {
          bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA,
          colSpan: 4, rowSpan: 2, size: TAM_PARAM_CAB, width: A.rotulo + A.nombreA + A.nombreB + A.nombreC,
        }),
        celdaParam("Rango de operación", {
          bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA,
          rowSpan: 2, size: TAM_PARAM_CAB, width: A.rango,
        }),
        celdaParam("RESULTADOS", {
          bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA,
          colSpan: lotes.length, size: TAM_PARAM_CAB, width: anchoLote * lotes.length,
        }),
      ],
      { alto: ALTO_PAR_CAB1, cabecera: true }
    ),
    fila(
      lotes.map((l) =>
        celdaParam(l, {
          bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA,
          size: TAM_PARAM_CAB, width: anchoLote,
        })
      ),
      { alto: ALTO_PAR_CAB2, cabecera: true }
    ),
  ];

  for (const seccion of datos.sections) {
    filas.push(
      fila([celdaParam(seccion.title, { bold: true, colSpan: nCols, width: total, size: TAM_PARAM_CAB })], {
        alto: ALTO_PAR_SECCION,
      })
    );

    seccion.rows.forEach((row, i) => {
      const celdas = [];

      // El rótulo girado se combina sólo a lo largo de las filas de SU
      // sección. Abarcar todas las filas de datos cruzaría por encima de las
      // filas de sección, que ocupan el ancho entero, y la tabla se
      // descuadraba por la derecha.
      if (i === 0) {
        // El rótulo sólo se escribe si la sección tiene filas suficientes
        // para que quepa girado; en un bloque de una o dos filas saldría
        // partido en pedazos ilegibles. La celda se emite igual, vacía, para
        // no descuadrar la columna.
        const cabeElRotulo = seccion.rows.length >= MIN_FILAS_ROTULO;
        celdas.push(
          celdaParam(cabeElRotulo ? etapa : "", {
            align: AlignmentType.CENTER, girado: true, rowSpan: seccion.rows.length, width: A.rotulo,
          })
        );
      }

      const etiqueta = row.unit && !row.label.includes(row.unit) ? `${row.label} (${row.unit})` : row.label;
      celdas.push(
        celdaParam(etiqueta, {
          align: AlignmentType.BOTH, colSpan: 3, width: A.nombreA + A.nombreB + A.nombreC,
        })
      );
      celdas.push(
        celdaParam(row.setpoint || "Referencial", { align: AlignmentType.CENTER, width: A.rango })
      );

      for (const lote of lotes) {
        celdas.push(
          celdaParam(valorParaCuadro(row.values[lote]), { align: AlignmentType.CENTER, width: anchoLote })
        );
      }

      filas.push(fila(celdas, { alto: ALTO_PAR_DATO }));
    });
  }

  return tabla(anchos, filas);
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
    const porHoja = lotesPorHoja(entrada.lotes.length);
    for (let i = 0; i < entrada.lotes.length; i += porHoja) {
      personal.push(tablaPersonalBloque(entrada, entrada.lotes.slice(i, i + porHoja)));
      personal.push(new Paragraph({ children: [] }));
    }
  }

  // Cuadro 4: una tabla por etapa y por bloque de lotes, como el original,
  // que parte sus veinte lotes en dos tablas de diez.
  const parametros = [titulo("4. VERIFICACIÓN DE PARÁMETROS DE PROCESO")];
  for (const datos of model.tablas) {
    if (datos.lotes.length === 0 || datos.rowCount === 0) continue;

    for (let i = 0; i < datos.lotes.length; i += LOTES_POR_TABLA) {
      const grupo = datos.lotes.slice(i, i + LOTES_POR_TABLA);
      parametros.push(cuadroParametros(datos, grupo, datos.stage));
      parametros.push(new Paragraph({ children: [] }));
    }
  }

  return new Document({
    styles: { default: { document: { run: { font: FUENTE, size: TAM } } } },
    sections: [
      { properties: pagina(true), children: horizontal },
      { properties: pagina(false), children: vertical },
      { properties: pagina(true), children: personal },
      // El cuadro 4 crece una columna por lote: horizontal, como en el
      // formato de referencia, donde ocupa las páginas 8 a 15.
      { properties: pagina(true), children: parametros },
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
