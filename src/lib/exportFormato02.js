// FORMATO 02: VERIFICACIÓN DEL PROCESO DE MANUFACTURA.
//
// Es el cuadro que se lleva a planta durante la corrida: por cada etapa, sus
// condiciones de sala y, debajo, la secuencia de operaciones del protocolo
// con los parámetros que hay que verificar en cada una. Copia el formato de
// la empresa —siete columnas: el parámetro partido en dos, el modo de
// verificación, el rango, y las tres de ejecución (Resultado, Verificado,
// Cumple S/N)—.
//
// Qué pone cada columna y de dónde sale:
//
//   Parámetro · Modo de verificación · Rango   del protocolo (o del propio
//                                              Formato 9 en blanco).
//   Resultado                                  del registro de manufactura,
//                                              cuando se pudo emparejar.
//   Verificado                                 en blanco: es la firma de
//                                              quien verifica, y no la pone
//                                              un programa.
//   Cumple (S/N)                               S o N comparando el resultado
//                                              con el rango; en blanco cuando
//                                              el criterio no es numérico.
//
// Lo que no se pudo emparejar sale en blanco, que es como el formato nace y
// como se llena a mano en planta. Ninguna casilla se rellena por parecido.

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
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
import { evaluarValor } from "./rango.js";
import { resumenDeCobertura } from "./protocolo/emparejar.js";

const FUENTE = "Arial";
const TAM = 16;
const TAM_CAB = 16;
const AZUL_CABECERA = "C6D9F1";
const GRIS_BANDA = "D9D9D9";
const AMARILLO_FUERA = "FFFF00";

const A4_ANCHO = 11907;
const A4_ALTO = 16840;
const MARGEN = 850;
// Apaisado: el ancho de la hoja es el lado largo del A4.
const ANCHO_UTIL = A4_ALTO - MARGEN * 2;

// Las siete columnas, en veinteavos de punto, sumando exactamente el ancho
// útil. Los dos primeros tramos son el parámetro (grupo y detalle); los tres
// últimos, las casillas que se llenan en planta y por eso van estrechas pero
// legibles. Si la suma pasara del ancho útil, Word saca la tabla por fuera
// del margen derecho y el cuadro deja de imprimirse entero.
const COLS = [2400, 2400, 3600, 2400, 1800, 1300, 1240];

function pagina() {
  return {
    page: {
      // Las medidas van en vertical y la orientación las gira: la librería
      // hace el intercambio ella sola. Pasándolas ya giradas las giraba otra
      // vez, y salía una hoja vertical rotulada como apaisada.
      size: { width: A4_ANCHO, height: A4_ALTO, orientation: PageOrientation.LANDSCAPE },
      margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN },
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

function celda(texto, { bold, align, fill, width, colSpan, rowSpan, size } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    rowSpan,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: [parrafo(texto, { bold, align, size })],
  });
}

