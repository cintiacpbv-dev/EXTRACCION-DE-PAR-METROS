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

// El visto bueno se escribe como "ü" en Wingdings, que es como lo pone la
// macro de los otros formatos de la empresa (ver exportExcel.js). Un carácter
// "✓" de Arial no está en todas las instalaciones y sale como cuadrito.
const VISTO = "ü";
const FUENTE_VISTO = "Wingdings";
const SIN_CALIFICACION = "-";

// Ancho de la tabla de "Revisado por / Fecha" del formato original.
const ANCHOS_FIRMA = [1754, 3486, 997, 3256];

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

function parrafo(texto, { negrita = false, centrado = true, fuente = FUENTE } = {}) {
  return new Paragraph({
    alignment: centrado ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: 240, lineRule: "auto" },
    children: [new TextRun({ text: texto ?? "", font: fuente, size: TAM, bold: negrita })],
  });
}

function celda(
  texto,
  ancho,
  { negrita = false, centrado = true, fondo = null, rowSpan, columnSpan, fuente = FUENTE } = {}
) {
  return new TableCell({
    width: { size: ancho, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    rowSpan,
    columnSpan,
    shading: fondo ? { type: ShadingType.CLEAR, color: "auto", fill: fondo } : undefined,
    children: [parrafo(texto, { negrita, centrado, fuente })],
  });
}

/**
 * La casilla CO o CD. Tres estados, y ninguno se confunde con otro:
 *
 *   conforme   el cronograma dice que esa calificación está CALIFICADA -> visto
 *   sin        el equipo no tiene esa calificación                     -> guion
 *   pendiente  la tiene, pero no conforme (NO CUMPLE, inoperativa...)  -> vacía
 *
 * La casilla vacía es deliberada: no se puede dar por buena una calificación
 * que el cronograma no da por buena, ni marcarla con un guion, que aquí
 * significa otra cosa. Queda en blanco para que quien firma la mire.
 */
function celdaVisto(estado, ancho) {
  if (estado === "conforme") return celda(VISTO, ancho, { fuente: FUENTE_VISTO });
  return celda(estado === "sin" ? SIN_CALIFICACION : "", ancho);
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
      celdaVisto(fila.co, ANCHOS[5]),
      celdaVisto(fila.cd, ANCHOS[6]),
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
/**
 * En qué estado queda la casilla CO o CD de un equipo. Sin ficha en el
 * cronograma no se afirma nada: queda pendiente, para mirarla a mano.
 */
function estadoCasilla(info, sufijo) {
  if (!info) return "pendiente";
  if (info[`conforme${sufijo}`]) return "conforme";
  return info[`tiene${sufijo}`] ? "pendiente" : "sin";
}

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
      co: estadoCasilla(info, "Co"),
      cd: estadoCasilla(info, "Cd"),
      etapas: equipo.etapas || [],
      encontrado: Boolean(info),
      estado: info?.estado || "",
      estadoGeneral: info?.estadoGeneral || "",
      seccion: info?.seccion || "",
      observaciones: info?.observaciones || "",
      oqEstado: info?.oqEstado || "",
      pqEstado: info?.pqEstado || "",
      origenFecha: info?.origenFecha || null,
    };
  });
}

/**
 * Lo que hay que observar de estos equipos, dicho por el propio cronograma.
 *
 * No se redacta nada: se copia la observación que el cronograma ya tiene
 * escrita para los equipos que no están conformes, y se nombra al equipo al
 * que pertenece. Los que no tienen ficha se listan aparte, porque ahí no hay
 * observación que copiar sino un dato que buscar a mano.
 */
function lineasObservaciones(filas) {
  const lineas = [];

  for (const f of filas) {
    if (!f.encontrado) {
      lineas.push(`${f.codigoMif || f.codigoSap} — ${f.descripcion}: no figura en el cronograma de calificación; completar a mano.`);
      continue;
    }

    // "pendiente" en un equipo con ficha significa que esa calificación
    // existe pero el cronograma no la da por conforme; el motivo es lo que
    // dice su estado ("NO CUMPLE", "INOPERATIVO", "VENCIDO").
    const problemas = [];
    if (f.co === "pendiente") problemas.push(`CO: ${f.oqEstado || "sin conformidad"}`);
    if (f.cd === "pendiente") problemas.push(`CD: ${f.pqEstado || "sin conformidad"}`);
    if (problemas.length === 0) continue;

    const obs = f.observaciones ? ` ${f.observaciones}` : "";
    lineas.push(`${f.codigoMif || f.codigoSap} — ${f.descripcion}: ${problemas.join(", ")}.${obs}`);
  }

  return lineas;
}

