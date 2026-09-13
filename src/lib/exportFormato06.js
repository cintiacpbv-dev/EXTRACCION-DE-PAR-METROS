// FORMATO 6: VERIFICACIÓN DE LA CALIFICACIÓN DE PROVEEDORES.
//
// Una fila por material, con su código y su descripción sacados de la Orden
// de Producción o, si no hay orden, del Registro de Manufactura.
//
// Las columnas "Proveedor / Fabricante" y "Código de calificación" salen en
// blanco a propósito: ese dato no está ni en la orden ni en el registro —vive
// en el listado de proveedores calificados—, y rellenarlo con una suposición
// en un formato que va al expediente sería peor que dejarlo para la persona
// que lo firma. "Verificado por / Fecha" se queda en blanco por lo mismo que
// en los demás formatos: lo firma quien verifica.
//
// La estructura es la del Formato 6 de la empresa, leída de su .docx: hoja
// carta vertical, cinco columnas con sus proporciones, la fila de
// Observaciones combinada al pie del cuadro, la línea de criterios de
// aceptación, y el bloque de "Revisado por / Fecha".

import {
  AlignmentType,
  Document,
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
import { encabezadoYPie } from "./exportEncabezado.js";
import { logoPorDefecto } from "./logoEmpresa.js";

const FUENTE = "Arial";
const TAM = 16;
const AZUL_CABECERA = "C6D9F1";

// Hoja carta, que es la del Formato 6 de la empresa (el 8 va en A4).
const CARTA_ANCHO = 12240;
const CARTA_ALTO = 15840;
const MARGEN = { top: 1417, right: 1701, bottom: 993, left: 1701 };
const ANCHO_UTIL = CARTA_ANCHO - MARGEN.left - MARGEN.right; // 8838

// Las cinco columnas del formato de la empresa —[1129, 2410, 2977, 1498,
// 1417]— llevadas a la misma proporción pero sumando el ancho útil. El
// original suma 9431 y se sale del margen derecho; aquí no, porque una tabla
// que asoma fuera de la caja se imprime cortada.
const COLS = [1058, 2258, 2790, 1404, 1328];

function pagina() {
  return { page: { size: { width: CARTA_ANCHO, height: CARTA_ALTO }, margin: MARGEN } };
}

function parrafo(texto, { bold, align, size = TAM } = {}) {
  return new Paragraph({
    alignment: align,
    spacing: { before: 20, after: 20 },
    children: [new TextRun({ text: String(texto ?? ""), font: FUENTE, size, bold })],
  });
}

function celda(texto, { bold, align, fill, width, colSpan } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: [parrafo(texto, { bold, align })],
  });
}

function tabla(anchos, filas) {
  return new Table({
    width: { size: anchos.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: anchos,
    rows: filas,
  });
}

/** El cuadro de materiales, con su cabecera y la fila de Observaciones. */
function cuadroMateriales(materiales) {
  const filas = [
    new TableRow({
      tableHeader: true,
      children: [
        celda("Código del material", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[0] }),
        celda("Descripción del material", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[1] }),
        celda("Proveedor / Fabricante", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[2] }),
        celda("Código de calificación", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[3] }),
        celda("Verificado por / Fecha", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[4] }),
      ],
    }),
  ];

  for (const m of materiales) {
    filas.push(
      new TableRow({
        children: [
          celda(m.codigo, { align: AlignmentType.CENTER, width: COLS[0] }),
          celda(m.descripcion, { width: COLS[1] }),
          // Las tres que se llenan a mano.
          celda("", { width: COLS[2] }),
          celda("", { align: AlignmentType.CENTER, width: COLS[3] }),
          celda("", { width: COLS[4] }),
        ],
      })
    );
  }

  // Sin materiales el cuadro no se queda en la cabecera sola: sale una fila
  // que dice por qué está vacío, para que no parezca un formato roto.
  if (materiales.length === 0) {
    filas.push(
      new TableRow({
        children: [
          celda("No se reconoció ningún material en los documentos cargados.", {
            colSpan: 5,
            align: AlignmentType.CENTER,
            width: ANCHO_UTIL,
          }),
        ],
      })
    );
  }

  filas.push(
    new TableRow({
      children: [celda("Observaciones:", { colSpan: 5, width: ANCHO_UTIL })],
    })
  );

  return tabla(COLS, filas);
}

/** "Revisado por: ____  Fecha: ____", como en el formato de la empresa. */
function bloqueFirma() {
  const anchos = [1908, 3081, 804, 3045]; // las proporciones del original, al ancho útil
  return tabla(anchos, [
    new TableRow({
      children: [
        celda("Revisado por:", { width: anchos[0] }),
        celda("", { width: anchos[1] }),
        celda("Fecha:", { width: anchos[2] }),
        celda("", { width: anchos[3] }),
      ],
    }),
  ]);
}

/**
 * De dónde salieron los materiales, dicho en el propio formato.
 *
 * No es decoración: quien revisa el expediente tiene que poder saber si la
 * lista se armó con las órdenes de producción —que es lo completo— o sólo con
 * lo que declaraban los registros.
 */
function procedencia(materiales) {
  const deOrden = materiales.filter((m) => m.deOrden).length;
  if (materiales.length === 0) return null;
  if (deOrden === materiales.length) return "Materiales tomados de la Orden de Producción.";
  if (deOrden === 0) return "Materiales tomados de la sección INSUMOS del Registro de Manufactura.";
  return `Materiales tomados de la Orden de Producción (${deOrden}) y del Registro de Manufactura (${
    materiales.length - deOrden
  }).`;
}

export function construirFormato06({ materiales = [], producto = "", lote = "", opciones = {} }) {
  const nota = procedencia(materiales);

  const hijos = [
    new Paragraph({
      spacing: { after: 160 },
      children: [
        new TextRun({
          text: "FORMATO 6: VERIFICACIÓN DE LA CALIFICACIÓN DE PROVEEDORES.",
          font: FUENTE,
          size: 22,
          bold: true,
        }),
      ],
    }),
    parrafo(`Producto: ${producto || "_____________________"}`),
    parrafo(`Lote: ${lote || "_____________________"}`),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
    cuadroMateriales(materiales),
    new Paragraph({ spacing: { before: 200, after: 200 }, children: [] }),
    ...(nota ? [parrafo(nota, { size: 14 }), new Paragraph({ spacing: { after: 120 }, children: [] })] : []),
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
          titulo: ["VERIFICACIÓN DE LA CALIFICACIÓN DE PROVEEDORES", producto || ""],
          codigo: opciones.codigo,
          empresa: opciones.empresa,
          planta: opciones.planta,
          logo: opciones.logo || logoPorDefecto(),
        }),
        children: hijos,
      },
    ],
  });

  return { doc, resumen: { filas: materiales.length, deOrden: materiales.filter((m) => m.deOrden).length } };
}

export async function exportarFormato06(datos) {
  const { doc, resumen } = construirFormato06(datos);
  const blob = await Packer.toBlob(doc);

  const nombre = String(datos.producto || "").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre ? `${nombre}_FORMATO_06.docx` : "FORMATO_06.docx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return resumen;
}
