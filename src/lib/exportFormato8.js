// FORMATO 8: VERIFICACIÓN DE LA CALIFICACIÓN DEL PERSONAL.
//
// Una fila por persona y rol, con la fecha en que se calificó para ese rol.
// Quien fabrica y además inspecciona sale dos veces, con el nombre combinado
// en vertical: es como está hecho el formato de la empresa.
//
// La casilla de la fecha sale en amarillo cuando esa calificación ya venció.
// Las columnas "SI/NO" se quedan en blanco a propósito: la verificación la
// firma una persona, y el amarillo está para decirle dónde mirar, no para
// decidir por ella.

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
  VerticalMergeType,
  WidthType,
} from "docx";
import { encabezadoYPie } from "./exportEncabezado.js";
import { logoPorDefecto } from "./logoEmpresa.js";
import { vigenciaDe } from "./personal.js";

const FUENTE = "Arial";
const TAM = 16;
const AZUL_CABECERA = "C6D9F1";
const AMARILLO_VENCIDA = "FFFF00";

const A4_ANCHO = 11907;
const A4_ALTO = 16840;
// Los márgenes del Formato 8 de la empresa.
const MARGEN = { top: 1417, right: 1701, bottom: 993, left: 1701 };
const ANCHO_UTIL = A4_ANCHO - MARGEN.left - MARGEN.right;

// Las seis columnas del formato de la empresa, con sus proporciones y sumando
// el ancho útil.
const COLS_BASE = [2342, 2043, 1027, 892, 880, 1321];

// Y las siete de cuando hay registros cargados: la misma tabla con una
// columna más al final, "Intervino en el lote". Es una columna añadida y va
// rotulada como tal; sin registros que cruzar, el cuadro sale con las seis de
// siempre.
const COLS_CON_LOTE = [1950, 1700, 950, 700, 700, 1200, 1305];

function pagina() {
  return { page: { size: { width: A4_ANCHO, height: A4_ALTO }, margin: MARGEN } };
}

function parrafo(texto, { bold, align, size = TAM } = {}) {
  return new Paragraph({
    alignment: align,
    spacing: { before: 20, after: 20 },
    children: [new TextRun({ text: String(texto ?? ""), font: FUENTE, size, bold })],
  });
}

function celda(texto, { bold, align, fill, width, colSpan, rowSpan, merge } = {}) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    rowSpan,
    verticalMerge: merge,
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

/**
 * Agrupa las filas por persona conservando el orden en que vienen, para que
 * el nombre se pueda combinar en vertical sobre sus roles.
 */
function porPersona(personal) {
  const grupos = [];
  for (const p of personal) {
    const ultimo = grupos[grupos.length - 1];
    // El nombre se combina sobre sus roles, pero no a través de dos
    // secciones: ahí son dos bloques distintos, con su franja de por medio.
    if (ultimo && ultimo.nombre === p.nombre && ultimo.seccion === p.seccion) ultimo.roles.push(p);
    else grupos.push({ nombre: p.nombre, seccion: p.seccion, roles: [p] });
  }
  return grupos;
}

/**
 * Qué se escribe en "Intervino en el lote".
 *
 * Tres respuestas, porque son tres cosas distintas: hizo este trabajo, estuvo
 * en el lote pero en otra operación, o no aparece firmando nada.
 */
function marcaDeLote(p) {
  if (p.intervinoEnElRol) return "Sí, en esta etapa";
  if (p.intervino) return "Sí, en otra etapa";
  return "—";
}

