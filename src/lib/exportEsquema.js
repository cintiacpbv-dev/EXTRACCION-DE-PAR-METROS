// FORMATO 01: el esquema del proceso.
//
// Coloca en un lienzo de Word las operaciones de cada etapa, una debajo de
// otra y unidas por flechas, con los insumos a la izquierda y los controles en
// proceso al margen — que es como está hecho el formato de la empresa.
//
// La maquetación es la parte que el registro no puede dictar: dónde va cada
// caja, cuánto mide y por dónde pasa la flecha. Se calcula aquí con una regla
// sencilla —una columna de operaciones y una columna de apoyo— y queda
// editable en Word, que es donde se le da el último retoque.

import { Document, Packer, Paragraph, TextRun } from "docx";
import { cuadro, flecha, lienzo, rotulo } from "./esquema/lienzo.js";
import { inyectarLienzos, marcaDeLienzo } from "./esquema/inyectar.js";
import { ordenarEtapas } from "./esquema/modelo.js";
import { encabezadoYPie } from "./exportEncabezado.js";
import { logoPorDefecto } from "./logoEmpresa.js";

const A4_ANCHO = 11907;
const A4_ALTO = 16840;
const MARGEN = 1000;
const ANCHO_UTIL = A4_ANCHO - MARGEN * 2;

// La página en milímetros, que es como se razona la maquetación.
const LIENZO_ANCHO = 165;
const LIENZO_ALTO = 235;

// Las dos columnas: apoyo (insumos, controles) y proceso (las operaciones).
const COL_APOYO = { x: 2, ancho: 62 };
const COL_PROCESO = { x: 78, ancho: 62 };

// Alto de un renglón de texto y márgenes internos de las cajas, en mm.
const ALTO_RENGLON = 3.4;
const RELLENO_CAJA = 2.6;
const SEPARACION = 7; // hueco entre dos operaciones, por donde va la flecha

const TAM_TITULO = 15; // medios puntos
const TAM_LINEA = 14;

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
    ...op.lineas.map((l) => ({ texto: l, tam: TAM_LINEA })),
    ...(op.equipo.length > 0 ? [{ texto: op.equipo.join(" + "), cursiva: true, tam: TAM_LINEA }] : []),
  ];
}

/**
 * Reparte una etapa en páginas: las operaciones se apilan hasta llenar el
 * lienzo y lo que no cabe abre otra hoja.
 */
function paginarEtapa(esquema) {
  const paginas = [];
  let actual = [];
  let y = 12; // debajo del rótulo de la etapa

  for (const op of esquema.operaciones) {
    const lineas = lineasDeOperacion(op);
    const alto = altoDeCaja(lineas, COL_PROCESO.ancho);

    if (y + alto > LIENZO_ALTO - 6 && actual.length > 0) {
      paginas.push(actual);
      actual = [];
      y = 12;
    }

    actual.push({ op, lineas, alto, y });
    y += alto + SEPARACION;
  }

  if (actual.length > 0) paginas.push(actual);
  return paginas;
}

/** El lienzo de una hoja de la etapa. */
function lienzoDeHoja({ esquema, cajas, primera, ultima, idBase }) {
  const formas = [];
  let id = idBase;

  formas.push(
    rotulo({
      id: id++,
      x: COL_APOYO.x,
      y: 1,
      ancho: 100,
      alto: 6,
      lineas: [{ texto: esquema.etapa, negrita: true, tam: 17, izquierda: true }],
    })
  );

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

    if (i < cajas.length - 1) {
      const centro = COL_PROCESO.x + COL_PROCESO.ancho / 2;
      formas.push(
        flecha({
          id: id++,
          x1: centro,
          y1: caja.y + caja.alto,
          x2: centro,
          y2: cajas[i + 1].y,
        })
      );
    }
  }

  // Los insumos abren la etapa y los controles la cierran: son el contexto de
  // todo el bloque, no de una operación concreta.
  if (primera && esquema.insumos.length > 0) {
    const lineas = [
      { texto: "Insumos dispensados:", negrita: true, izquierda: true, tam: TAM_LINEA },
      ...esquema.insumos.map((i) => ({
        texto: `• ${i.nombre}${i.cantidad ? `: ${i.cantidad}` : ""}`,
        izquierda: true,
        tam: TAM_LINEA,
      })),
    ];
    formas.push(
      cuadro({
        id: id++,
        x: COL_APOYO.x,
        y: 12,
        ancho: COL_APOYO.ancho,
        alto: altoDeCaja(lineas, COL_APOYO.ancho),
        lineas,
        discontinuo: true,
      })
    );
  }

  if (ultima && esquema.controles.length > 0) {
    const lineas = [
      { texto: "Controles en proceso:", negrita: true, izquierda: true, tam: TAM_LINEA },
      ...esquema.controles.map((c) => ({ texto: c, izquierda: true, tam: TAM_LINEA })),
    ];
    const alto = altoDeCaja(lineas, COL_APOYO.ancho);
    formas.push(
      cuadro({
        id: id++,
        x: COL_APOYO.x,
        y: Math.max(12, LIENZO_ALTO - alto - 6),
        ancho: COL_APOYO.ancho,
        alto,
        lineas,
      })
    );
  }

  return lienzo({ id: id++, ancho: LIENZO_ANCHO, alto: LIENZO_ALTO, formas });
}

/** Los lienzos de todo el esquema, uno por hoja. */
export function lienzosDelEsquema(esquemas) {
  const lienzos = [];
  let idBase = 1000;

  for (const esquema of ordenarEtapas(esquemas)) {
    const paginas = paginarEtapa(esquema);
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
      idBase += 200;
    });
  }

  return lienzos;
}

export function buildEsquemaDocument(esquemas, { producto, codigo, empresa, planta, logo } = {}) {
  const lienzos = lienzosDelEsquema(esquemas);

  const encabezado = encabezadoYPie({
    ancho: ANCHO_UTIL,
    titulo: [producto || "", "ESQUEMA DEL PROCESO"],
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
  const bytes = await Packer.toBuffer(doc);
  const conLienzos = await inyectarLienzos(bytes, lienzos);

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
