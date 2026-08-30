// FORMATO 01: el esquema del proceso.
//
// Copia la hoja del formato de la empresa: un marco que encierra el diagrama,
// la fila de pesada arriba —INSUMOS, PESADA, verificación de la orden—, las
// operaciones en columna unidas por flechas, los insumos que entran en cada una
// a su izquierda, los controles en proceso colgando de puntos al margen y la
// leyenda de abreviaturas abajo a la izquierda.
//
// La maquetación es la parte que el registro no puede dictar: dónde va cada
// caja, cuánto mide y por dónde pasa la flecha. Se calcula aquí con una regla
// sencilla —una columna de operaciones y una columna de apoyo— y queda
// editable en Word, que es donde se le da el último retoque.

import { Document, Packer, Paragraph, TextRun } from "docx";
import { cuadro, flecha, lienzo, rotulo } from "./esquema/lienzo.js";
import { inyectarLienzos, marcaDeLienzo } from "./esquema/inyectar.js";
import { ordenarEtapas } from "./esquema/modelo.js";
import { comoElEsquema } from "./esquema/texto.js";
import { encabezadoYPie } from "./exportEncabezado.js";
import { logoPorDefecto } from "./logoEmpresa.js";

const A4_ANCHO = 11907;
const A4_ALTO = 16840;
const MARGEN = 1000;
const ANCHO_UTIL = A4_ANCHO - MARGEN * 2;

// La página en milímetros, que es como se razona la maquetación.
const LIENZO_ANCHO = 166;
const LIENZO_ALTO = 238;

// Las dos columnas: apoyo (insumos, controles, leyenda) y proceso (las
// operaciones). Entre las dos queda el hueco por donde entra la flecha.
const COL_APOYO = { x: 5, ancho: 60 };
const COL_PROCESO = { x: 88, ancho: 68 };

// Alto de un renglón de texto y márgenes internos de las cajas, en mm.
const ALTO_RENGLON = 3.4;
const RELLENO_CAJA = 2.6;
const SEPARACION = 7; // hueco entre dos operaciones, por donde va la flecha

const TAM_TITULO = 15; // medios puntos
const TAM_LINEA = 14;
const TAM_NOTA = 13;

// El rótulo de una operación unitaria: una caja con su nombre a la izquierda,
// sobre las cajas de los pasos que la componen.
const ALTO_ROTULO_GRUPO = 6;
const MARGEN_GRUPO = 4;

// Sitio que se deja libre al pie de la columna izquierda, donde va la leyenda
// de abreviaturas. Va en todas las hojas, así que se reserva en todas: sin
// esto, lo último que se listaba al margen le caía encima.
const RESERVA_PIE = 22;

// La fila de pesada, que encabeza todas las hojas del formato.
const FILA_PESADA = { y: 3, alto: 8 };
const PRIMERA_FILA = FILA_PESADA.y + FILA_PESADA.alto + 5;

// Cuántos caracteres de Arial 7 pt caben en un milímetro de ancho. Medido
// sobre el formato de la empresa: una caja de 62 mm admite unos 46 caracteres.
const CARACTERES_POR_MM = 0.74;

/** Cuántos renglones ocupa un texto dentro de una caja de este ancho. */
function renglones(texto, anchoMm) {
  const porRenglon = Math.max(10, Math.floor((anchoMm - RELLENO_CAJA * 2) * CARACTERES_POR_MM));
  return Math.max(1, Math.ceil(String(texto).length / porRenglon));
}

function altoDeCaja(lineas, ancho) {
  const total = lineas.reduce((n, l) => n + renglones(l.texto, ancho), 0);
  return total * ALTO_RENGLON + RELLENO_CAJA * 2;
}

/** Las líneas de una operación: nombre en negrita, rangos, equipo en cursiva. */
function lineasDeOperacion(op) {
  return [
    { texto: op.titulo, negrita: true, tam: TAM_TITULO },
    ...op.lineas.map((l) => ({ texto: comoElEsquema(l), tam: TAM_LINEA })),
    ...(op.equipo.length > 0
      ? [{ texto: comoElEsquema(op.equipo.join(" + ")), cursiva: true, tam: TAM_LINEA }]
      : []),
  ];
}

