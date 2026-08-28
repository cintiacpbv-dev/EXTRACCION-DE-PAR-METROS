// FORMATO 3: VERIFICACIÓN DE LA CALIFICACIÓN DE EQUIPOS.
//
// Réplica del formato de la empresa, tomada del XML del propio documento: la
// tabla mide 10019 DXA, sus ocho columnas [996, 1288, 3102, 1701, 993, 425,
// 447, 1067], la cabecera va en azul C6D9F1 con "Verificar" combinado sobre
// CO y CD, y los datos en Arial 8.
//
// Lo que la aplicación sabe rellenar —código, código SAP, descripción, código
// de calificación y fecha— sale del registro de manufactura cruzado con el
// cronograma de calificación. Lo que no puede saber (si la verificación se
// hizo, quién la hizo y cuándo) se deja en blanco, como en el original: son
// casillas que se firman a mano.
//
// Las casillas CO y CD llevan un guion cuando esa calificación no existe en
// el cronograma, igual que en los formatos ya emitidos: ahí no hay nada que
// verificar. Si existe, quedan vacías para marcarlas al verificarlas.

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
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
import { buscarCalificacion, indexar } from "./calificaciones.js";
import { esEquipoCalificable } from "./parsers/equipos.js";
import { encabezadoYPie } from "./exportEncabezado.js";
import { logoPorDefecto } from "./logoEmpresa.js";

const FUENTE = "Arial";
const TAM = 16; // media-puntos → 8 pt
const AZUL_CABECERA = "C6D9F1";
const SIN_CALIFICACION = "-";

const A4_ANCHO = 11907;
const A4_ALTO = 16840;
const MARGEN = 1418; // el del formato original
const ANCHO_UTIL = A4_ANCHO - MARGEN * 2;

const ANCHOS = [996, 1288, 3102, 1701, 993, 425, 447, 1067];
const ANCHO_TABLA = ANCHOS.reduce((a, b) => a + b, 0);

const BORDE = { style: BorderStyle.SINGLE, size: 4, space: 0, color: "auto" };
const BORDES_TABLA = {
  top: BORDE,
  bottom: BORDE,
  left: BORDE,
  right: BORDE,
  insideHorizontal: BORDE,
  insideVertical: BORDE,
};

function parrafo(texto, { negrita = false, centrado = true } = {}) {
  return new Paragraph({
    alignment: centrado ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: 240, lineRule: "auto" },
    children: [new TextRun({ text: texto ?? "", font: FUENTE, size: TAM, bold: negrita })],
  });
}

function celda(texto, ancho, { negrita = false, centrado = true, fondo = null, rowSpan, columnSpan } = {}) {
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    rowSpan,
    columnSpan,
    shading: fondo ? { type: ShadingType.CLEAR, color: "auto", fill: fondo } : undefined,
    children: [parrafo(texto, { negrita, centrado })],
  });
}

/**
 * La cabecera va en dos filas: "Verificar" se extiende sobre CO y CD, y las
 * otras seis columnas se combinan verticalmente. Es como está en el formato
 * de la empresa.
 */
function filasCabecera() {
  const titulos = [
    "Código",
    "Código SAP",
    "Descripción",
    "Código de calificación",
    "Fecha",
    null,
    null,
    "Verificado por / Fecha",
  ];

  const primera = [];
  titulos.forEach((titulo, i) => {
    if (i === 5) {
      primera.push(celda("Verificar", ANCHOS[5] + ANCHOS[6], { negrita: true, fondo: AZUL_CABECERA, columnSpan: 2 }));
      return;
    }
    if (i === 6) return;
    primera.push(celda(titulo, ANCHOS[i], { negrita: true, fondo: AZUL_CABECERA, rowSpan: 2 }));
  });

  const segunda = [
    celda("CO", ANCHOS[5], { negrita: true, fondo: AZUL_CABECERA }),
    celda("CD", ANCHOS[6], { negrita: true, fondo: AZUL_CABECERA }),
  ];

  return [
    new TableRow({ tableHeader: true, height: { value: 360, rule: HeightRule.ATLEAST }, children: primera }),
    new TableRow({ tableHeader: true, height: { value: 260, rule: HeightRule.ATLEAST }, children: segunda }),
  ];
}

