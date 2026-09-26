// El documento de la Evaluación de Criticidad y Riesgo, en Word para el
// expediente y en Excel para seguir trabajando la matriz.
//
// Sigue el formato vigente de Validaciones (Modelo.Formato_Evaluacion_
// Criticidad_Riesgo), sección por sección y con sus palabras: A Información
// general, la secuencia de la evaluación, B Declaración de gap, C Equipo,
// D Etapas, Paso 1 (1a atributos, 1b severidad), Paso 2 causa–efecto, Paso 3
// clasificación final (3.1 y 3.2), Paso 4 FMEA (4.1), Paso 5 vínculo
// estadístico (5.1), E Reevaluación, F Resumen de resultados, G Aprobaciones
// y el anexo de definiciones. Así se puede firmar tal cual.
//
// Cada parámetro lleva su N° del Paso 2 en todo el documento —y en el RMD
// coloreado con los V°B°—, en el orden del proceso (ver criticidad/orden.js).

import {
  AlignmentType,
  Document,
  PageOrientation,
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
import ExcelJS from "exceljs";
import { encabezadoYPie } from "./exportEncabezado.js";
import { logoPorDefecto } from "./logoEmpresa.js";
import {
  CLAVE,
  CRITICO,
  NO_CLAVE,
  muestraPorAtributo,
  nivelDeNpr,
  npr,
  requisitoEstadistico,
} from "./criticidad/modelo.js";
import { ESTADOS, FORMATO, MOTIVOS_DE_REVISION, NOTA_DE_PROCEDENCIA } from "./criticidad/textos.js";
import { formaDelProducto, verificacionDeReferencia } from "./criticidad/puntoDePartida.js";
import { citaDeEvaluacion, numerar, ordenDeProceso } from "./criticidad/orden.js";

const FUENTE = "Arial";
const TAM = 14;
const TAM_TITULO = 22;
const AZUL_CABECERA = "C6D9F1";
const AMARILLO_CRITICO = "FFFF00";
// Los colores del NPR, los mismos que nombra el procedimiento.
const COLOR_NPR = { VERDE: "C6EFCE", AMARILLO: "FFEB9C", ROJO: "FFC7CE" };
const GRIS_REGLA = "F2F2F2";

// A4 apaisada: los cuadros del Paso 2 y del Paso 4 tienen siete columnas y
// sus justificaciones son frases. En vertical no se leen.
const A4_ANCHO = 11907;
const A4_ALTO = 16840;
const MARGEN = { top: 993, right: 993, bottom: 993, left: 993 };
const ANCHO_UTIL = A4_ALTO - MARGEN.left - MARGEN.right; // apaisada: el largo manda

export const TODOS_LOS_PASOS = [0, 1, 2, 3, 4, 5, 6];

function parrafo(texto, { bold, align, size = TAM, italic, espacio } = {}) {
  return new Paragraph({
    alignment: align,
    spacing: { before: espacio ? 160 : 20, after: espacio ? 80 : 20 },
    children: [new TextRun({ text: String(texto ?? ""), font: FUENTE, size, bold, italics: italic })],
  });
}

/** Una regla del procedimiento, en su recuadro gris: se lee como lo que es. */
function regla(texto) {
  return new Table({
    width: { size: ANCHO_UTIL, type: WidthType.DXA },
    columnWidths: [ANCHO_UTIL],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: ANCHO_UTIL, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: GRIS_REGLA },
            children: [parrafo(texto, { size: 13, italic: true })],
          }),
        ],
      }),
    ],
  });
}

function celda(contenido, { bold, align, fill, width, colSpan } = {}) {
  const lineas = Array.isArray(contenido) ? contenido : [contenido];
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: lineas.map((l) => (typeof l === "object" && l !== null ? l : parrafo(l, { bold, align }))),
  });
}

/**
 * Un cuadro con su cabecera azul.
 *
 * `anchos` se dan en proporción y se reescalan para sumar exactamente el
 * ancho útil: una tabla que asoma fuera del margen se imprime cortada, y con
 * siete columnas es fácil pasarse sin darse cuenta.
 */
function cuadro(cabeceras, filas, proporciones, { vacio } = {}) {
  const suma = proporciones.reduce((a, b) => a + b, 0);
  const anchos = proporciones.map((p) => Math.round((p / suma) * ANCHO_UTIL));
  anchos[anchos.length - 1] += ANCHO_UTIL - anchos.reduce((a, b) => a + b, 0);

  const cuerpo = filas.map((f) =>
    // Una fila de grupo ("ETAPA: Fabricación", la operación unitaria) ocupa
    // todo el ancho, como en el formato.
    f && !Array.isArray(f) && f.grupo !== undefined
      ? new TableRow({
          children: [celda(f.grupo, { colSpan: cabeceras.length, width: ANCHO_UTIL, fill: f.fill, bold: f.bold })],
        })
      : new TableRow({
          children: f.map((c, i) => celda(c?.texto ?? c, { width: anchos[i], fill: c?.fill, align: c?.align })),
        })
  );

  if (cuerpo.length === 0 && vacio) {
    cuerpo.push(
      new TableRow({
        children: [celda(vacio, { colSpan: cabeceras.length, align: AlignmentType.CENTER, width: ANCHO_UTIL })],
      })
    );
  }

  return new Table({
    width: { size: ANCHO_UTIL, type: WidthType.DXA },
    columnWidths: anchos,
    rows: [
      new TableRow({
        tableHeader: true,
        children: cabeceras.map((t, i) =>
          celda(String(t).split("\n"), { bold: true, align: AlignmentType.CENTER, fill: AZUL_CABECERA, width: anchos[i] })
        ),
      }),
      ...cuerpo,
    ],
  });
}

/**
 * La respuesta a la pregunta de desempeño de proceso, para el cuadro.
 *
 * Es la que decide entre Clave y No Clave, así que tiene que constar junto a
 * la clasificación: un «No Clave» sin decir que se contestó que NO parece un
 * hueco, y es al revés — es el resultado correcto y esperado.
 */
export function respuestaDeDesempeno(fila) {
  if (fila.clasificacion === CRITICO) return "No aplica (Crítico por severidad)";
  const respuesta = fila.desempeno === true ? "Sí" : fila.desempeno === false ? "No" : "Sin responder";
  const marca = fila.desempenoRevisado ? " (revisada)" : "";
  return fila.desempenoMotivo ? `${respuesta}${marca} — ${fila.desempenoMotivo}` : `${respuesta}${marca}`;
}

/** Lo que se escribe en la columna «Estado» del Paso 2, con las palabras del procedimiento. */
export function estadoDe(fila) {
  return fila.sospecha ? ESTADOS.candidato : ESTADOS.sinSospecha;
}

/** Y de dónde salió esa sospecha, que es lo que hay que poder revisar. */
export function fuenteDe(fila) {
  if (fila.fuenteSospecha === "protocolo") {
    return fila.acopladoCon
      ? `Análisis de riesgo del protocolo (racional compartido con «${fila.acopladoCon}»)`
      : "Análisis de riesgo del protocolo";
  }
  if (fila.fuenteSospecha === "IA+bibliografía") {
    return `Propuesta por IA, respaldada por${fila.referencias ? `: ${fila.referencias}` : " la bibliografía"}`;
  }
  if (fila.fuenteSospecha === "bibliografía") return `Bibliografía — ${fila.referencias || "sin referencia"}`;
  if (fila.fuenteSospecha === "IA") return "Propuesta por IA — revisar";
  return "Sin resolver";
}