/** Lo que entra en una operación, listado al margen izquierdo sin recuadro. */
function lineasDeInsumos(insumos) {
  return insumos.map((i) => ({ texto: `• ${comoElEsquema(i)}`, izquierda: true, tam: TAM_LINEA }));
}

/**
 * Las indicaciones que acompañan a una operación sin ser otra operación:
 * enjuagar el recipiente, incorporar despacio, apagar la agitación. El formato
 * las pone en letra pequeña y sin recuadro junto a la caja.
 */
function lineasDeNotas(notas) {
  return notas.map((n) => ({ texto: comoElEsquema(n), cursiva: true, tam: TAM_NOTA }));
}

// La leyenda de abreviaturas que el formato lleva abajo a la izquierda. Sólo
// nombra las que aparecen: una hoja sin presiones no explica qué es P°.
const ABREVIATURAS = [
  [/^T°/, "T°: Temperatura"],
  [/^t\b/, "t: Tiempo"],
  [/^V\b/, "V: Velocidad"],
  [/^P°/, "P°: Presión"],
];

function leyendaDeHoja(cajas) {
  const textos = cajas.flatMap((c) => c.op.lineas);
  const usadas = ABREVIATURAS.filter(([re]) => textos.some((t) => re.test(t))).map(([, t]) => t);
  if (usadas.length === 0) return [];

  return [
    { texto: "Leyenda:", negrita: true, cursiva: true, izquierda: true, tam: TAM_LINEA },
    ...usadas.map((t) => ({ texto: t, izquierda: true, tam: TAM_LINEA })),
  ];
}

/**
 * Si la etapa necesita que su nombre encabece la hoja.
 *
 * Cuando las operaciones vienen agrupadas —preparar el bulk, preparar la
 * gelatina— el rótulo de cada grupo ya dice dónde se está, que es como lo
 * lleva el formato; sin grupos, el nombre de la etapa hace ese papel.
 */
function necesitaRotuloDeEtapa(esquema) {
  return !esquema.operaciones[0]?.grupo;
}

/**
 * Hasta dónde baja la columna de la izquierda.
 *
 * La leyenda y los controles viven ahí, así que lo que puede estorbarles es lo
 * que se lista al margen, no las cajas de operación: éstas van en la columna de
 * la derecha y pueden llegar hasta abajo sin tocarlas. Mirando el alto de toda
 * la hoja, la última caja se iba a una página nueva ella sola sin necesidad.
 */
function fondoIzquierdo(cajas) {
  return cajas.reduce((n, c) => (c.altoIns > 0 ? Math.max(n, c.y + c.altoIns) : n), 0);
}

/**
 * Reparte una etapa en páginas: las operaciones se apilan hasta llenar el
 * lienzo y lo que no cabe abre otra hoja.
 *
 * `reserva` es el sitio que hay que dejar libre al final de la última hoja
 * para la leyenda y los controles en proceso, que van abajo a la izquierda.
 */