function tabla(anchos, filas) {
  return new Table({
    width: { size: anchos.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: anchos,
    rows: filas,
  });
}

/**
 * La cabecera de cada etapa: sala, personal, condiciones ambientales y las
 * horas de inicio y final.
 *
 * Va en blanco salvo lo que el registro sí sabe. El formato de la empresa la
 * trae así —son casillas para llenar a pie de máquina— y rellenarlas con
 * suposiciones sería justo lo contrario de para lo que sirve el documento.
 */
function cabeceraEtapa(datos) {
  const [a, b, c] = [COLS[0] + COLS[1], COLS[2] + COLS[3], COLS[4] + COLS[5] + COLS[6]];
  const anchos = [a, b, c];
  const par = (rotulo, valor, extra = "") => [
    celda(rotulo, { bold: true, fill: AZUL_CABECERA, width: a }),
    celda(valor, { width: b }),
    celda(extra, { width: c }),
  ];

  return tabla(anchos, [
    new TableRow({ children: par("Sala", datos.sala || "") }),
    new TableRow({ children: par("Personal", datos.personal || "") }),
    new TableRow({
      children: [
        celda("Condiciones ambientales", { bold: true, fill: AZUL_CABECERA, width: a }),
        celda(datos.temperatura ? `Temperatura: ${datos.temperatura}` : "Temperatura:", { width: b }),
        celda(datos.humedad ? `Humedad: ${datos.humedad}` : "Humedad:", { width: c }),
      ],
    }),
    new TableRow({ children: par("Inicio", datos.inicio || "") }),
    new TableRow({ children: par("Final", datos.final || "") }),
  ]);
}

/** El valor tal como se escribe en la casilla de resultado. */
function resultado(param) {
  if (!param) return "";
  const v = param.value;
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** El cuadro de una etapa: una fila por parámetro, en la secuencia del protocolo. */
function cuadroEtapa(emparejado) {
  const total = COLS.reduce((a, b) => a + b, 0);

  const filas = [
    new TableRow({
      tableHeader: true,
      children: [
        celda("Parámetro de Proceso", {
          bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA,
          colSpan: 2, width: COLS[0] + COLS[1], size: TAM_CAB,
        }),
        celda("Modo de verificación", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[2], size: TAM_CAB }),
        celda("Rango de operación", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[3], size: TAM_CAB }),
        celda("Resultado", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[4], size: TAM_CAB }),
        celda("Verificado", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[5], size: TAM_CAB }),
        celda("Cumple (S/N)", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[6], size: TAM_CAB }),
      ],
    }),
  ];

  for (const { fila, param } of emparejado) {
    if (fila.tipo === "banda") {
      filas.push(
        new TableRow({
          children: [celda(fila.titulo, { bold: true, fill: GRIS_BANDA, colSpan: COLS.length, width: total })],
        })
      );
      continue;
    }

    const valor = resultado(param);
    const juicio = valor === "" ? null : evaluarValor(param.value, fila.rango);
    const fuera = juicio === "fuera";

    filas.push(
      new TableRow({
        children: [
          celda(fila.grupo, { width: COLS[0] }),
          celda(fila.detalle, { width: COLS[1] }),
          celda(fila.modo, { width: COLS[2] }),
          celda(fila.rango, { align: AlignmentType.CENTER, width: COLS[3] }),
          celda(valor, {
            align: AlignmentType.CENTER,
            width: COLS[4],
            fill: fuera ? AMARILLO_FUERA : undefined,
            bold: fuera,
          }),
          // "Verificado" es una firma: se deja para la persona.
          celda("", { width: COLS[5] }),
          celda(juicio === "dentro" ? "S" : fuera ? "N" : "", {
            align: AlignmentType.CENTER,
            width: COLS[6],
            fill: fuera ? AMARILLO_FUERA : undefined,
            bold: fuera,
          }),
        ],
      })
    );
  }

  return tabla(COLS, filas);
}

/**
 * Arma el Formato 02 con las etapas ya resueltas.
 *
 * Cada etapa llega con sus filas y el resultado que le corresponde a cada una
 * (`emparejado`), venga de emparejar el protocolo con los registros o de leer
 * sólo los registros. Este archivo no decide de dónde sale nada: sólo lo
 * maqueta, y así el mismo documento sirve para los tres casos —protocolo
 * solo, registros solos, o los dos—.
 */
export function construirFormato02({ etapas, producto = "", lote = "", corrida = "", opciones = {} }) {
  const hijos = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
      children: [new TextRun({ text: "FORMATO 02: VERIFICACIÓN DEL PROCESO DE MANUFACTURA.", font: FUENTE, size: 22, bold: true })],
    }),
    parrafo(`Producto: ${producto || "_____________________"}`),
    parrafo(`Lote: ${lote || "_____________________"}     Corrida: ${corrida || "___________"}`),
  ];

  const cobertura = { total: 0, conResultado: 0 };

  etapas.forEach((etapa, i) => {
    const emparejado = etapa.emparejado || [];
    const r = resumenDeCobertura(emparejado);
    cobertura.total += r.total;
    cobertura.conResultado += r.conResultado;

    hijos.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: i > 0,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: `Etapa de ${etapa.etapa}`, font: FUENTE, size: 20, bold: true })],
      })
    );
    hijos.push(cabeceraEtapa(etapa.cabecera || {}));
    hijos.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    hijos.push(cuadroEtapa(emparejado));
  });

  const datosEncabezado = {
    titulo: ["VERIFICACIÓN DEL PROCESO DE MANUFACTURA", producto || ""],
    codigo: opciones.codigo,
    empresa: opciones.empresa,
    planta: opciones.planta,
    logo: opciones.logo || logoPorDefecto(),
  };

  const doc = new Document({
    styles: { default: { document: { run: { font: FUENTE, size: TAM } } } },
    sections: [{ properties: pagina(), ...encabezadoYPie({ ancho: ANCHO_UTIL, ...datosEncabezado }), children: hijos }],
  });

  return { doc, cobertura };
}

export async function exportarFormato02(datos) {
  const { doc, cobertura } = construirFormato02(datos);
  const blob = await Packer.toBlob(doc);

  // Sin producto que nombrar, el archivo se llama sólo "FORMATO_02": pegarle
  // el nombre por defecto delante daba "FORMATO_02_FORMATO_02.docx".
  const nombre = String(datos.producto || "").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre ? `${nombre}_FORMATO_02.docx` : "FORMATO_02.docx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return cobertura;
}