/**
 * Lo que dijo la corroboración (Consulta PDF + segunda lectura de la IA) de
 * un parámetro del análisis de riesgo. Cadena vacía si no se corroboró.
 */
export function corroboracionDe(fila) {
  const c = fila.corroboracion;
  if (!c) return "";
  const cita = c.referencias ? ` Fuente: ${c.referencias}.` : "";
  const motivo = c.motivo ? ` ${c.motivo.replace(/\.?$/, ".")}` : "";
  if (c.estado === "revisar") {
    const cambios = [
      c.faltan.length ? `añadir ${c.faltan.join(", ")}` : "",
      c.sobran.length ? `quitar ${c.sobran.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    const cabeza = fila.vinculoRevisado ? `Sugerencia aplicada (${cambios}).` : `Para revisar: se sugiere ${cambios}.`;
    return `${cabeza}${motivo}${cita}`;
  }
  // Un parámetro acoplado a otro al que se le aceptó una sugerencia: su
  // vínculo cambió con el del grupo, y eso tiene que constar.
  if (fila.vinculoRevisado) {
    return `Vínculo ajustado junto con su grupo acoplado (mismo racional), al aceptar una sugerencia sobre ese mecanismo.${cita}`;
  }
  if (c.estado === "coincide") {
    return c.referencias ? `Corroborado con la bibliografía.${cita}` : "Corroborado por la IA (sin cita en la bibliografía).";
  }
  return "Sin revisar.";
}

/** Y lo mismo de una severidad. */
export function corroboracionDeSeveridad(c, actual) {
  if (!c) return "Sin información en la bibliografía.";
  const cita = c.referencias ? ` Fuente: ${c.referencias}.` : "";
  const motivo = c.motivo ? ` ${c.motivo.replace(/\.?$/, ".")}` : "";
  if (c.severidadSugerida && c.severidadSugerida !== actual) {
    return `Para revisar: la segunda lectura sugiere severidad ${c.severidadSugerida}.${motivo}${cita}`;
  }
  return `${c.conEvidencia ? "Propuesta con evidencia de la bibliografía." : "Coincide."}${motivo}${cita}`;
}

/** Paso 6 — qué parámetros conviene revisar cuando haya data histórica. */
export function paraRevisarConDataHistorica(filas) {
  const salida = [];
  for (const f of filas) {
    if (f.clasificacion !== CRITICO) continue;
    if (!f.criterios?.length) {
      salida.push({ id: f.id, parametro: f.magnitud, etapa: f.etapa, motivo: MOTIVOS_DE_REVISION.sinCriterio });
      continue;
    }
    if (f.fuenteSospecha === "IA") {
      salida.push({ id: f.id, parametro: f.magnitud, etapa: f.etapa, motivo: MOTIVOS_DE_REVISION.sinRespaldo });
    }
  }
  return salida;
}

// --- las piezas del formato ------------------------------------------------

const AZUL_BANDA = "1F3A5F";
const CELESTE_BANDA = "DCE6F1";
const GRIS_ETIQUETA = "F2F2F2";

/** "PCP", "CLAVE", "NO CLAVE": las palabras del formato. */
export function etiquetaDeClasificacion(c) {
  if (c === CRITICO) return "PCP";
  if (c === CLAVE) return "CLAVE";
  if (c === NO_CLAVE) return "NO CLAVE";
  return "PENDIENTE";
}

const marca = (si) => (si ? "☒" : "☐");

function texto(t, { bold, size = TAM, color, italic } = {}) {
  return new TextRun({ text: String(t ?? ""), font: FUENTE, size, bold, color, italics: italic });
}

/**
 * La banda que abre cada sección del formato: la letra o el paso en un
 * recuadro oscuro, y a su lado el título y la frase que explica para qué es.
 */
function banda(etiqueta, tituloBanda, subtitulo) {
  const izq = Math.round(ANCHO_UTIL * 0.11);
  const der = ANCHO_UTIL - izq;
  return new Table({
    width: { size: ANCHO_UTIL, type: WidthType.DXA },
    columnWidths: [izq, der],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: izq, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: AZUL_BANDA },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [texto(etiqueta, { bold: true, size: 20, color: "FFFFFF" })] })],
          }),
          new TableCell({
            width: { size: der, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: CELESTE_BANDA },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({ spacing: { before: 40, after: subtitulo ? 0 : 40 }, children: [texto(tituloBanda, { bold: true, size: 20, color: AZUL_BANDA })] }),
              ...(subtitulo ? [new Paragraph({ spacing: { after: 40 }, children: [texto(subtitulo, { size: 13, italic: true })] })] : []),
            ],
          }),
        ],
      }),
    ],
  });
}

const separacion = () => new Paragraph({ spacing: { before: 60, after: 60 }, children: [] });
const subtituloDeSeccion = (t) => parrafo(t, { bold: true, espacio: true, size: 16 });
const resultado = (t) => parrafo(t, { bold: true, size: 14, espacio: true });

/** Un cuadro de dos columnas etiqueta / valor, con la etiqueta en gris. */
function cuadroDeDatos(pares) {
  const anchos = [0.18, 0.32, 0.18, 0.32].map((p) => Math.round(p * ANCHO_UTIL));
  anchos[3] += ANCHO_UTIL - anchos.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: ANCHO_UTIL, type: WidthType.DXA },
    columnWidths: anchos,
    rows: pares.map((fila) => {
      const celdas = [];
      if (fila.length === 2) {
        celdas.push(celda(fila[0], { bold: true, fill: GRIS_ETIQUETA, width: anchos[0] }));
        celdas.push(celda(fila[1], { width: anchos[1] + anchos[2] + anchos[3], colSpan: 3 }));
      } else {
        fila.forEach((t, i) => celdas.push(celda(t, { bold: i % 2 === 0, fill: i % 2 === 0 ? GRIS_ETIQUETA : undefined, width: anchos[i] })));
      }
      return new TableRow({ children: celdas });
    }),
  });
}

/** Un recuadro de una sola celda con varias líneas (conclusión, gap…). */
function recuadro(lineas, { fill } = {}) {
  return new Table({
    width: { size: ANCHO_UTIL, type: WidthType.DXA },
    columnWidths: [ANCHO_UTIL],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: ANCHO_UTIL, type: WidthType.DXA },
            shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
            children: lineas.map((l) =>
              typeof l === "string"
                ? parrafo(l)
                : new Paragraph({ spacing: { before: 20, after: 20 }, children: l.map((x) => (typeof x === "string" ? texto(x) : texto(x.t, x))) })
            ),
          }),
        ],
      }),
    ],
  });
}

const porcentaje = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}` : "—");

// --- A · información general y secuencia -----------------------------------

function seccionA({ producto, forma, lote, documento = {}, etapas = [] }) {
  const d = documento;
  const tipo = FORMATO.tiposDeValidacion.map((t) => `${marca(d.tipoValidacion === t)} ${t}`).join("   ");
  return [
    banda("A", "INFORMACIÓN GENERAL"),
    separacion(),
    cuadroDeDatos([
      ["Producto", producto || "", "Código de producto", d.codigoProducto || ""],
      ["Forma farmacéutica", forma || d.forma || "", "Concentración / presentación", d.concentracion || ""],
      ["Planta / Sección", d.planta || "", "N° de documento de riesgo", d.numeroDocumento || ""],
      ["Protocolo de validación asociado", d.protocoloAsociado || "", "Fecha de elaboración", d.fechaElaboracion || new Date().toLocaleDateString("es-PE")],
      ["Tamaño de lote", d.tamanoLote || "", "Tipo de validación", tipo],
      ["Documentos fuente", d.documentosFuente || (lote ? `Lote ${lote}` : "")],
    ]),
    ...(etapas.length ? [] : []),
  ];
}

function secuencia({ atributos, severidades, filas, fmeaFilas, etapas }) {
  const acc = severidades.filter((s) => s.severidad >= 4).length;
  const candidatos = filas.filter((f) => f.sospecha).length;
  const pcp = filas.filter((f) => f.clasificacion === CRITICO).length;
  const claves = filas.filter((f) => f.clasificacion === CLAVE).length;
  const noClaves = filas.filter((f) => f.clasificacion === NO_CLAVE).length;
  const pendientes = filas.filter((f) => !f.clasificacion).length;
  const colores = { ROJO: 0, AMARILLO: 0, VERDE: 0 };
  for (const g of fmeaFilas) {
    const c = nivelDeNpr(g.npr)?.color;
    if (c) colores[c] += g.parametros.length;
  }
  const entra = [
    `${atributos.length} atributos evaluados`,
    `${filas.length} parámetros en ${etapas.length} etapa(s)`,
    "Estado + severidad",
    `${pcp} PCP en ${fmeaFilas.length} fila(s)`,
    `${severidades.length} atributos`,
  ];
  const sale = [
    `${acc} ACC (S = 4–5)`,
    `${candidatos} candidatos a PCP · ${filas.length - candidatos} sin sospecha`,
    `${pcp} PCP · ${claves} Clave · ${noClaves} No clave${pendientes ? ` · ${pendientes} pendientes` : ""}`,
    `${colores.ROJO} rojo · ${colores.AMARILLO} amarillo · ${colores.VERDE} verde`,
    "Confianza / cobertura para el muestreo",
  ];
  return [
    subtituloDeSeccion("Secuencia de la evaluación"),
    cuadro(
      FORMATO.secuencia.map((s) => `${s.paso}\n${s.nombre}`),
      [entra.map((t) => `Entra: ${t}`), sale.map((t) => `Resultado: ${t}`)],
      [1, 1, 1, 1, 1]
    ),
    parrafo(FORMATO.alCierre, { size: 13, italic: true }),
  ];
}

// --- B, C, D ------------------------------------------------------------------

function seccionB(documento = {}) {
  const elegida = Number.isInteger(documento.situacionGap) ? documento.situacionGap : 0;
  return [
    banda("B", "DECLARACIÓN DE GAP", "Indica sobre qué base se clasifican los parámetros cuando no hay datos de diseño de proceso (Stage 1)"),
    separacion(),
    recuadro([
      [{ t: "Situación del producto: ", bold: true }],
      ...FORMATO.situacionesGap.map((s, i) => [
        `${marca(i === elegida)} ${s}${i === 2 ? `: ${i === elegida && documento.referenciaDiseno ? documento.referenciaDiseno : "________________"}` : ""}`,
      ]),
      [{ t: "Declaración: ", bold: true }, documento.declaracionGap || FORMATO.declaracionGap],
    ]),
  ];
}

function seccionC(documento = {}) {
  const equipo = documento.equipo?.length ? documento.equipo : FORMATO.areasDelEquipo.map((area) => ({ area }));
  return [
    banda("C", "EQUIPO MULTIDISCIPLINARIO", "Registrar a los responsables reales que participaron en la evaluación"),
    separacion(),
    cuadro(["Área", "Nombre", "Cargo", "Firma"], equipo.map((e) => [e.area || "", e.nombre || "", e.cargo || "", ""]), [3, 3.5, 3, 2.5]),
  ];
}

function seccionD(etapas = []) {
  return [
    banda("D", "DESCRIPCIÓN DEL PROCESO — ETAPAS", "Base para organizar los parámetros del Paso 2 por etapa y operación unitaria"),
    separacion(),
    cuadro(
      ["N°", "Etapa", "Operación(es) unitaria(s)", "Equipos / áreas / sistemas asociados"],
      etapas.map((e, i) => [
        { texto: String(i + 1), align: AlignmentType.CENTER },
        e.etapa,
        (e.operaciones || []).join("; ") || "—",
        (e.equipos || []).join("; ") || "—",
      ]),
      [0.6, 2.4, 5, 4],
      { vacio: "Sin etapas reconocidas." }
    ),
  ];
}

// --- PASO 1 ------------------------------------------------------------------

function fuenteDelAtributo(a) {
  if (a.origen === "especificación") return "Especificación (CoA)";
  if (a.origen === "análisis de riesgo") return "Análisis de riesgo del protocolo";
  if (a.origen === "protocolo") return "Protocolo";
  return `En proceso (${(a.etapas || [a.etapa]).filter(Boolean).join(", ") || "registro"})`;
}

function paso1a(atributos) {
  return [
    banda("PASO 1", "IDENTIFICACIÓN DE ATRIBUTOS CRÍTICOS DE CALIDAD", "1a. Lista de atributos de calidad"),
    separacion(),
    cuadro(
      ["N°", "Atributo de calidad", "Especificación", "Norma técnica", "Fuente"],
      atributos.map((a, i) => [
        { texto: String(i + 1), align: AlignmentType.CENTER },
        a.nombre,
        a.especificacion || a.criterios?.join(" ; ") || "Sin especificación en la fuente",
        { texto: a.norma || "—", align: AlignmentType.CENTER },
        fuenteDelAtributo(a),
      ]),
      [0.6, 3.4, 4, 1.4, 2.6],
      { vacio: "No se reconoció ningún atributo de calidad." }
    ),
  ];
}

function paso1b(severidades, corroboracion) {
  const acc = severidades.filter((s) => s.severidad >= 4).length;
  return [
    banda("PASO 1b", "SEVERIDAD POR ATRIBUTO DE CALIDAD", "Se fija UNA sola vez por atributo, independiente del parámetro que pueda causar la falla. Los Pasos 3 y 4 reutilizan este valor."),
    separacion(),
    parrafo("Matriz de apoyo: Severidad × Incertidumbre", { bold: true, espacio: true }),
    cuadro(
      ["", "Tipo de impacto si el atributo falla", "Incertidumbre BAJA", "Incertidumbre ALTA"],
      FORMATO.matrizSeveridad.map((m) => [
        { texto: m.letra, align: AlignmentType.CENTER },
        m.impacto,
        { texto: String(m.baja), align: AlignmentType.CENTER },
        { texto: String(m.alta), align: AlignmentType.CENTER },
      ]),
      [0.6, 7.4, 2, 2]
    ),
    parrafo("Preguntas guía para confirmar el nivel", { bold: true, espacio: true }),
    cuadro(["Nivel", "Pregunta guía"], Object.entries(FORMATO.preguntasGuia).map(([n, q]) => [{ texto: `Nivel ${n}`, align: AlignmentType.CENTER }, q]), [1.4, 10.6]),
    parrafo("Registro de severidad por atributo", { bold: true, espacio: true }),
    cuadro(
      ["N°", "Atributo de calidad (del 1a)", "Tipo de vínculo (A–E)", "Incertidumbre (Baja / Alta)", "Otros factores", "Pregunta guía (nivel)", "SEVERIDAD (1–5)", "Decisión", "Justificación"],
      severidades.map((s, i) => {
        const c = corroboracion?.[s.atributo];
        const extra = c?.referencias ? ` Bibliografía: ${c.referencias}.` : "";
        const revisar = c?.severidadSugerida && c.severidadSugerida !== s.severidad ? ` Segunda lectura: sugiere ${c.severidadSugerida}.` : "";
        return [
          { texto: String(i + 1), align: AlignmentType.CENTER },
          s.atributo,
          { texto: s.tipoVinculo || "—", align: AlignmentType.CENTER },
          { texto: s.incertidumbre || "—", align: AlignmentType.CENTER },
          s.otrosFactores || "—",
          { texto: String(s.severidad), align: AlignmentType.CENTER },
          { texto: String(s.severidad), align: AlignmentType.CENTER, fill: s.severidad >= 4 ? AMARILLO_CRITICO : undefined },
          { texto: s.severidad >= 4 ? "ACC" : "No ACC", align: AlignmentType.CENTER },
          `${s.justificacion || "—"}${s.origen === "revisada" ? " (Revisada.)" : ""}${extra}${revisar}`,
        ];
      }),
      [0.5, 2.6, 1, 1.1, 1.8, 0.9, 1, 1, 4.1],
      { vacio: "Sin severidades asignadas." }
    ),
    parrafo(FORMATO.notaNoAcc, { size: 13, italic: true }),
    resultado(`Resultado: ${acc} atributos críticos de calidad (ACC) y ${severidades.length - acc} atributos de calidad no críticos.`),
  ];
}

// --- PASO 2 y PASO 3 ------------------------------------------------------------

/** Los grupos etapa → operación, con sus filas numeradas, en orden de proceso. */
function gruposDeProceso(filas, numeros) {
  const salida = [];
  for (const f of ordenDeProceso(filas)) {
    let e = salida[salida.length - 1];
    if (!e || e.etapa !== f.etapa) {
      e = { etapa: f.etapa, operaciones: [] };
      salida.push(e);
    }
    const op = f.seccion || "General";
    let o = e.operaciones[e.operaciones.length - 1];
    if (!o || o.operacion !== op) {
      o = { operacion: op, filas: [] };
      e.operaciones.push(o);
    }
    o.filas.push({ ...f, n: numeros.get(f.id) });
  }
  return salida;
}

function codigoDeOrigen(f) {
  if (f.codigoOrigen) return f.codigoOrigen;
  if (f.fuenteSospecha === "protocolo") return "CP";
  if (f.fuenteSospecha === "bibliografía") return "L";
  if (f.fuenteSospecha === "IA+bibliografía") return "L / M";
  if (f.fuenteSospecha === "IA") return "M";
  return "—";
}

function paso2(filas, numeros) {
  const cabeceras = ["N°", "Parámetro de proceso", "Rango de operación", "¿Sospecha?", "Atributo vinculado", "Origen", "Análisis de riesgo", "Estado"];
  const proporciones = [0.5, 2.2, 1.8, 0.8, 1.9, 0.7, 4.3, 1.3];
  const cuerpo = [];
  for (const e of gruposDeProceso(filas, numeros)) {
    cuerpo.push({ grupo: `ETAPA: ${e.etapa}`, fill: CELESTE_BANDA, bold: true });
    for (const o of e.operaciones) {
      if (e.operaciones.length > 1 || o.operacion !== "General") cuerpo.push({ grupo: o.operacion, fill: GRIS_ETIQUETA });
      for (const f of o.filas) {
        const corrob = corroboracionDe(f);
        cuerpo.push([
          { texto: String(f.n ?? ""), align: AlignmentType.CENTER },
          f.magnitud,
          f.criterios?.join(" ; ") || "—",
          { texto: f.sospecha ? "Sí" : "No", align: AlignmentType.CENTER },
          f.afecta?.join("; ") || "No aplica",
          { texto: codigoDeOrigen(f), align: AlignmentType.CENTER },
          `${f.racional || "—"}${f.referencias ? ` [${f.referencias}]` : ""}${corrob ? ` — ${corrob}` : ""}`,
          estadoDe(f),
        ]);
      }
    }
  }
  const candidatos = filas.filter((f) => f.sospecha).length;
  const salida = [
    banda("PASO 2", "ANÁLISIS CAUSA–EFECTO (CLASIFICACIÓN PRELIMINAR DE PARÁMETROS)", "Solo identifica si hay sospecha de vínculo con un atributo. Aún no se evalúa severidad, probabilidad ni detectabilidad."),
    separacion(),
    parrafo(FORMATO.redaccionPaso2, { size: 13, italic: true }),
    cuadro(cabeceras, cuerpo, proporciones, { vacio: "Sin parámetros evaluados." }),
    resultado(`Resultado: ${filas.length} parámetros evaluados — ${candidatos} candidatos a PCP y ${filas.length - candidatos} sin sospecha de impacto.`),
  ];

  // Lo que la corroboración señaló y no se aplicó: tiene que quedar escrito
  // por qué se mantuvo el análisis del protocolo.
  const pendientes = filas.filter((f) => f.corroboracion?.estado === "revisar" && !f.vinculoRevisado);
  if (pendientes.length > 0) {
    salida.push(
      parrafo("Discrepancias señaladas por la corroboración (Consulta PDF + IA) y no aplicadas", { bold: true, espacio: true }),
      parrafo("Se mantuvo el vínculo del análisis de riesgo del protocolo. Cada discrepancia debe cerrarse con la justificación del equipo multidisciplinario.", { size: 13 }),
      cuadro(
        ["N°", "Parámetro", "Vínculo del protocolo", "Sugerencia", "Justificación del equipo"],
        pendientes.map((f) => [{ texto: String(numeros.get(f.id) ?? ""), align: AlignmentType.CENTER }, f.magnitud, f.afecta?.join(" / ") || "Ninguno", corroboracionDe(f), ""]),
        [0.6, 3, 2.4, 4.6, 3.4]
      )
    );
  }
  return salida;
}

function justificacionDe(f) {
  const s = f.severidad;
  if (f.clasificacion === CRITICO) {
    return `S${s} → PCP.${f.acopladoCon ? ` Acoplado a «${f.acopladoCon}».` : ""}`;
  }
  const base = f.sospecha ? `S${s ?? "—"} → desempeño` : "Sin sospecha → desempeño";
  if (f.desempeno === null || f.desempeno === undefined) return `${base}: pendiente de responder.`;
  return `${base}${f.desempenoMotivo ? `: ${f.desempenoMotivo}` : f.desempeno ? ": afecta el rendimiento o la duración." : ": sin impacto en rendimiento o duración."}`;
}

function paso3(filas, numeros, { forma }) {
  const conAnterior = filas.some((f) => f.clasificacionAnterior);
  const cabeceras = ["N°", "Parámetro", "Estado (Paso 2)", "Atributo vinculado", "Severidad (Paso 1b)", "¿Impacto en desempeño?"];
  const proporciones = [0.5, 2.6, 1.4, 2.2, 1, 1.1];
  if (conAnterior) {
    cabeceras.push("Clasificación anterior");
    proporciones.push(1.2);
  }
  cabeceras.push("CLASIFICACIÓN FINAL", "Justificación");
  proporciones.push(1.3, 3.3);

  const cuerpo = [];
  for (const e of gruposDeProceso(filas, numeros)) {
    cuerpo.push({ grupo: `ETAPA: ${e.etapa}`, fill: CELESTE_BANDA, bold: true });
    for (const f of e.operaciones.flatMap((o) => o.filas)) {
      const impacto = f.clasificacion === CRITICO ? "N/A" : f.desempeno === true ? "Sí" : f.desempeno === false ? "No" : "Sin responder";
      cuerpo.push([
        { texto: String(f.n ?? ""), align: AlignmentType.CENTER },
        f.magnitud,
        f.sospecha ? "Candidato" : "Sin sospecha",
        f.afecta?.join("; ") || "No aplica",
        { texto: f.severidad === null || f.severidad === undefined ? "—" : String(f.severidad), align: AlignmentType.CENTER },
        { texto: `${impacto}${f.desempenoRevisado ? " (revisada)" : ""}`, align: AlignmentType.CENTER },
        ...(conAnterior ? [{ texto: f.clasificacionAnterior || "—", align: AlignmentType.CENTER }] : []),
        { texto: etiquetaDeClasificacion(f.clasificacion), align: AlignmentType.CENTER, fill: f.clasificacion === CRITICO ? AMARILLO_CRITICO : undefined },
        justificacionDe(f),
      ]);
    }
  }

  const total = filas.length;
  const pcp = filas.filter((f) => f.clasificacion === CRITICO).length;
  const claves = filas.filter((f) => f.clasificacion === CLAVE).length;
  const noClaves = filas.filter((f) => f.clasificacion === NO_CLAVE).length;
  const referencia = verificacionDeReferencia(filas, { forma, numeros, CRITICO });

  return [
    banda("PASO 3", "DETERMINACIÓN DE LA CLASIFICACIÓN FINAL DEL PARÁMETRO", "Se decide con el Estado (Paso 2) y la Severidad del atributo vinculado (Paso 1). La probabilidad y detectabilidad NO deciden la clasificación."),
    separacion(),
    regla(FORMATO.reglaPaso3),
    subtituloDeSeccion("3.1  Registro de la clasificación final"),
    cuadro(cabeceras, cuerpo, proporciones, { vacio: "Sin parámetros evaluados." }),
    resultado(
      `Resultado: ${pcp} PCP (${porcentaje(pcp, total)} %), ${claves} Clave (${porcentaje(claves, total)} %) y ${noClaves} No clave (${porcentaje(noClaves, total)} %) de ${total} parámetros.`
    ),
    subtituloDeSeccion("3.2  Lista de PCP de referencia — verificación para este producto"),
    cuadro(
      ["Etapa de proceso / parámetro de referencia", "Fundamento", "¿Aplica y fue evaluado?"],
      referencia.map((r) => [
        r.parametro,
        r.fundamento,
        r.aplica === "N/A"
          ? "☐ Sí  ☐ No  ☒ N/A"
          : r.aplica === "Sí"
            ? `☒ Sí (parámetro${r.numeros.length > 1 ? "s" : ""} ${citaDeEvaluacion(r.numeros).replace(/^eval\. /, "")})${r.nota ? ` — ${r.nota}` : ""}`
            : `☐ Sí  ☒ No — ${r.nota}`,
      ]),
      [4, 4.5, 3.5]
    ),
  ];
}

// --- PASO 4 ------------------------------------------------------------------

/**
 * Las filas del registro FMEA: los PCP acoplados (misma etapa, mismo racional
 * y mismas O y D) van en una sola fila, como en el formato.
 */
export function filasDeFmea(fmea, numeros) {
  const grupos = new Map();
  for (const f of ordenDeProceso(fmea)) {
    const racional = String(f.racional || "").replace(/\s+/g, " ").trim().toLowerCase();
    const clave = f.acoplado && racional.length >= 25 ? `${f.etapa}|${racional}|${f.probabilidad}|${f.detectabilidad}` : f.id;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(f);
  }
  return [...grupos.values()].map((g) => {
    const primero = g[0];
    const severidad = Math.max(...g.map((f) => f.severidad ?? 0)) || null;
    return {
      etapa: primero.etapa,
      parametros: g,
      nombre: `${g.map((f) => f.magnitud).join(", ")} (${citaDeEvaluacion(g.map((f) => numeros.get(f.id))).replace(/^eval\. /, "")})`,
      acc: [...new Set(g.flatMap((f) => f.afecta || []))].join("; "),
      modoFalla: primero.modoFalla || "",
      severidad,
      probabilidad: primero.probabilidad,
      detectabilidad: primero.detectabilidad,
      npr: npr(severidad, primero.probabilidad, primero.detectabilidad),
      controles: primero.controles || primero.racionalFmea || "",
      accion: primero.accion || "",
      responsable: primero.responsable || "",
    };
  });
}

function paso4(fmeaFilas) {
  const cuenta = { ROJO: 0, AMARILLO: 0, VERDE: 0 };
  for (const g of fmeaFilas) {
    const c = nivelDeNpr(g.npr)?.color;
    if (c) cuenta[c]++;
  }
  return [
    banda("PASO 4", "PRIORIDAD DE RIESGO DE LOS PCP — FMEA", "Solo para los parámetros clasificados como PCP en el Paso 3. La severidad se toma del Paso 1b (no se vuelve a decidir)."),
    separacion(),
    recuadro([[{ t: "Criterio aplicado para esta evaluación. ", bold: true }, FORMATO.criterioFmea]], { fill: GRIS_REGLA }),
    parrafo("", {}),
    cuadro(["Ocurrencia", "Valor", "Historial de desviaciones / NC", "Referencia complementaria"], FORMATO.ocurrencia.map(([n, v, h, r]) => [n, { texto: String(v), align: AlignmentType.CENTER }, h, r]), [2, 0.8, 4, 5.2]),
    parrafo("", {}),
    cuadro(["Detectabilidad", "Valor", "Momento en que se detecta", "Referencia complementaria"], FORMATO.detectabilidad.map(([n, v, m, r]) => [n, { texto: String(v), align: AlignmentType.CENTER }, m, r]), [2.4, 0.8, 4.4, 4.4]),
    parrafo("", {}),
    cuadro(["NPR (S × O × D)", "Nivel", "Interpretación y acción"], FORMATO.npr.map(([r, n, t]) => [{ texto: r, align: AlignmentType.CENTER }, { texto: n, align: AlignmentType.CENTER, fill: COLOR_NPR[n] }, t]), [1.6, 1.4, 9]),
    subtituloDeSeccion("4.1  Registro FMEA de parámetros críticos"),
    cuadro(
      ["N°", "Etapa", "PCP (Paso 3)", "ACC vinculado", "Modo de falla / efecto", "S", "O", "D", "NPR", "Nivel", "Controles actuales", "Acción / estrategia de control", "Responsable"],
      fmeaFilas.map((g, i) => {
        const nivel = nivelDeNpr(g.npr);
        const num = (v) => ({ texto: v === null || v === undefined ? "—" : String(v), align: AlignmentType.CENTER });
        return [
          num(i + 1),
          g.etapa,
          g.nombre,
          g.acc || "—",
          g.modoFalla || "—",
          { texto: String(g.severidad ?? "—"), align: AlignmentType.CENTER, fill: "E7E6E6" },
          num(g.probabilidad),
          num(g.detectabilidad),
          num(g.npr),
          nivel ? { texto: nivel.color.charAt(0) + nivel.color.slice(1).toLowerCase(), align: AlignmentType.CENTER, fill: COLOR_NPR[nivel.color] } : num(null),
          g.controles || "—",
          g.accion || "—",
          g.responsable || "—",
        ];
      }),
      [0.4, 1.1, 2, 1.5, 2, 0.35, 0.35, 0.35, 0.5, 0.8, 1.8, 1.8, 1.1],
      { vacio: "No hay PCP que evaluar." }
    ),
    parrafo(FORMATO.notaFmea, { size: 13, italic: true }),
    resultado(
      fmeaFilas.length
        ? `Resultado: ${cuenta.ROJO} fila(s) en rojo, ${cuenta.AMARILLO} en amarillo y ${cuenta.VERDE} en verde (${fmeaFilas.reduce((a, g) => a + g.parametros.length, 0)} PCP).`
        : "Resultado: no hay PCP; no se requiere FMEA."
    ),
  ];
}

// --- PASO 5 ------------------------------------------------------------------

export function vinculoPorAtributo(severidades, atributos = []) {
  const tipo = new Map(atributos.map((a) => [a.nombre, a.tipoDeDato]));
  return severidades.map((s) => {
    const req = requisitoEstadistico(s.severidad);
    const tipoDeDato = tipo.get(s.atributo) || "Atributo";
    const continuo = tipoDeDato === "Continuo";
    const pc = req ? `${Math.round(req.confianza * 100)} %/${Math.round(req.cobertura * 100)} %` : "";
    return {
      atributo: s.atributo,
      severidad: s.severidad,
      tipoDeDato,
      confianza: req ? `${Math.round(req.confianza * 100)} %` : "—",
      cobertura: req ? `${Math.round(req.cobertura * 100)} %` : "—",
      enfoque: continuo ? "Intervalo de tolerancia (Promedio ± k × DE)" : "Confianza-confiabilidad, 0 defectos",
      n: continuo ? `k según ISO 16269-6 (${pc})` : req ? `n ≈ ${muestraPorAtributo(req.confianza, req.cobertura)}` : "—",
      observaciones: tipo.has(s.atributo) ? "" : "Tipo de dato por confirmar (se tomó como atributo, la opción prudente).",
    };
  });
}

function paso5(severidades, atributos) {
  const filas = vinculoPorAtributo(severidades, atributos);
  return [
    banda("PASO 5", "VÍNCULO ESTADÍSTICO PARA EL ESTUDIO", "Traduce la severidad de cada atributo en la confianza estadística del plan de muestreo del protocolo de validación"),
    separacion(),
    cuadro(
      ["Severidad", "Confianza", "Cobertura", "n aprox. (atributo, 0 defectos)"],
      [
        ["Alta (S = 4, 5)", "99 %", "95 %", `≈ ${muestraPorAtributo(0.99, 0.95)}`],
        ["Media (S = 3)", "95 %", "90 %", `≈ ${muestraPorAtributo(0.95, 0.9)}`],
        ["Baja (S = 1, 2)", "90 %", "90 %", `≈ ${muestraPorAtributo(0.9, 0.9)}`],
      ].map((f) => f.map((t, i) => (i ? { texto: t, align: AlignmentType.CENTER } : t))),
      [3, 3, 3, 3]
    ),
    parrafo("", {}),
    cuadro(["Tipo de dato", "Cómo identificarlo", "Ejemplos"], FORMATO.tiposDeDato, [2, 4, 6]),
    parrafo(FORMATO.notaPaso5, { size: 13, italic: true }),
    subtituloDeSeccion("5.1  Registro del vínculo estadístico por atributo"),
    cuadro(
      ["N°", "Atributo de calidad", "Severidad (Paso 1b)", "Tipo de dato", "Confianza", "Cobertura", "Enfoque estadístico", "n / factor k", "Observaciones"],
      filas.map((f, i) => [
        { texto: String(i + 1), align: AlignmentType.CENTER },
        f.atributo,
        { texto: String(f.severidad), align: AlignmentType.CENTER },
        f.tipoDeDato,
        { texto: f.confianza, align: AlignmentType.CENTER },
        { texto: f.cobertura, align: AlignmentType.CENTER },
        f.enfoque,
        f.n,
        f.observaciones,
      ]),
      [0.5, 2.6, 1, 1.1, 0.9, 0.9, 2.2, 1.6, 2.2],
      { vacio: "Sin atributos con severidad asignada." }
    ),
  ];
}

// --- E, F, G y anexo ----------------------------------------------------------

const EVIDENCIA = {
  sinCriterio: "Rango de operación o criterio de aceptación documentado en el RMD o en el protocolo.",
  sinRespaldo: "Referencia bibliográfica o datos históricos del parámetro frente al atributo vinculado.",
};

function seccionE(filas, fmeaFilas, numeros) {
  // Con su N° del Paso 2: dos operaciones pueden tener un parámetro con el
  // mismo nombre ("Velocidad de agitación"), y sin el número no se sabe cuál.
  const aRevisar = paraRevisarConDataHistorica(ordenDeProceso(filas)).map((r) => [
    `${r.parametro} (${numeros.get(r.id) ?? "—"}; ${r.etapa})`,
    r.motivo,
    r.motivo === MOTIVOS_DE_REVISION.sinCriterio ? EVIDENCIA.sinCriterio : EVIDENCIA.sinRespaldo,
  ]);
  if (fmeaFilas.length) {
    aRevisar.unshift([
      "Ocurrencia de todos los PCP",
      "Asignada de forma provisional por el ancho del rango, sin historial de desviaciones.",
      "Historial de desviaciones y no conformidades del producto y de la línea del último año.",
    ]);
  }
  return [
    banda("E", "REEVALUACIÓN DEL ANÁLISIS DE RIESGO", "Evita que la evaluación quede congelada: el análisis se actualiza cada vez que aparecen desviaciones u observaciones en la secuencia de validación"),
    separacion(),
    cuadro(["Disparador de reevaluación", "Responsable", "Acción", "Fecha / registro"], FORMATO.disparadores.map((d) => [...d, ""]), [4, 2.2, 4, 1.8]),
    subtituloDeSeccion("Parámetros a revisar con datos históricos"),
    cuadro(
      ["Parámetro", "¿Por qué es sensible? (clasificación conservadora por falta de datos)", "¿Qué evidencia confirmaría o cambiaría su clasificación?"],
      aRevisar,
      [3.4, 4.3, 4.3],
      { vacio: "Ninguno: todos los PCP tienen criterio impreso y respaldo." }
    ),
  ];
}

function seccionF({ severidades, filas, fmeaFilas, documento = {} }) {
  const total = filas.length;
  const acc = severidades.filter((s) => s.severidad >= 4).length;
  const candidatos = filas.filter((f) => f.sospecha).length;
  const pcp = filas.filter((f) => f.clasificacion === CRITICO).length;
  const claves = filas.filter((f) => f.clasificacion === CLAVE).length;
  const noClaves = filas.filter((f) => f.clasificacion === NO_CLAVE).length;
  const colores = { ROJO: 0, AMARILLO: 0, VERDE: 0 };
  for (const g of fmeaFilas) {
    const c = nivelDeNpr(g.npr)?.color;
    if (c) colores[c] += g.parametros.length;
  }
  const conclusion = colores.ROJO ? 2 : colores.AMARILLO ? 1 : pcp ? 0 : -1;
  const c = (t) => ({ texto: String(t), align: AlignmentType.CENTER });
  return [
    banda("F", "RESUMEN DE RESULTADOS"),
    separacion(),
    cuadro(
      ["Atributos y parámetros", "N°", "%", "Clasificación y riesgo", "N°", "%"],
      [
        ["Atributos de calidad evaluados (Paso 1)", c(severidades.length), c("100"), "PCP (Paso 3)", c(pcp), c(porcentaje(pcp, total))],
        ["Atributos críticos — ACC (S = 4–5)", c(acc), c(porcentaje(acc, severidades.length)), "Clave (Paso 3)", c(claves), c(porcentaje(claves, total))],
        ["Parámetros de proceso evaluados (Paso 2)", c(total), c("100"), "No clave (Paso 3)", c(noClaves), c(porcentaje(noClaves, total))],
        ["Candidatos a PCP (Paso 2)", c(candidatos), c(porcentaje(candidatos, total)), "NPR rojo (Paso 4)", c(colores.ROJO), c(porcentaje(colores.ROJO, pcp))],
        ["Sin sospecha de impacto (Paso 2)", c(total - candidatos), c(porcentaje(total - candidatos, total)), "NPR amarillo (Paso 4)", c(colores.AMARILLO), c(porcentaje(colores.AMARILLO, pcp))],
        ["", "", "", "NPR verde (Paso 4)", c(colores.VERDE), c(porcentaje(colores.VERDE, pcp))],
      ],
      [4, 1, 1, 4, 1, 1]
    ),
    parrafo("Los % de PCP, Clave y No clave son sobre el total de parámetros; los de NPR, sobre el total de PCP.", { size: 12, italic: true }),
    separacion(),
    recuadro([
      [{ t: "Conclusión:", bold: true }],
      ...FORMATO.conclusiones.map((t, i) => [`${marca(i === conclusion)} ${t}`]),
      [{ t: "Comentarios: ", bold: true }, documento.comentarios || ""],
    ]),
  ];
}

function seccionG(documento = {}) {
  const firmas = FORMATO.aprobaciones.map((rol, i) => ({ rol, ...(documento.aprobaciones?.[i] || {}) }));
  return [
    banda("G", "APROBACIONES"),
    separacion(),
    cuadro(["", "Nombre", "Cargo / área", "Firma", "Fecha"], firmas.map((f) => [f.rol, f.nombre || "", f.cargo || "", "", ""]), [2.2, 3, 3, 2, 1.8]),
  ];
}

function anexo() {
  return [
    banda("ANEXO", "DEFINICIONES"),
    separacion(),
    cuadro(["Término", "Definición"], FORMATO.definiciones.map(([a, b]) => [a, b]), [3, 9]),
  ];
}

// --- el documento entero ----------------------------------------------------

/**
 * La evaluación, en el orden del formato de Validaciones:
 *   A Información general · Secuencia · B Gap · C Equipo · D Etapas ·
 *   Paso 1 (1a atributos, 1b severidad) · Paso 2 · Paso 3 (3.1, 3.2) ·
 *   Paso 4 (4.1) · Paso 5 (5.1) · E Reevaluación · F Resumen · G Aprobaciones ·
 *   Anexo Definiciones.
 *
 * `pasos` permite emitirla por partes con la numeración interna 0-6:
 * 0 = A-D y 1a, 1 = 1b, 2-5 = los Pasos 2 a 5, 6 = E. F, G y el anexo van
 * siempre: sin ellos el documento no se puede firmar.
 */
export function construirCriticidad({
  producto = "",
  forma = "",
  lote = "",
  etapas = [],
  atributos = [],
  severidades = [],
  corroboracionSeveridad = null,
  filas = [],
  fmea = [],
  documento = {},
  pasos = TODOS_LOS_PASOS,
  opciones = {},
}) {
  const incluye = (n) => pasos.includes(n);
  const numeros = numerar(filas);
  const fmeaFilas = filasDeFmea(fmea, numeros);

  const hijos = [
    new Paragraph({
      spacing: { after: 120 },
      children: [texto(`EVALUACIÓN DE CRITICIDAD Y RIESGO${producto ? ` — ${producto}` : ""}`, { bold: true, size: TAM_TITULO })],
    }),
  ];

  const bloques = [];
  if (incluye(0)) {
    bloques.push(
      seccionA({ producto, forma, lote, documento, etapas }),
      secuencia({ atributos, severidades, filas, fmeaFilas, etapas }),
      seccionB(documento),
      seccionC(documento),
      seccionD(etapas),
      paso1a(atributos)
    );
  }
  if (incluye(1)) bloques.push(paso1b(severidades, corroboracionSeveridad));
  if (incluye(2)) bloques.push(paso2(filas, numeros));
  if (incluye(3)) bloques.push(paso3(filas, numeros, { forma: formaDelProducto(forma, producto) }));
  if (incluye(4)) bloques.push(paso4(fmeaFilas));
  if (incluye(5)) bloques.push(paso5(severidades, atributos));
  if (incluye(6)) bloques.push(seccionE(filas, fmeaFilas, numeros));
  bloques.push(seccionF({ severidades, filas, fmeaFilas, documento }), seccionG(documento), anexo());

  for (const b of bloques) hijos.push(...b, separacion());
  hijos.push(parrafo(NOTA_DE_PROCEDENCIA, { size: 12, italic: true }));

  const doc = new Document({
    styles: { default: { document: { run: { font: FUENTE, size: TAM } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_ANCHO, height: A4_ALTO, orientation: PageOrientation.LANDSCAPE },
            margin: MARGEN,
          },
        },
        ...encabezadoYPie({
          ancho: ANCHO_UTIL,
          titulo: ["EVALUACIÓN DE CRITICIDAD Y RIESGO", producto || ""],
          codigo: opciones.codigo,
          empresa: opciones.empresa,
          planta: opciones.planta,
          logo: opciones.logo || logoPorDefecto(),
        }),
        children: hijos,
      },
    ],
  });

  return { doc, numeros, fmeaFilas };
}