function paginarEtapa(esquema, reserva) {
  const paginas = [];
  let actual = [];
  let y = PRIMERA_FILA + (necesitaRotuloDeEtapa(esquema) ? ALTO_ROTULO_GRUPO + 2 : 0);

  let grupoAbierto = null;

  for (const op of esquema.operaciones) {
    // Al abrir una operación unitaria se deja sitio para su rótulo; al
    // cerrarla, un respiro antes de la caja siguiente.
    if (op.grupo !== grupoAbierto) {
      if (grupoAbierto) y += MARGEN_GRUPO;
      if (op.grupo) y += ALTO_ROTULO_GRUPO + 1;
      grupoAbierto = op.grupo || null;
    }

    const lineas = lineasDeOperacion(op);
    const alto = altoDeCaja(lineas, COL_PROCESO.ancho);

    // Lo que se agrega en esta operación va a su izquierda; la fila mide lo
    // que la más alta de las dos cosas.
    const insumos = op.insumos || [];
    const lineasIns = lineasDeInsumos(insumos);
    const altoIns = insumos.length > 0 ? altoDeCaja(lineasIns, COL_APOYO.ancho) : 0;

    // Las notas van bajo la caja, en el hueco que ya deja la flecha.
    const notas = op.notas || [];
    const lineasNot = lineasDeNotas(notas);
    const altoNot = notas.length > 0 ? altoDeCaja(lineasNot, COL_PROCESO.ancho) - RELLENO_CAJA : 0;
    const altoFila = Math.max(alto + altoNot, altoIns + 3);

    // La columna de la derecha llega casi hasta el marco; la de la izquierda
    // se para antes, porque abajo está la leyenda.
    const cabe = y + altoFila <= LIENZO_ALTO - 6 && y + altoIns <= LIENZO_ALTO - RESERVA_PIE;

    if (!cabe && actual.length > 0) {
      paginas.push(actual);
      actual = [];
      y = PRIMERA_FILA + (op.grupo ? ALTO_ROTULO_GRUPO + 1 : 0);
      grupoAbierto = op.grupo || null;
    }

    actual.push({ op, lineas, alto, y, lineasIns, altoIns, lineasNot, altoNot });
    y += altoFila + SEPARACION;
  }

  if (actual.length > 0) paginas.push(actual);

  // La leyenda y los controles van al pie de la última hoja: si el dibujo
  // llega hasta abajo, la última caja pasa a una hoja nueva en vez de que se
  // le monte el texto encima.
  const ultima = paginas[paginas.length - 1];
  if (ultima && ultima.length > 1 && fondoIzquierdo(ultima) + reserva > LIENZO_ALTO) {
    const caja = ultima.pop();
    caja.y = PRIMERA_FILA + (caja.op.grupo ? ALTO_ROTULO_GRUPO + 1 : 0);
    paginas.push([caja]);
  }

  return paginas;
}

/** Los tramos de cajas que comparten operación unitaria. */
function tramosDeGrupo(cajas) {
  const tramos = [];
  for (const caja of cajas) {
    const grupo = caja.op.grupo;
    if (!grupo) continue;
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.grupo === grupo) ultimo.cajas.push(caja);
    else tramos.push({ grupo, cajas: [caja] });
  }
  return tramos;
}

/** Una caja de rótulo: el nombre de una etapa o de una operación unitaria. */
function cajaRotulo({ id, y, texto }) {
  return cuadro({
    id,
    x: COL_APOYO.x,
    y,
    ancho: Math.min(100, 8 + texto.length * 1.6),
    alto: ALTO_ROTULO_GRUPO,
    lineas: [{ texto, negrita: true, tam: TAM_TITULO }],
    recto: true,
  });
}

/**
 * La fila que encabeza todas las hojas del formato: los insumos llegan a la
 * central de pesada, de ahí a la verificación de la orden, y de ahí baja por
 * el margen izquierdo hasta el proceso.
 */
function filaDePesada(idBase, hastaY) {
  const { y, alto } = FILA_PESADA;
  const medio = y + alto / 2;
  let id = idBase;

  const verificacion = { x: 8, ancho: 40 };
  const pesada = { x: 56, ancho: 38 };
  const insumos = { x: 102, ancho: 22 };

  return [
    cuadro({
      id: id++,
      x: verificacion.x,
      y,
      ancho: verificacion.ancho,
      alto,
      recto: true,
      lineas: [{ texto: "Verificación de la orden de Producción", negrita: true, tam: TAM_LINEA }],
    }),
    cuadro({
      id: id++,
      x: pesada.x,
      y,
      ancho: pesada.ancho,
      alto,
      recto: true,
      lineas: [
        { texto: "PESADA", negrita: true, tam: TAM_LINEA },
        { texto: "(Central de pesada)", tam: TAM_LINEA },
      ],
    }),
    cuadro({
      id: id++,
      x: insumos.x,
      y: y + 1.5,
      ancho: insumos.ancho,
      alto: alto - 3,
      recto: true,
      lineas: [{ texto: "INSUMOS", negrita: true, tam: TAM_LINEA }],
    }),
    flecha({ id: id++, x1: insumos.x, y1: medio, x2: pesada.x + pesada.ancho, y2: medio }),
    flecha({ id: id++, x1: pesada.x, y1: medio, x2: verificacion.x + verificacion.ancho, y2: medio }),
    // El codo que baja por el margen: de la verificación al proceso.
    flecha({ id: id++, x1: verificacion.x, y1: medio, x2: 2.5, y2: medio, sinPunta: true }),
    flecha({ id: id++, x1: 2.5, y1: medio, x2: 2.5, y2: hastaY, sinPunta: true }),
  ];
}

