// Encabezado y pie de página del Formato A09, tomados del propio protocolo
// de referencia de la empresa (mismo logo, misma tabla de tres columnas,
// mismo pie con "MEDIFARMA S.A. · PLANTA · Pág. N de M").
//
// El encabezado real cambia de código y de "Adenda N°" según el protocolo
// que le dio origen — datos que ni el RMD ni la orden traen, así que aquí se
// dejan en blanco para completar a mano; el nombre del producto y la etapa sí
// salen del propio análisis.

import {
  AlignmentType,
  Footer,
  Header,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  BorderStyle,
  PageNumber,
} from "docx";
import { MEDIFARMA_LOGO_BASE64 } from "../assets/medifarmaLogo.js";

const FUENTE = "Arial";

// Proporción de columnas del original (logo | título | código), aplicada al
// ancho útil de cada orientación: 11.8 % · 76.4 % · 11.8 %.
const PROP_LOGO = 0.118;
const PROP_CODIGO = 0.118;

// El PNG mide 280×77 px de por sí; se conserva esa proporción para que no
// salga estirado, a un tamaño que quepa cómodo en la columna angosta.
const LOGO_ANCHO_PX = 100;
const LOGO_ALTO_PX = 27;

let logoBytesCache = null;

/** Bytes del logo, decodificados una sola vez. */
function logoBytes() {
  if (!logoBytesCache) {
    const binario = atob(MEDIFARMA_LOGO_BASE64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    logoBytesCache = bytes;
  }
  return logoBytesCache;
}

const SIN_BORDE = { style: BorderStyle.NONE, size: 0, space: 0, color: "auto" };
const BORDES_ENCABEZADO = {
  top: { style: BorderStyle.SINGLE, size: 4, space: 0, color: "auto" },
  bottom: { style: BorderStyle.SINGLE, size: 4, space: 0, color: "auto" },
  left: { style: BorderStyle.SINGLE, size: 4, space: 0, color: "auto" },
  right: { style: BorderStyle.SINGLE, size: 4, space: 0, color: "auto" },
  insideHorizontal: SIN_BORDE,
  insideVertical: { style: BorderStyle.SINGLE, size: 4, space: 0, color: "auto" },
};

function parrafo(runs, { centrado = true } = {}) {
  return new Paragraph({
    alignment: centrado ? AlignmentType.CENTER : undefined,
    spacing: { before: 0, after: 0 },
    children: runs,
  });
}

function celda(children, ancho, { vAlign = VerticalAlign.CENTER } = {}) {
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    verticalAlign: vAlign,
    children,
  });
}

/**
 * El encabezado de cada página: logo a la izquierda, nombre del producto y
 * etapa al centro, y a la derecha el código del protocolo — en blanco si no
 * se conoce, para completarlo a mano igual que el resto de datos que el RMD
 * no trae.
 */
export function encabezadoTabla({ ancho, producto, procesoTexto, codigo }) {
  const anchoLogo = Math.round(ancho * PROP_LOGO);
  const anchoCodigo = Math.round(ancho * PROP_CODIGO);
  const anchoTitulo = ancho - anchoLogo - anchoCodigo;

  const filasCodigo = [
    parrafo([new TextRun({ text: "Código:", font: FUENTE, size: 18 })]),
    parrafo([new TextRun({ text: codigo || "", font: FUENTE, size: 18 })]),
  ];

  return new Table({
    width: { size: ancho, type: WidthType.DXA },
    columnWidths: [anchoLogo, anchoTitulo, anchoCodigo],
    borders: BORDES_ENCABEZADO,
    rows: [
      new TableRow({
        children: [
          celda(
            [
              parrafo([
                new ImageRun({
                  type: "png",
                  data: logoBytes(),
                  transformation: { width: LOGO_ANCHO_PX, height: LOGO_ALTO_PX },
                }),
              ]),
            ],
            anchoLogo
          ),
          celda(
            [
              parrafo([new TextRun({ text: producto, font: FUENTE, size: 21, bold: true })]),
              parrafo([new TextRun({ text: procesoTexto, font: FUENTE, size: 21, bold: true })]),
            ],
            anchoTitulo
          ),
          celda(filasCodigo, anchoCodigo),
        ],
      }),
    ],
  });
}

/** El pie de cada página: empresa, planta y "Pág. N de M". */
export function piePaginaTabla({ ancho, planta }) {
  const tercio = Math.floor(ancho / 3);
  const anchos = [tercio, tercio, ancho - tercio * 2];

  return new Table({
    width: { size: ancho, type: WidthType.DXA },
    columnWidths: anchos,
    borders: { ...Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((l) => [l, SIN_BORDE])), top: BORDES_ENCABEZADO.top },
    rows: [
      new TableRow({
        children: [
          celda([parrafo([new TextRun({ text: "MEDIFARMA S.A.", font: FUENTE, size: 16 })], { centrado: false })], anchos[0]),
          celda([parrafo([new TextRun({ text: planta || "", font: FUENTE, size: 16 })])], anchos[1]),
          celda(
            [
              parrafo(
                [
                  new TextRun({ text: "Pág. ", font: FUENTE, size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], font: FUENTE, size: 16 }),
                  new TextRun({ text: " de ", font: FUENTE, size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FUENTE, size: 16 }),
                ],
                { centrado: false }
              ),
            ],
            anchos[2]
          ),
        ],
      }),
    ],
  });
}

/** Cabecera y pie ya envueltos en Header/Footer, listos para una sección. */
export function encabezadoYPie({ ancho, producto, procesoTexto, codigo, planta }) {
  return {
    headers: { default: new Header({ children: [encabezadoTabla({ ancho, producto, procesoTexto, codigo })] }) },
    footers: { default: new Footer({ children: [piePaginaTabla({ ancho, planta })] }) },
  };
}
