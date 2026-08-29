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

// El recuadro de una operación unitaria: sitio para su rótulo arriba y un
// respiro por fuera para que la raya no toque las cajas de al lado.
const ALTO_ROTULO_GRUPO = 6;
const MARGEN_GRUPO = 4;

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

/** Las líneas de la caja de agregaciones que cuelga de una operación. */
function lineasDeInsumos(insumos) {
  return insumos.map((i) => ({ texto: `• ${i}`, izquierda: true, tam: TAM_LINEA }));
}

/**
 * Reparte una etapa en páginas: las operaciones se apilan hasta llenar el
 * lienzo y lo que no cabe abre otra hoja.
 */
function paginarEtapa(esquema) {
  const paginas = [];
  let actual = [];
  let y = 12; // debajo del rótulo de la etapa

  let grupoAbierto = null;

  for (const op of esquema.operaciones) {
    // Al abrir una operación unitaria se deja sitio para el rótulo de su
    // recuadro; al cerrarla, para que la raya no toque la caja siguiente.
    if (op.grupo !== grupoAbierto) {
      if (grupoAbierto) y += MARGEN_GRUPO;
      if (op.grupo) y += ALTO_ROTULO_GRUPO;
      grupoAbierto = op.grupo || null;
    }

    const lineas = lineasDeOperacion(op);
    const alto = altoDeCaja(lineas, COL_PROCESO.ancho);

    // Lo que se agrega en esta operación va a su izquierda; la fila mide lo
    // que la más alta de las dos cajas.
    const insumos = op.insumos || [];
    const lineasIns = lineasDeInsumos(insumos);
    const altoIns = insumos.length > 0 ? altoDeCaja(lineasIns, COL_APOYO.ancho) : 0;
    const altoFila = Math.max(alto, altoIns);

    if (y + altoFila > LIENZO_ALTO - 6 && actual.length > 0) {
      paginas.push(actual);
      actual = [];
      y = 12;
    }

    actual.push({ op, lineas, alto, y, lineasIns, altoIns });
    y += altoFila + SEPARACION;
  }

  if (actual.length > 0) paginas.push(actual);
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

/** El lienzo de una hoja de la etapa. */
function lienzoDeHoja({ esquema, cajas, ultima, idBase }) {
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

  // El recuadro de rayas de cada operación unitaria, con su nombre encima:
  // abarca todas sus cajas y las de lo que se les agrega.
  for (const tramo of tramosDeGrupo(cajas)) {
    const arriba = tramo.cajas[0].y - ALTO_ROTULO_GRUPO;
    const ultima = tramo.cajas[tramo.cajas.length - 1];
    const abajo = ultima.y + Math.max(ultima.alto, ultima.altoIns);

    formas.push(
      rotulo({
        id: id++,
        x: COL_APOYO.x + 1,
        y: arriba,
        ancho: 110,
        alto: ALTO_ROTULO_GRUPO,
        lineas: [{ texto: tramo.grupo, negrita: true, tam: TAM_TITULO, izquierda: true }],
      })
    );
    formas.push(
      cuadro({
        id: id++,
        x: COL_APOYO.x - 1,
        y: arriba,
        ancho: COL_PROCESO.x + COL_PROCESO.ancho - COL_APOYO.x + 2,
        alto: abajo - arriba + 2,
        lineas: [],
        discontinuo: true,
        recto: true,
      })
    );
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

    // La agregación: su caja a la izquierda y una flecha que entra en la
    // operación, que es como el esquema muestra qué se echa y dónde.
    if (caja.altoIns > 0) {
      formas.push(
        cuadro({
          id: id++,
          x: COL_APOYO.x,
          y: caja.y,
          ancho: COL_APOYO.ancho,
          alto: caja.altoIns,
          lineas: caja.lineasIns,
          discontinuo: true,
        })
      );
      const medio = caja.y + Math.min(caja.alto, caja.altoIns) / 2;
      formas.push(
        flecha({
          id: id++,
          x1: COL_APOYO.x + COL_APOYO.ancho,
          y1: medio,
          x2: COL_PROCESO.x,
          y2: medio,
        })
      );
    }

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

  // Los insumos que ninguna operación reclamó se listan al final, para que no
  // se pierdan: si el registro no dice dónde entran, el esquema tampoco puede.
  const reclamados = new Set(
    esquema.operaciones.flatMap((o) => (o.insumos || []).map((i) => i.split(":")[0].trim().toUpperCase()))
  );
  const sueltos = ultima
    ? esquema.insumos.filter((i) => !reclamados.has(i.nombre.toUpperCase()))
    : [];

  if (sueltos.length > 0) {
    const lineas = [
      { texto: "Otros insumos dispensados:", negrita: true, izquierda: true, tam: TAM_LINEA },
      ...sueltos.map((i) => ({
        texto: `• ${i.nombre}${i.cantidad ? `: ${i.cantidad}` : ""}`,
        izquierda: true,
        tam: TAM_LINEA,
      })),
    ];
    const alto = altoDeCaja(lineas, COL_APOYO.ancho);
    formas.push(
      cuadro({
        id: id++,
        x: COL_APOYO.x,
        y: Math.max(12, LIENZO_ALTO - alto - 40),
        ancho: COL_APOYO.ancho,
        alto,
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