/** El lienzo de una hoja de la etapa. */
function lienzoDeHoja({ esquema, cajas, primera, ultima, idBase }) {
  const formas = [];
  let id = idBase;

  // El marco que encierra el diagrama en la hoja del formato.
  formas.push(
    cuadro({
      id: id++,
      x: 0.5,
      y: 0.5,
      ancho: LIENZO_ANCHO - 1,
      alto: LIENZO_ALTO - 1,
      lineas: [],
      recto: true,
    })
  );

  formas.push(...filaDePesada(id, cajas[0] ? cajas[0].y + 4 : PRIMERA_FILA));
  id += 10;

  if (primera && necesitaRotuloDeEtapa(esquema)) {
    formas.push(cajaRotulo({ id: id++, y: PRIMERA_FILA, texto: esquema.etapa }));
  }

  // El rótulo de cada operación unitaria, sobre las cajas de sus pasos.
  for (const tramo of tramosDeGrupo(cajas)) {
    formas.push(cajaRotulo({ id: id++, y: tramo.cajas[0].y - ALTO_ROTULO_GRUPO - 1, texto: tramo.grupo }));
  }


  for (const [i, caja] of cajas.entries()) {
    formas.push(
      cuadro({
        id: id++,
        x: COL_PROCESO.x,
        y: caja.y,
        ancho: COL_PROCESO.ancho,
        alto: caja.alto,
        lineas: caja.lineas,
      })
    );

    // Lo que se agrega: la lista al margen, sin recuadro, y una raya que entra
    // en la operación — que es como el formato dice qué se echa y dónde.
    if (caja.altoIns > 0) {
      formas.push(
        rotulo({
          id: id++,
          x: COL_APOYO.x,
          y: caja.y,
          ancho: COL_APOYO.ancho,
          alto: caja.altoIns,
          lineas: caja.lineasIns,
        })
      );
      const yLinea = Math.max(caja.y + caja.altoIns + 1, caja.y + caja.alto / 2);
      formas.push(flecha({ id: id++, x1: COL_APOYO.x, y1: yLinea, x2: COL_PROCESO.x, y2: yLinea }));
    }

    // La nota, bajo la caja y sin recuadro, al lado de la flecha que baja.
    if (caja.altoNot > 0) {
      formas.push(
        rotulo({
          id: id++,
          x: COL_PROCESO.x - 2,
          y: caja.y + caja.alto + 0.5,
          ancho: COL_PROCESO.ancho,
          alto: caja.altoNot,
          lineas: caja.lineasNot,
        })
      );
    }

    if (i < cajas.length - 1) {
      const centro = COL_PROCESO.x + COL_PROCESO.ancho / 2;
      formas.push(
        flecha({ id: id++, x1: centro, y1: caja.y + caja.alto + caja.altoNot, x2: centro, y2: cajas[i + 1].y })
      );
    }
  }

  // Al pie de la última hoja: los controles en proceso, colgados de puntos de
  // la última operación, y debajo la leyenda de abreviaturas.
  let fondo = LIENZO_ALTO - 3;

  const leyenda = leyendaDeHoja(cajas);
  if (leyenda.length > 0) {
    const alto = altoDeCaja(leyenda, 44);
    fondo -= alto;
    formas.push(cuadro({ id: id++, x: COL_APOYO.x, y: fondo, ancho: 44, alto, lineas: leyenda }));
    fondo -= 4;
  }

  if (ultima && esquema.controles.length > 0) {
    const lineas = [
      { texto: "Controles en proceso:", negrita: true, subrayado: true, izquierda: true, tam: TAM_LINEA },
      ...esquema.controles.map((c) => ({ texto: c, izquierda: true, tam: TAM_LINEA })),
    ];
    const ancho = COL_APOYO.ancho + 8;
    const alto = altoDeCaja(lineas, ancho);
    fondo -= alto;
    const y = fondo;
    fondo -= 4;
    formas.push(cuadro({ id: id++, x: COL_APOYO.x, y, ancho, alto, lineas, recto: true }));

    if (cajas.length > 0) {
      const medio = y + alto / 2;
      formas.push(
        flecha({
          id: id++,
          x1: COL_APOYO.x + ancho,
          y1: medio,
          x2: COL_PROCESO.x + COL_PROCESO.ancho / 2,
          y2: medio,
          sinPunta: true,
          punteado: true,
        })
      );
    }
  }

  // Los insumos que ninguna operación reclamó se listan aparte, para que no se
  // pierdan: si el registro no dice dónde entran, el esquema tampoco puede.
  const reclamados = new Set(
    esquema.operaciones.flatMap((o) => (o.insumos || []).map((i) => i.split(":")[0].trim().toUpperCase()))
  );
  const sueltos = ultima ? esquema.insumos.filter((i) => !reclamados.has(i.nombre.toUpperCase())) : [];

  if (sueltos.length > 0) {
    const lineas = [
      {
        texto: "Otros insumos dispensados:",
        negrita: true,
        subrayado: true,
        izquierda: true,
        tam: TAM_LINEA,
      },
      ...sueltos.map((i) => ({
        texto: `• ${comoElEsquema(`${i.nombre}${i.cantidad ? `: ${i.cantidad}` : ""}`)}`,
        izquierda: true,
        tam: TAM_LINEA,
      })),
    ];
    // Al margen izquierdo, encima de la leyenda: en la columna de la derecha
    // se montaba encima de la última operación.
    const alto = altoDeCaja(lineas, COL_APOYO.ancho);
    fondo -= alto;
    formas.push(
      cuadro({
        id: id++,
        x: COL_APOYO.x,
        y: Math.max(PRIMERA_FILA, fondo),
        ancho: COL_APOYO.ancho,
        alto,
        lineas,
        discontinuo: true,
      })
    );
  }

  return lienzo({ id: id++, ancho: LIENZO_ANCHO, alto: LIENZO_ALTO, formas });
}