function cuadroPersonal(personal, opciones) {
  const conLote = personal.some((p) => p.usuario !== undefined);
  const COLS = conLote ? COLS_CON_LOTE : COLS_BASE;
  // Con varias secciones en el mismo cuadro hace falta decir de cuál es cada
  // bloque: dos personas del mismo nombre y rol en secciones distintas son dos
  // calificaciones distintas. Se separan con una franja y no con una columna
  // más, que estrecharía las seis del formato de la empresa.
  const varias = new Set(personal.map((p) => p.seccion).filter(Boolean)).size > 1;
  const cabecera = [
    new TableRow({
      tableHeader: true,
      children: [
        celda("Nombre del personal", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[0], merge: VerticalMergeType.RESTART }),
        celda("Etapa donde interviene", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[1], merge: VerticalMergeType.RESTART }),
        celda("Fecha", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[2], merge: VerticalMergeType.RESTART }),
        celda("Verificar", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, colSpan: 2, width: COLS[3] + COLS[4] }),
        celda("Verificado por / Fecha", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[5], merge: VerticalMergeType.RESTART }),
        ...(conLote
          ? [celda("Intervino en el lote", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[6], merge: VerticalMergeType.RESTART })]
          : []),
      ],
    }),
    new TableRow({
      tableHeader: true,
      children: [
        celda("", { width: COLS[0], merge: VerticalMergeType.CONTINUE }),
        celda("", { width: COLS[1], merge: VerticalMergeType.CONTINUE }),
        celda("", { width: COLS[2], merge: VerticalMergeType.CONTINUE }),
        celda("SI", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[3] }),
        celda("NO", { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: COLS[4] }),
        celda("", { width: COLS[5], merge: VerticalMergeType.CONTINUE }),
        ...(conLote ? [celda("", { width: COLS[6], merge: VerticalMergeType.CONTINUE })] : []),
      ],
    }),
  ];

  const filas = [...cabecera];
  const anchoTotal = COLS.reduce((a, b) => a + b, 0);
  let seccionEscrita = null;

  for (const grupo of porPersona(personal)) {
    if (varias && grupo.roles[0]?.seccion !== seccionEscrita) {
      seccionEscrita = grupo.roles[0]?.seccion;
      filas.push(
        new TableRow({
          children: [
            celda(`Sección: ${seccionEscrita}`, {
              bold: true,
              fill: AZUL_CABECERA,
              colSpan: COLS.length,
              width: anchoTotal,
            }),
          ],
        })
      );
    }

    grupo.roles.forEach((p, i) => {
      const v = vigenciaDe(p, opciones);
      const vencida = v.estado === "vencida";
      filas.push(
        new TableRow({
          children: [
            // El nombre se escribe una vez y se combina hacia abajo sobre sus
            // roles, como en el formato de la empresa.
            celda(i === 0 ? p.nombre : "", {
              width: COLS[0],
              merge: i === 0 ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE,
            }),
            celda(p.rol, { width: COLS[1] }),
            celda(p.fecha || "sin fecha", {
              align: AlignmentType.CENTER,
              width: COLS[2],
              fill: vencida ? AMARILLO_VENCIDA : undefined,
              bold: vencida,
            }),
            // "Verificar" lo marca quien firma: el amarillo señala dónde
            // mirar, no responde por ella.
            celda("", { width: COLS[3] }),
            celda("", { width: COLS[4] }),
            celda("", { width: COLS[5] }),
            ...(conLote
              ? [
                  celda(marcaDeLote(p), {
                    align: AlignmentType.CENTER,
                    width: COLS[6],
                    bold: p.intervinoEnElRol,
                  }),
                ]
              : []),
          ],
        })
      );
    });
  }

  return tabla(COLS, filas);
}

/**
 * Lo que el cruce con el registro deja dicho, debajo del cuadro.
 *
 * Se escribe sólo cuando hay registros cargados y sólo con lo que se puede
 * sostener: quién hizo un trabajo cuya calificación para ese rol no estaba
 * vigente, y quién firmó el registro sin figurar en esta sección del
 * consolidado. Lo segundo NO dice que esa gente no esté calificada —los
 * supervisores suelen ser de otra sección— sino que aquí no consta, que es
 * distinto y es lo que hay que ir a comprobar.
 */