/**
 * El apartado de observaciones: primero lo que el cronograma ya señala, y
 * después renglones en blanco para escribir a mano lo que se vea durante la
 * verificación. Sin nada que señalar quedan sólo los renglones.
 */
function bloqueObservaciones(filas) {
  const lineas = lineasObservaciones(filas);

  const parrafos = [
    new Paragraph({
      spacing: { before: 240, after: 80 },
      children: [new TextRun({ text: "Observaciones:", font: FUENTE, size: TAM, bold: true })],
    }),
  ];

  for (const linea of lineas) {
    parrafos.push(
      new Paragraph({
        spacing: { before: 0, after: 40 },
        bullet: { level: 0 },
        children: [new TextRun({ text: linea, font: FUENTE, size: TAM })],
      })
    );
  }

  // Renglones para escribir a mano. Son pocos a propósito: el formato entra
  // en una hoja y llenarla de rayas la empujaría a una segunda.
  //
  // Van como filas de una tabla y no como párrafos subrayados: Word funde en
  // una sola raya los párrafos seguidos que llevan el mismo borde, así que
  // dos renglones en blanco se veían como uno.
  parrafos.push(renglonesEnBlanco(lineas.length > 0 ? 2 : 4));

  return parrafos;
}

/** Una tabla sin bordes salvo la raya de cada renglón, para escribir a mano. */
function renglonesEnBlanco(cuantos) {
  const linea = { style: BorderStyle.SINGLE, size: 4, space: 0, color: "auto" };
  const nada = { style: BorderStyle.NONE, size: 0, space: 0, color: "auto" };

  return new Table({
    width: { size: ANCHO_TABLA, type: WidthType.DXA },
    columnWidths: [ANCHO_TABLA],
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: Object.fromEntries(
      ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((l) => [l, nada])
    ),
    rows: Array.from({ length: cuantos }, () =>
      new TableRow({
        height: { value: 300, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: ANCHO_TABLA, type: WidthType.DXA },
            borders: { top: nada, left: nada, right: nada, bottom: linea },
            children: [parrafo("")],
          }),
        ],
      })
    ),
  });
}

/** "Revisado por: ____ Fecha: ____", como cierra el formato original. */
function tablaFirma() {
  const linea = { style: BorderStyle.SINGLE, size: 4, space: 0, color: "auto" };
  const nada = { style: BorderStyle.NONE, size: 0, space: 0, color: "auto" };

  const rotulo = (texto, ancho) =>
    new TableCell({
      width: { size: ancho, type: WidthType.DXA },
      borders: { top: nada, left: nada, right: nada, bottom: nada },
      children: [parrafo(texto, { centrado: false })],
    });

  const hueco = (ancho) =>
    new TableCell({
      width: { size: ancho, type: WidthType.DXA },
      borders: { top: nada, left: nada, right: nada, bottom: linea },
      children: [parrafo("")],
    });

  return new Table({
    width: { size: ANCHOS_FIRMA.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: ANCHOS_FIRMA,
    layout: TableLayoutType.FIXED,
    borders: Object.fromEntries(
      ["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((l) => [l, nada])
    ),
    rows: [
      new TableRow({
        children: [
          rotulo("Revisado por:", ANCHOS_FIRMA[0]),
          hueco(ANCHOS_FIRMA[1]),
          rotulo("Fecha:", ANCHOS_FIRMA[2]),
          hueco(ANCHOS_FIRMA[3]),
        ],
      }),
    ],
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

  // Va debajo del cuadro, no encima: se lee después de ver las columnas CO y
  // CD, que es cuando hace falta saber qué significan.
  const leyenda = new Paragraph({
    spacing: { before: 120, after: 0 },
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
        children: [
          titulo,
          tabla,
          leyenda,
          criterios,
          ...bloqueObservaciones(filas),
          new Paragraph({ spacing: { before: 240 }, children: [] }),
          tablaFirma(),
        ],
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