/** El sitio que hay que reservar al pie de la última hoja de una etapa. */
function reservaDePie(esquema) {
  if (esquema.controles.length === 0) return 24;

  const lineas = [{ texto: "Controles en proceso:" }, ...esquema.controles.map((c) => ({ texto: c }))];
  return altoDeCaja(lineas, COL_APOYO.ancho + 8) + 28;
}

/** Los lienzos de todo el esquema, uno por hoja. */
export function lienzosDelEsquema(esquemas) {
  const lienzos = [];
  let idBase = 1000;

  for (const esquema of ordenarEtapas(esquemas)) {
    const paginas = paginarEtapa(esquema, reservaDePie(esquema));
    paginas.forEach((cajas, i) => {
      lienzos.push(
        lienzoDeHoja({
          esquema,
          cajas,
          primera: i === 0,
          ultima: i === paginas.length - 1,
          idBase,
        })
      );
      idBase += 300;
    });
  }

  return lienzos;
}

export function buildEsquemaDocument(esquemas, { producto, codigo, empresa, planta, logo } = {}) {
  const lienzos = lienzosDelEsquema(esquemas);

  // El encabezado lleva sólo el nombre del producto: el formato no repite el
  // título del documento en cada hoja.
  const encabezado = encabezadoYPie({
    ancho: ANCHO_UTIL,
    titulo: [producto || ""],
    codigo,
    empresa,
    planta,
    logo: logo || logoPorDefecto(),
  });

  return {
    lienzos,
    doc: new Document({
      styles: { default: { document: { run: { font: "Arial", size: 16 } } } },
      sections: lienzos.map((_, i) => ({
        properties: {
          page: {
            margin: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
            size: { width: A4_ANCHO, height: A4_ALTO },
          },
        },
        ...encabezado,
        children: [new Paragraph({ children: [new TextRun(marcaDeLienzo(i))] })],
      })),
    }),
  };
}

export async function exportEsquemaToWord(esquemas, opciones = {}) {
  const { doc, lienzos } = buildEsquemaDocument(esquemas, opciones);

  // toBlob y no toBuffer: toBuffer le pide a JSZip un "nodebuffer", que sólo
  // existe en Node. En el navegador falla con "nodebuffer is not supported by
  // this platform", que es justo donde se usa esto.
  const armado = await Packer.toBlob(doc);
  const conLienzos = await inyectarLienzos(await armado.arrayBuffer(), lienzos);

  const nombre = (opciones.producto || "ESQUEMA").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const blob = new Blob([conLienzos], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nombre}_FORMATO_01_ESQUEMA.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