/**
 * El nombre del producto, apto para un nombre de archivo.
 *
 * Las tildes se quitan ANTES de sanear: si no, la «Á» de «CÁPSULA» se
 * cambiaba por un guion bajo y el archivo se llamaba «C_PSULA». Con el
 * producto leído del protocolo —que va con tildes, no abreviado como en el
 * registro— pasaba siempre.
 */
export function nombreDeArchivo(texto, respaldo) {
  const limpio = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return limpio || respaldo;
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportarCriticidadWord(datos) {
  const { doc } = construirCriticidad(datos);
  const blob = await Packer.toBlob(doc);
  const sufijo = (datos.pasos || TODOS_LOS_PASOS).length === TODOS_LOS_PASOS.length ? "" : "_PARCIAL";
  descargar(blob, `${nombreDeArchivo(datos.producto, "EVALUACION")}_CRITICIDAD${sufijo}.docx`);
  return true;
}

// --- Excel ------------------------------------------------------------------

/**
 * Una hoja por cuadro del formato, en su orden: información general,
 * atributos (1a), severidad (1b), causa-efecto (2), clasificación (3), FMEA
 * (4) y muestreo (5).
 */
export function construirLibroCriticidad({
  producto = "", forma = "", lote = "", atributos = [], severidades = [], corroboracionSeveridad = null, filas = [], fmea = [],
  etapas = [], documento = {},
}) {
  const wb = new ExcelJS.Workbook();
  const AZUL = "FFC6D9F1";
  const numeros = numerar(filas);
  const enOrden = ordenDeProceso(filas);

  const hoja = (nombre, cabeceras, anchos, datos, pintar) => {
    const ws = wb.addWorksheet(nombre);
    ws.addRow([`${nombre} — ${producto || "producto sin identificar"}${lote ? ` · lote ${lote}` : ""}`]);
    ws.getRow(1).font = { bold: true, size: 12 };
    ws.addRow([]);
    const cab = ws.addRow(cabeceras);
    cab.font = { bold: true };
    cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    anchos.forEach((a, i) => { ws.getColumn(i + 1).width = a; });
    for (const d of datos) {
      const r = ws.addRow(d);
      r.alignment = { vertical: "top", wrapText: true };
      pintar?.(r, d);
    }
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cabeceras.length } };
    ws.views = [{ state: "frozen", ySplit: 3 }];
    return ws;
  };

  const amarillo = (celda) => {
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  };

  const d = documento;
  hoja("A - Información", ["Campo", "Valor"], [34, 90], [
    ["Producto", producto], ["Código de producto", d.codigoProducto || ""], ["Forma farmacéutica", forma],
    ["Concentración / presentación", d.concentracion || ""], ["Planta / Sección", d.planta || ""],
    ["N° de documento de riesgo", d.numeroDocumento || ""], ["Protocolo de validación asociado", d.protocoloAsociado || ""],
    ["Tamaño de lote", d.tamanoLote || ""], ["Tipo de validación", d.tipoValidacion || ""],
    ["Documentos fuente", d.documentosFuente || ""],
    ...etapas.map((e, i) => [`Etapa ${i + 1}: ${e.etapa}`, [(e.operaciones || []).join("; "), (e.equipos || []).join("; ")].filter(Boolean).join(" — ")]),
  ]);

  hoja("Paso 1a - Atributos", ["N°", "Atributo de calidad", "Especificación", "Norma técnica", "Fuente", "Tipo de dato"],
    [6, 36, 44, 12, 30, 12],
    atributos.map((a, i) => [i + 1, a.nombre, a.especificacion || a.criterios?.join(" ; ") || "", a.norma || "", fuenteDelAtributo(a), a.tipoDeDato || ""]));

  hoja("Paso 1b - Severidad", ["N°", "Atributo", "Tipo de vínculo (A–E)", "Incertidumbre", "Otros factores", "Severidad", "Decisión", "Justificación", "Origen", "Bibliografía y segunda opinión"],
    [6, 34, 12, 13, 26, 10, 10, 60, 16, 60],
    severidades.map((s, i) => [i + 1, s.atributo, s.tipoVinculo || "", s.incertidumbre || "", s.otrosFactores || "", s.severidad,
      s.severidad >= 4 ? "ACC" : "No ACC", s.justificacion || "", s.origen === "revisada" ? "Revisada" : "Propuesta por IA",
      corroboracionSeveridad ? corroboracionDeSeveridad(corroboracionSeveridad[s.atributo], s.severidad) : ""]),
    (r, v) => { if (v[5] >= 4) amarillo(r.getCell(6)); });

  hoja("Paso 2 - Causa-efecto",
    ["N°", "Etapa", "Operación", "Parámetro", "Rango de operación", "¿Sospecha?", "Atributo vinculado", "Origen", "Análisis de riesgo", "Estado", "Fuente", "Corroboración (Consulta PDF + IA)", "Paso(s) del RMD"],
    [6, 16, 26, 28, 24, 10, 26, 8, 60, 22, 34, 60, 14],
    enOrden.map((f) => [numeros.get(f.id), f.etapa, f.seccion, f.magnitud, f.criterios?.join(" ; ") || "", f.sospecha ? "Sí" : "No",
      f.afecta?.join("; ") || "No aplica", codigoDeOrigen(f), f.racional || "", estadoDe(f), fuenteDe(f), corroboracionDe(f),
      (f.pasos || []).join(", ")]));

  hoja("Paso 3 - Clasificación",
    ["N°", "Etapa", "Parámetro", "Estado (Paso 2)", "Atributo vinculado", "Severidad", "¿Impacto en desempeño?", "Clasificación anterior", "CLASIFICACIÓN FINAL", "Justificación"],
    [6, 16, 28, 14, 26, 10, 22, 16, 16, 50],
    enOrden.map((f) => [numeros.get(f.id), f.etapa, f.magnitud, f.sospecha ? "Candidato" : "Sin sospecha", f.afecta?.join("; ") || "No aplica",
      f.severidad ?? "", f.clasificacion === CRITICO ? "N/A" : respuestaDeDesempeno(f), f.clasificacionAnterior || "",
      etiquetaDeClasificacion(f.clasificacion), justificacionDe(f)]),
    (r, v) => { if (v[8] === "PCP") amarillo(r.getCell(9)); });

  const ARGB_NPR = { VERDE: "FFC6EFCE", AMARILLO: "FFFFEB9C", ROJO: "FFFFC7CE" };
  hoja("Paso 4 - FMEA", ["N°", "Etapa", "PCP (Paso 3)", "ACC vinculado", "Modo de falla / efecto", "S", "O", "D", "NPR", "Nivel", "Controles actuales", "Acción / estrategia de control", "Responsable"],
    [6, 16, 34, 26, 36, 6, 6, 6, 8, 12, 40, 40, 18],
    filasDeFmea(fmea, numeros).map((g, i) => {
      const nivel = nivelDeNpr(g.npr);
      return [i + 1, g.etapa, g.nombre, g.acc, g.modoFalla, g.severidad ?? "", g.probabilidad ?? "", g.detectabilidad ?? "", g.npr ?? "",
        nivel ? nivel.color : "", g.controles, g.accion, g.responsable];
    }),
    (r, v) => { if (ARGB_NPR[v[9]]) r.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB_NPR[v[9]] } }; });

  hoja("Paso 5 - Muestreo", ["N°", "Atributo de calidad", "Severidad", "Tipo de dato", "Confianza", "Cobertura", "Enfoque estadístico", "n / factor k", "Observaciones"],
    [6, 36, 10, 12, 11, 11, 40, 30, 40],
    vinculoPorAtributo(severidades, atributos).map((v, i) => [i + 1, v.atributo, v.severidad, v.tipoDeDato, v.confianza, v.cobertura, v.enfoque, v.n, v.observaciones]));

  return wb;
}

export async function exportarCriticidadExcel(datos) {
  const wb = construirLibroCriticidad(datos);
  const buffer = await wb.xlsx.writeBuffer();
  descargar(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${nombreDeArchivo(datos.producto, "EVALUACION")}_CRITICIDAD.xlsx`
  );
  return true;
}