function hallazgos({ personal, sinConsolidado, anios, hoy }) {
  const conLote = personal.some((p) => p.usuario !== undefined);
  if (!conLote) return [];

  const enSuRol = personal.filter((p) => p.intervinoEnElRol);
  const sinRespaldo = enSuRol.filter((p) => vigenciaDe(p, { anios, hoy }).estado !== "vigente");

  const lineas = [];
  lineas.push(
    parrafo(
      `Del personal listado, ${new Set(enSuRol.map((p) => p.nombre)).size} persona(s) intervino en el lote ` +
        `en la etapa de su rol, en ${enSuRol.length} rol(es).`
    )
  );

  if (sinRespaldo.length > 0) {
    lineas.push(
      parrafo(
        `De esos, ${sinRespaldo.length} rol(es) se ejecutaron sin calificación vigente: ` +
          sinRespaldo.map((p) => `${p.nombre} (${p.rol}, ${p.fecha || "sin fecha de calificación"})`).join("; ") +
          ".",
        { bold: true }
      )
    );
  }

  if ((sinConsolidado || []).length > 0) {
    lineas.push(
      parrafo(
        `Firmaron el registro y no figuran en esta sección del consolidado: ${sinConsolidado.join(", ")}. ` +
          "Puede tratarse de personal de otra sección —los supervisores a menudo lo son—: lo que aquí consta " +
          "es que no están en esta hoja, no que no estén calificados."
      )
    );
  }

  lineas.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
  return lineas;
}

/** El bloque de firma del final. */
function bloqueFirma() {
  const anchos = [1580, 2970, 775, 3180];
  return tabla(anchos, [
    new TableRow({
      height: { value: 500, rule: "atLeast" },
      children: [
        celda("Revisado por:", { bold: true, fill: AZUL_CABECERA, width: anchos[0] }),
        celda("", { width: anchos[1] }),
        celda("Fecha:", { bold: true, fill: AZUL_CABECERA, width: anchos[2] }),
        celda("", { width: anchos[3] }),
      ],
    }),
  ]);
}

/**
 * Arma el Formato 8 con el personal ya elegido (sección y roles) y la regla
 * de vigencia que se esté usando.
 */
export function construirFormato8({ personal = [], sinConsolidado = [], secciones = [], producto = "", lote = "", anios, hoy, opciones = {} }) {
  const seccion = secciones.join(", ");
  const hijos = [
    new Paragraph({
      spacing: { after: 160 },
      children: [
        new TextRun({ text: "FORMATO 8: VERIFICACIÓN DE LA CALIFICACIÓN DEL PERSONAL.", font: FUENTE, size: 22, bold: true }),
      ],
    }),
    parrafo(`${secciones.length > 1 ? "Secciones" : "Sección"}: ${seccion || "_____________________"}`),
    parrafo(`Producto: ${producto || "_____________________"}`),
    parrafo(`Lote: ${lote || "_____________________"}`),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
    cuadroPersonal(personal, { anios, hoy }),
    new Paragraph({ spacing: { before: 200, after: 200 }, children: [] }),
    ...hallazgos({ personal, sinConsolidado, anios, hoy }),
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
          titulo: ["VERIFICACIÓN DE LA CALIFICACIÓN DEL PERSONAL", producto || seccion || ""],
          codigo: opciones.codigo,
          empresa: opciones.empresa,
          planta: opciones.planta,
          logo: opciones.logo || logoPorDefecto(),
        }),
        children: hijos,
      },
    ],
  });

  const vencidas = personal.filter((p) => vigenciaDe(p, { anios, hoy }).estado === "vencida").length;
  const sinFecha = personal.filter((p) => vigenciaDe(p, { anios, hoy }).estado === "sin-fecha").length;
  return { doc, resumen: { filas: personal.length, vencidas, sinFecha } };
}

export async function exportarFormato8(datos) {
  const { doc, resumen } = construirFormato8(datos);
  const blob = await Packer.toBlob(doc);

  const nombre = String(datos.producto || datos.seccion || "").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre ? `${nombre}_FORMATO_8.docx` : "FORMATO_8.docx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return resumen;
}