function filaEquipo(fila) {
  return new TableRow({
    height: { value: 300, rule: HeightRule.ATLEAST },
    children: [
      celda(fila.codigoMif, ANCHOS[0]),
      celda(fila.codigoSap, ANCHOS[1]),
      celda(fila.descripcion, ANCHOS[2], { centrado: false }),
      celda(fila.codigoCalificacion, ANCHOS[3]),
      celda(fila.fecha, ANCHOS[4]),
      celda(fila.co, ANCHOS[5]),
      celda(fila.cd, ANCHOS[6]),
      celda("", ANCHOS[7]),
    ],
  });
}

/**
 * Cruza los equipos leídos de los registros con el cronograma.
 *
 * Un equipo que el cronograma no conoce no se descarta ni se rellena con nada
 * inventado: sale en la tabla con sus columnas de calificación vacías y se
 * avisa aparte, para buscarlo a mano. Es lo que pasa, por ejemplo, con el
 * cargador de polvo JUBAO, que en los formatos ya emitidos lleva el código de
 * calificación escrito a mano.
 */
export function filasFormato3(equipos, cronograma, { soloCalificables = true } = {}) {
  const indices = indexar(cronograma);
  const lista = soloCalificables ? equipos.filter(esEquipoCalificable) : equipos;

  return lista.map((equipo) => {
    const info = cronograma ? buscarCalificacion(indices, equipo) : null;

    return {
      codigoSap: equipo.codigoSap || "",
      // El cronograma es la fuente autorizada del código MIF: el registro de
      // manufactura lo escribe con distinto número de ceros.
      codigoMif: info?.codigoMif || equipo.codigoMif || "",
      descripcion: equipo.descripcion || "",
      codigoCalificacion: info?.codigoCalificacion || "",
      fecha: info?.fecha || "",
      co: info ? (info.tieneCo ? "" : SIN_CALIFICACION) : "",
      cd: info ? (info.tieneCd ? "" : SIN_CALIFICACION) : "",
      etapas: equipo.etapas || [],
      encontrado: Boolean(info),
      estado: info?.estado || "",
      estadoGeneral: info?.estadoGeneral || "",
      seccion: info?.seccion || "",
      observaciones: info?.observaciones || "",
      origenFecha: info?.origenFecha || null,
    };
  });
}

export function buildFormato3Document(filas, { producto, procesoTexto: proceso, codigo, empresa, planta, logo } = {}) {
  const tabla = new Table({
    width: { size: ANCHO_TABLA, type: WidthType.DXA },
    columnWidths: ANCHOS,
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: BORDES_TABLA,
    rows: [...filasCabecera(), ...filas.map(filaEquipo)],
  });

  const titulo = new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: "FORMATO 3: VERIFICACIÓN DE LA CALIFICACIÓN DE EQUIPOS.",
        font: "Arial Black",
        size: 20,
        bold: true,
      }),
    ],
  });

  const leyenda = new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: "CO: Calificación de operación/ CD: Calificación de desempeño",
        font: FUENTE,
        size: TAM,
      }),
    ],
  });

  const criterios = new Paragraph({
    spacing: { before: 240 },
    children: [
      new TextRun({
        text: "Cumple criterios de aceptación: (SI/NO): ______, en caso de NO refiera No. de desviación:",
        font: FUENTE,
        size: TAM,
      }),
    ],
  });

  const encabezado = encabezadoYPie({
    ancho: ANCHO_UTIL,
    producto: producto || "",
    procesoTexto: proceso || "VERIFICACIÓN DE LA CALIFICACIÓN DE EQUIPOS",
    codigo,
    empresa,
    planta,
    logo: logo || logoPorDefecto(),
  });

  return new Document({
    styles: { default: { document: { run: { font: FUENTE, size: TAM } } } },
    sections: [
      {
        properties: {
          page: {
            margin: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
            size: { width: A4_ANCHO, height: A4_ALTO },
          },
        },
        ...encabezado,
        children: [titulo, leyenda, tabla, criterios],
      },
    ],
  });
}

export async function exportFormato3ToWord(filas, opciones = {}) {
  const doc = buildFormato3Document(filas, opciones);
  const blob = await Packer.toBlob(doc);

  const nombre = (opciones.producto || "EQUIPOS").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nombre}_FORMATO_3.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
