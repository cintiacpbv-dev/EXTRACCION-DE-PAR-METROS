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
/**
 * "Temperatura: (15 °C – 30 °C) 20.3" — el rango que exige el formato y la
 * lectura que trae el registro, en ese orden.
 *
 * El rango va aunque no haya lectura: es la especificación de la sala, y es
 * lo que el formato en blanco lleva impreso para que quien lo llene sepa
 * contra qué compara.
 */
function ambiental(rotulo, lectura, rango) {
  const partes = [`${rotulo}:`];
  if (rango) partes.push(`(${rango})`);
  if (lectura) partes.push(lectura);
  return partes.join(" ");
}

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
        celda(ambiental("Temperatura", datos.temperatura, datos.temperaturaRango), { width: b }),
        celda(ambiental("Humedad", datos.humedad, datos.humedadRango), { width: c }),
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
/**
 * Una tabla del documento de origen, copiada tal cual: el esquema de
 * muestreo de la etapa, o el recuadro de "Observaciones:".
 *
 * Se reparte el ancho útil entre las columnas de la rejilla y se respetan
 * las celdas combinadas, que es lo único que hace falta para que la tabla se
 * vea como en el papel. No se interpreta nada de su contenido: cada producto
 * tiene su muestreo, y una lectura "inteligente" acabaría inventando
 * ensayos.
 */
function tablaCopiada(filas) {
  const columnas = Math.max(1, ...filas.map((f) => f.total || f.celdas.length));
  const ancho = Math.floor(COLS.reduce((a, b) => a + b, 0) / columnas);
  const anchos = Array(columnas).fill(ancho);
  // El sobrante del redondeo va a la última columna, o el borde derecho de la
  // tabla queda desalineado con el del cuadro de arriba.
  anchos[columnas - 1] += COLS.reduce((a, b) => a + b, 0) - ancho * columnas;

  return tabla(
    anchos,
    filas.map((f, i) =>
      new TableRow({
        children: f.celdas.map((c) =>
          celda(c.texto, {
            bold: i === 0,
            fill: i === 0 ? AZUL_CABECERA : undefined,
            colSpan: c.ancho > 1 ? c.ancho : undefined,
            width: ancho * (c.ancho || 1),
          })
        ),
      })
    )
  );
}

/** El recuadro de observaciones que cierra cada etapa en el formato de la empresa. */
function recuadroObservaciones() {
  const total = COLS.reduce((a, b) => a + b, 0);
  return tabla(
    [total],
    [
      new TableRow({ children: [celda("Observaciones:", { bold: true, fill: AZUL_CABECERA, width: total })] }),
      new TableRow({ height: { value: 900, rule: "atLeast" }, children: [celda("", { width: total })] }),
    ]
  );
}

/**
 * El resumen de fechas del final: una fila por etapa, con el día y la hora en
 * que empezó y en que terminó.
 *
 * Sale de la misma cabecera que ya se calculó para cada etapa, así que dice
 * exactamente lo mismo que las tablas de arriba; la etapa cuyo registro no se
 * cargó va en blanco.
 */
function resumenDeFechas(etapas) {
  const anchos = [4600, 2700, 2700, 2700, 2440];
  const parte = (valor, cual) => {
    const m = String(valor || "").match(/^(\S+)(?:\s+(\S+))?/);
    if (!m) return "";
    return cual === "fecha" ? m[1] : m[2] || "";
  };

  const filas = [
    new TableRow({
      tableHeader: true,
      children: ["Etapa", "Fecha inicial", "Hora inicial", "Fecha final", "Hora final"].map((t, i) =>
        celda(t, { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: anchos[i] })
      ),
    }),
  ];

  for (const e of etapas) {
    const c = e.cabecera || {};
    filas.push(
      new TableRow({
        children: [
          celda(e.etapa, { width: anchos[0] }),
          celda(parte(c.inicio, "fecha"), { align: AlignmentType.CENTER, width: anchos[1] }),
          celda(parte(c.inicio, "hora"), { align: AlignmentType.CENTER, width: anchos[2] }),
          celda(parte(c.final, "fecha"), { align: AlignmentType.CENTER, width: anchos[3] }),
          celda(parte(c.final, "hora"), { align: AlignmentType.CENTER, width: anchos[4] }),
        ],
      })
    );
  }

  return tabla(anchos, filas);
}

/** Quién lo hizo y quién lo revisó, con su fecha. Se firma a mano. */
function bloqueFirmas() {
  const anchos = [3000, 5570, 2000, 4570];
  const fila = (rotulo) =>
    new TableRow({
      height: { value: 500, rule: "atLeast" },
      children: [
        celda(rotulo, { bold: true, fill: AZUL_CABECERA, width: anchos[0] }),
        celda("", { width: anchos[1] }),
        celda("Fecha:", { bold: true, fill: AZUL_CABECERA, width: anchos[2] }),
        celda("", { width: anchos[3] }),
      ],
    });
  return tabla(anchos, [fila("Realizado por:"), fila("Revisado por:")]);
}

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
    hijos.push(cabeceraEtapa({ ...(etapa.cabecera || {}), ...(etapa.cabeceraFormato || {}) }));
    hijos.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    hijos.push(cuadroEtapa(emparejado));

    // El recuadro de observaciones cierra cada etapa, como en el formato de
    // la empresa: es donde se anota a mano lo que no cabe en una casilla.
    hijos.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    hijos.push(recuadroObservaciones());

    // Y detrás, lo que el documento de origen tuviera para esta etapa: su
    // esquema de muestreo, sus atributos de calidad. Copiado tal cual.
    for (const anexo of etapa.anexos || []) {
      hijos.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      hijos.push(tablaCopiada(anexo));
    }
  });

  // El cierre del formato: el resumen de fechas de todas las etapas y las
  // firmas.
  hijos.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      pageBreakBefore: true,
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text: "Tiempo de las etapas", font: FUENTE, size: 20, bold: true })],
    })
  );
  hijos.push(resumenDeFechas(etapas));
  hijos.push(new Paragraph({ spacing: { after: 240 }, children: [] }));
  hijos.push(bloqueFirmas());

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
