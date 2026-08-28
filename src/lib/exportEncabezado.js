// Encabezado y pie de página del Formato A09, con la misma tabla de tres
// columnas y el mismo pie que el protocolo de referencia de la empresa
// (logo | producto y proceso | código; abajo empresa, planta y "Pág. N de M").
//
// Nada de esto se identifica con una marca fija en el código: el primer logo
// que se probó aquí era el de otra empresa (Medifarma, del documento de
// referencia que sirvió para copiar el diseño), y no el de quien realmente
// usa esta aplicación. El logo, la empresa, el código y la planta se reciben
// como datos —vacíos si no se dan— igual que el resto de lo que el RMD y la
// orden no pueden decir.

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

const FUENTE = "Arial";

// Ancho fijo de las columnas de logo y código, en vez de una proporción del
// ancho de página como en el original: el logo de esta empresa es un
// logotipo apaisado (191×26 px, casi 7:1), y calculado como porcentaje se
// veía bien en la hoja horizontal pero se aplastaba en la vertical, donde el
// ancho útil es un tercio menor. Con un ancho fijo el logo se ve del mismo
// tamaño en las dos orientaciones, que es como se ve un logo real.
const ANCHO_LOGO_DXA = 2200;
const ANCHO_CODIGO_DXA = 1500;

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
 * La celda del logo. Sin uno real que embeber, queda marcada entre corchetes
 * en vez de dejarse en blanco sin más: así no pasa por descuido, ni —lo que
 * importa más— por el logo de otra empresa.
 */
function celdaLogo(logo, ancho) {
  if (!logo?.bytes) {
    return celda(
      [parrafo([new TextRun({ text: "[LOGO]", font: FUENTE, size: 16, italics: true, color: "808080" })])],
      ancho
    );
  }

  return celda(
    [
      parrafo([
        new ImageRun({
          type: logo.tipo || "png",
          data: logo.bytes,
          transformation: { width: logo.ancho, height: logo.alto },
        }),
      ]),
    ],
    ancho
  );
}

/**
 * El encabezado de cada página: logo a la izquierda, nombre del producto y
 * etapa al centro, y a la derecha el código del protocolo. Todo lo que la
 * aplicación no puede saber por sí sola —logo, código— queda marcado para
 * completar, nunca adivinado.
 */
export function encabezadoTabla({ ancho, producto, procesoTexto, codigo, logo }) {
  const anchoLogo = ANCHO_LOGO_DXA;
  const anchoCodigo = ANCHO_CODIGO_DXA;
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
          celdaLogo(logo, anchoLogo),
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
export function piePaginaTabla({ ancho, empresa, planta }) {
  const tercio = Math.floor(ancho / 3);
  const anchos = [tercio, tercio, ancho - tercio * 2];

  return new Table({
    width: { size: ancho, type: WidthType.DXA },
    columnWidths: anchos,
    borders: {
      ...Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((l) => [l, SIN_BORDE])),
      top: BORDES_ENCABEZADO.top,
    },
    rows: [
      new TableRow({
        children: [
          celda([parrafo([new TextRun({ text: empresa || "", font: FUENTE, size: 16 })], { centrado: false })], anchos[0]),
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
export function encabezadoYPie({ ancho, producto, procesoTexto, codigo, empresa, planta, logo }) {
  return {
    headers: { default: new Header({ children: [encabezadoTabla({ ancho, producto, procesoTexto, codigo, logo })] }) },
    footers: { default: new Footer({ children: [piePaginaTabla({ ancho, empresa, planta })] }) },
  };
}
