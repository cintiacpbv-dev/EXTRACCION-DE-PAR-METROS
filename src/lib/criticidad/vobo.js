// El RMD coloreado: en qué operaciones va el V°B° del jefe o supervisor.
//
// La evaluación de criticidad dice qué parámetros son PCP; el registro de
// manufactura dice en qué paso se controla cada uno y dónde se firma hoy un
// V°B°. Cruzando las dos cosas, cada paso del registro sale con una de cuatro
// recomendaciones —la misma leyenda que los RMD de ejemplo de Validaciones—:
//
//   AGREGAR V°B°        el paso tiene PCP y hoy no lleva V°B°
//   MANTENER V°B°       el paso tiene PCP y ya lleva V°B°
//   QUITAR V°B°         hoy lleva V°B°, pero sus parámetros son Clave o No clave
//   V°B° FUERA DE ALCANCE  lleva V°B° y no es un parámetro de proceso (despeje
//                       de sala, BPM): se mantiene según el procedimiento
//
// El PDF que sale es el registro original, sin tocar, con tres añadidos: una
// portada con el cuadro de recomendaciones, cada paso marcado con su color y
// una columna a la derecha ("Observaciones de Validaciones — V°B°") con el
// motivo de cada marca y la fila de la evaluación que lo justifica.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { CRITICO, CLAVE, NO_CLAVE } from "./modelo.js";
import { citaDeEvaluacion, compararPasos, pasosDe } from "./orden.js";

export const AGREGAR = "AGREGAR V°B°";
export const MANTENER = "MANTENER V°B°";
export const QUITAR = "QUITAR V°B°";
export const FUERA = "V°B° FUERA DE ALCANCE";

// Los colores de los ejemplos, tal cual.
const ROJO = rgb(0.85, 0.1, 0.1);
const ROJO_BORDE = rgb(0.776, 0.157, 0.157);
const ROJO_TEXTO = rgb(0.776, 0.157, 0.157);
const AMBAR = rgb(1, 0.75, 0);
const AMBAR_BORDE = rgb(0.706, 0.325, 0.035);
const GRIS = rgb(0.42, 0.45, 0.5);
const TINTA = rgb(0.122, 0.161, 0.216);
const AZUL_NOCHE = rgb(0.118, 0.227, 0.373);
const SEPARADOR = rgb(0.796, 0.835, 0.882);
const FONDO_MARGEN = rgb(0.973, 0.98, 0.988);

export const ESTILO = {
  [AGREGAR]: { relleno: ROJO, opacidad: 0.13, borde: ROJO_BORDE, texto: ROJO_TEXTO, celda: rgb(0.98, 0.89, 0.89) },
  [MANTENER]: { relleno: ROJO, opacidad: 0.13, borde: ROJO_BORDE, texto: ROJO_TEXTO, celda: rgb(0.98, 0.89, 0.89) },
  [QUITAR]: { relleno: AMBAR, opacidad: 0.28, borde: AMBAR_BORDE, texto: AMBAR_BORDE, celda: rgb(0.99, 0.94, 0.81) },
  [FUERA]: { relleno: null, opacidad: 0, borde: GRIS, texto: GRIS, celda: rgb(0.95, 0.96, 0.96), discontinuo: true },
};

const ORDEN_DE_RECOMENDACION = [AGREGAR, MANTENER, QUITAR, FUERA];

const MARGEN = 175; // lo que se añade a la derecha de cada página

// --- 1. Los pasos del registro, con su lugar en cada página -----------------

const CODIGO_DE_PASO = /^(\d+(?:\.\d+){1,3})\.?-?$/;
const ES_VB = /^V\s*°?\s*B\s*°?$/i;

/**
 * Lee dónde empieza y termina cada paso del RMD.
 *
 * `paginas` es lo que devuelve extractPdfText: por página, sus líneas con la
 * coordenada Y (desde abajo, como en el PDF) y sus fragmentos con su X. Un
 * paso empieza en la línea cuyo primer fragmento, pegado al margen izquierdo,
 * es su número ("4.4.16.-") y termina donde empieza el siguiente — aunque sea
 * varias páginas después: entonces tiene un tramo en cada página.
 *
 * Devuelve los pasos con sus tramos, si hoy llevan V°B° (la casilla "VB" junto
 * a "Realizado por") y si son un despeje de sala.
 */
export function pasosDelRmd(paginas = []) {
  const pasos = [];
  let actual = null;

  for (const [indice, pagina] of paginas.entries()) {
    const lineas = [...(pagina.lines || [])].sort((a, b) => b.y - a.y);
    if (lineas.length === 0) continue;

    // Dónde empieza el cuerpo: debajo de la cabecera repetida en cada página
    // (la tabla con "Inicio:" y "Fin:" de la fecha de fabricación o envase).
    // La más baja de las dos ("Inicio:" va encima de "Fin:").
    const fin = lineas.filter((l) => /^(Fin|Inicio)\s*:/i.test(l.text) || l.segments.some((s) => /^(Fin|Inicio)\s*:?$/i.test(s.str.trim()))).pop();
    // La cabecera termina con una fila vacía bajo "Fin:"; el cuerpo empieza
    // debajo de ella (en los RMD de ejemplo, 32 pt bajo la línea de "Fin:").
    const arribaDelCuerpo = fin ? fin.y - 32 : lineas[0].y + 10;
    const abajoDelCuerpo = Math.max(18, Math.min(...lineas.map((l) => l.y)) - 8);

    const cuerpo = lineas.filter((l) => l.y < arribaDelCuerpo);
    const marcas = cuerpo
      .map((l) => ({ l, m: String(l.segments[0]?.str || "").trim().match(CODIGO_DE_PASO) }))
      .filter(({ l, m }) => m && l.segments[0].x < 70);

    // Lo que queda del paso de la página anterior, hasta la primera marca.
    if (actual) {
      const hasta = marcas.length ? marcas[0].l.y + 11 : abajoDelCuerpo;
      if (arribaDelCuerpo - hasta > 4) {
        actual.tramos.push({ pagina: indice, arriba: arribaDelCuerpo, abajo: hasta, continuacion: true });
      }
    }

    marcas.forEach(({ l, m }, i) => {
      const siguiente = marcas[i + 1];
      actual = {
        codigo: m[1],
        x: l.segments[0].x,
        tramos: [{ pagina: indice, arriba: l.y + 11, abajo: siguiente ? siguiente.l.y + 11 : abajoDelCuerpo }],
        lineas: [],
      };
      pasos.push(actual);
    });

    // Cada línea del cuerpo, a su paso: es de donde salen el texto y la
    // casilla de V°B°.
    for (const l of cuerpo) {
      const duenno = [...pasos].reverse().find((p) =>
        p.tramos.some((t) => t.pagina === indice && l.y <= t.arriba && l.y >= t.abajo)
      );
      duenno?.lineas.push(l);
    }
  }

  return pasos.map((p) => {
    const texto = p.lineas.map((l) => l.text).join(" ");
    return {
      codigo: p.codigo,
      x: p.x,
      tramos: p.tramos,
      texto,
      tieneVB: p.lineas.some((l) => l.segments.some((s) => ES_VB.test(String(s.str).trim()))),
      esDespeje: /\bDESPEJE\b/i.test(texto),
    };
  });
}

// --- 2. La recomendación de cada paso --------------------------------------

const lista = (nombres, max = 5) => {
  const unicos = [...new Set(nombres)];
  return unicos.length > max ? `${unicos.slice(0, max).join(", ")}…` : unicos.join(", ");
};

/**
 * Cruza los pasos del RMD con la evaluación.
 *
 * `filas` son los parámetros ya clasificados (con su N° en `numeros`) y
 * `atributos` los atributos de calidad con su severidad y los pasos donde se
 * miden: un paso donde se verifica un ACC (S 4-5) también pide V°B°, aunque
 * sus parámetros no sean PCP — es el caso del peso del contenido al final del
 * secado en los ejemplos.
 */
export function recomendar(pasos, { filas = [], atributos = [], numeros = new Map() } = {}) {
  const porPaso = new Map();
  for (const f of filas) {
    for (const codigo of pasosDe(f)) {
      if (!porPaso.has(codigo)) porPaso.set(codigo, []);
      porPaso.get(codigo).push(f);
    }
  }
  const accPorPaso = new Map();
  for (const a of atributos) {
    if (!(a.severidad >= 4)) continue;
    for (const codigo of a.pasos || []) {
      if (!accPorPaso.has(codigo)) accPorPaso.set(codigo, []);
      accPorPaso.get(codigo).push(a);
    }
  }

  const salida = [];
  for (const paso of pasos) {
    const suyas = porPaso.get(paso.codigo) || [];
    const pcp = suyas.filter((f) => f.clasificacion === CRITICO);
    const acc = accPorPaso.get(paso.codigo) || [];
    const decididas = suyas.filter((f) => [CLAVE, NO_CLAVE].includes(f.clasificacion));
    const cita = (fs) => {
      const c = citaDeEvaluacion(fs.map((f) => numeros.get(f.id)));
      return c ? ` (${c})` : "";
    };

    let recomendacion = null;
    let motivo = "";
    if (pcp.length > 0 || acc.length > 0) {
      recomendacion = paso.tieneVB ? MANTENER : AGREGAR;
      const partes = [];
      if (pcp.length) partes.push(`PCP: ${lista(pcp.map((f) => f.magnitud))}${cita(pcp)}.`);
      if (acc.length) {
        partes.push(`En este paso se verifica ${lista(acc.map((a) => `${a.nombre} (ACC, S ${a.severidad})`), 3)}.`);
      }
      motivo = partes.join(" ");
    } else if (paso.tieneVB && decididas.length > 0) {
      recomendacion = QUITAR;
      const claves = decididas.filter((f) => f.clasificacion === CLAVE);
      const noClaves = decididas.filter((f) => f.clasificacion === NO_CLAVE);
      motivo = [
        claves.length ? `Clave: ${lista(claves.map((f) => f.magnitud))}${cita(claves)}.` : "",
        noClaves.length ? `No clave: ${lista(noClaves.map((f) => f.magnitud))}${cita(noClaves)}.` : "",
        "Se controlan con el registro del operador.",
      ]
        .filter(Boolean)
        .join(" ");
    } else if (paso.tieneVB && suyas.length === 0) {
      recomendacion = FUERA;
      motivo = paso.esDespeje
        ? "Despeje de sala (BPM). No es un parámetro de proceso: se mantiene según el procedimiento."
        : "Sin parámetros de proceso evaluados en este paso: el V°B° se mantiene según el procedimiento.";
    }
    if (recomendacion) salida.push({ codigo: paso.codigo, recomendacion, motivo, paso });
  }
  return salida;
}

/** Las recomendaciones en el orden del cuadro: por tipo, y dentro, por paso. */
export function enOrdenDeCuadro(recomendaciones) {
  return [...recomendaciones].sort(
    (a, b) =>
      ORDEN_DE_RECOMENDACION.indexOf(a.recomendacion) - ORDEN_DE_RECOMENDACION.indexOf(b.recomendacion) ||
      compararPasos(a.codigo, b.codigo)
  );
}

const normalizar = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();

const ES_ENVASE = /ENVAS|ACONDICION|BLIST/;

/**
 * Las filas de la evaluación que corresponden a un RMD. Con registros, la
 * etapa es la del propio registro ("FABRICACION", "ENVASE"). Con el
 * protocolo, las etapas son más finas ("Encapsulado", "Secado"…): todas van
 * al RMD de fabricación salvo las de envase.
 */
export function filasDelRmd(filas, etapa) {
  const e = normalizar(etapa);
  const exactas = filas.filter((f) => normalizar(f.etapa) === e);
  if (exactas.length > 0) return exactas;
  const esEnvase = ES_ENVASE.test(e);
  return filas.filter((f) => ES_ENVASE.test(normalizar(f.etapa)) === esEnvase);
}

// --- 3. El PDF ---------------------------------------------------------------

// Las fuentes estándar del PDF sólo saben escribir el juego WinAnsi. Lo que se
// salga de ahí se traduce a algo equivalente en vez de romper la descarga.
const EQUIVALENTES = { "≥": ">=", "≤": "<=", "→": "->", "←": "<-", "−": "-", "≈": "aprox.", "₂": "2", "₃": "3", "⁰": "0", "►": ">", "☐": "[ ]", "☒": "[x]", " ": " " };
const WIN_ANSI_EXTRA = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"]);
export function textoSeguro(texto) {
  return [...String(texto ?? "")]
    .map((c) => {
      if (EQUIVALENTES[c] !== undefined) return EQUIVALENTES[c];
      const n = c.codePointAt(0);
      if ((n >= 32 && n <= 126) || (n >= 160 && n <= 255) || WIN_ANSI_EXTRA.has(c)) return c;
      if (c === "\n" || c === "\t") return " ";
      return "";
    })
    .join("");
}

function envolver(texto, fuente, tam, ancho) {
  const palabras = textoSeguro(texto).split(/\s+/).filter(Boolean);
  const lineas = [];
  let linea = "";
  for (const p of palabras) {
    const prueba = linea ? `${linea} ${p}` : p;
    if (fuente.widthOfTextAtSize(prueba, tam) <= ancho || !linea) linea = prueba;
    else {
      lineas.push(linea);
      linea = p;
    }
  }
  if (linea) lineas.push(linea);
  return lineas;
}

function rectanguloDiscontinuo(pagina, { x, y, width, height, color, grosor = 0.8 }) {
  const t = 3;
  const h = 2;
  const segmento = (x1, y1, x2, y2) => {
    const largo = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / largo;
    const uy = (y2 - y1) / largo;
    for (let d = 0; d < largo; d += t + h) {
      const e = Math.min(d + t, largo);
      pagina.drawLine({ start: { x: x1 + ux * d, y: y1 + uy * d }, end: { x: x1 + ux * e, y: y1 + uy * e }, thickness: grosor, color });
    }
  };
  segmento(x, y, x + width, y);
  segmento(x + width, y, x + width, y + height);
  segmento(x + width, y + height, x, y + height);
  segmento(x, y + height, x, y);
}

function portada(pdf, fuentes, { titulo, subtitulo, recomendaciones, ancho, alto }) {
  const { normal, negrita } = fuentes;
  let pagina = pdf.insertPage(0, [ancho, alto]);
  let numeroDePortada = 0;
  const nuevaPortada = () => {
    numeroDePortada++;
    pagina = pdf.insertPage(numeroDePortada, [ancho, alto]);
    return alto - 40;
  };

  // Banda de título
  pagina.drawRectangle({ x: 0, y: alto - 68, width: ancho, height: 68, color: AZUL_NOCHE });
  pagina.drawText(textoSeguro(titulo), { x: 30, y: alto - 32, size: 15, font: negrita, color: rgb(1, 1, 1), maxWidth: ancho - 60 });
  pagina.drawText(textoSeguro(subtitulo), { x: 30, y: alto - 52, size: 8.5, font: normal, color: rgb(0.85, 0.89, 0.94), maxWidth: ancho - 60 });

  // Leyenda
  const leyenda = [
    [AGREGAR, "La operación tiene parámetros críticos (PCP) y hoy no lleva V°B°."],
    [MANTENER, "La operación tiene PCP y ya lleva V°B°."],
    [QUITAR, "Hoy lleva V°B°, pero sus parámetros son Clave o No clave."],
    [FUERA, "Despeje de sala (BPM). No es un parámetro de proceso; se mantiene según el procedimiento."],
  ];
  let y = alto - 100;
  for (const [etiqueta, explicacion] of leyenda) {
    const e = ESTILO[etiqueta];
    if (e.discontinuo) rectanguloDiscontinuo(pagina, { x: 30, y: y - 3, width: 34, height: 14, color: e.borde });
    else pagina.drawRectangle({ x: 30, y: y - 3, width: 34, height: 14, color: e.relleno, opacity: e.opacidad, borderColor: e.borde, borderWidth: 1.2 });
    pagina.drawText(textoSeguro(etiqueta), { x: 72, y: y + 1, size: 8, font: negrita, color: e.texto });
    pagina.drawText(textoSeguro(explicacion), { x: 196, y: y + 1, size: 8, font: normal, color: TINTA });
    y -= 22;
  }

  // El cuadro
  const columnas = [{ x: 30, w: 52, t: "Paso" }, { x: 82, w: 112, t: "Recomendación" }, { x: 194, w: ancho - 224, t: "Motivo" }];
  const cabecera = (yy) => {
    pagina.drawRectangle({ x: 30, y: yy - 14, width: ancho - 60, height: 16, color: AZUL_NOCHE });
    for (const c of columnas) pagina.drawText(c.t, { x: c.x + 5, y: yy - 9, size: 7.5, font: negrita, color: rgb(1, 1, 1) });
    return yy - 14;
  };
  y = cabecera(y - 12);

  const filas = enOrdenDeCuadro(recomendaciones);
  if (filas.length === 0) {
    pagina.drawText("Ningún paso requiere cambios de V°B° según esta evaluación.", { x: 36, y: y - 14, size: 8, font: normal, color: TINTA });
    y -= 22;
  }
  for (const r of filas) {
    const e = ESTILO[r.recomendacion];
    const lineas = envolver(r.motivo, normal, 7, columnas[2].w - 10);
    const altoFila = Math.max(15, lineas.length * 9 + 6);
    if (y - altoFila < 70) {
      y = cabecera(nuevaPortada());
    }
    pagina.drawRectangle({ x: 30, y: y - altoFila, width: ancho - 60, height: altoFila, borderColor: rgb(0.82, 0.85, 0.89), borderWidth: 0.5 });
    pagina.drawRectangle({ x: columnas[1].x, y: y - altoFila, width: columnas[1].w, height: altoFila, color: e.celda });
    pagina.drawText(r.codigo, { x: columnas[0].x + 5, y: y - 10, size: 7.5, font: negrita, color: TINTA });
    pagina.drawText(textoSeguro(r.recomendacion), { x: columnas[1].x + 5, y: y - 10, size: 7.5, font: negrita, color: e.texto });
    lineas.forEach((l, i) => pagina.drawText(l, { x: columnas[2].x + 5, y: y - 10 - i * 9, size: 7, font: normal, color: TINTA }));
    y -= altoFila;
  }

  // Pie
  const pie = [
    "Criterio: V°B° en las operaciones cuyos parámetros son PCP (afectan un atributo crítico con S = 4–5). Las operaciones Clave o No clave se controlan con el registro del operador.",
    "Las operaciones Clave / No clave que hoy no llevan V°B° no se marcan (no requieren cambio).",
    "Numeración \"eval.\" = N° del parámetro en el Paso 2 de la Evaluación de Criticidad y Riesgo.",
  ];
  y -= 16;
  for (const t of pie) {
    for (const l of envolver(t, normal, 7, ancho - 60)) {
      if (y < 30) y = nuevaPortada();
      pagina.drawText(l, { x: 30, y, size: 7, font: normal, color: GRIS });
      y -= 10;
    }
  }
  return numeroDePortada + 1;
}

/**
 * El RMD coloreado, listo para descargar.
 *
 * `bytes` es el PDF original; `pasos` y `recomendaciones` salen de las dos
 * funciones de arriba. Devuelve los bytes del PDF nuevo.
 */
export async function colorearRmd(bytes, { recomendaciones, titulo, subtitulo }) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);

  const paginas = pdf.getPages();
  const primera = paginas[0];
  const anchoOriginal = primera?.getWidth() || 595.28;
  const altoOriginal = primera?.getHeight() || 841.89;

  // Cada página, ensanchada a la derecha con la columna de observaciones.
  for (const p of paginas) {
    const { width, height } = p.getSize();
    p.setSize(width + MARGEN, height);
    p.drawRectangle({ x: width, y: 0, width: MARGEN, height, color: FONDO_MARGEN });
    p.drawLine({ start: { x: width + 2, y: 20 }, end: { x: width + 2, y: height - 20 }, thickness: 1, color: SEPARADOR });
    p.drawText("OBSERVACIONES DE VALIDACIONES — V°B°", { x: width + 10, y: height - 24, size: 7, font: negrita, color: GRIS });
  }

  // Dónde está ya ocupada la columna de cada página, para que dos notas
  // cercanas no se monten una encima de otra.
  const ocupado = new Map();

  for (const r of recomendaciones) {
    const e = ESTILO[r.recomendacion];
    r.paso.tramos.forEach((t, i) => {
      const pagina = paginas[t.pagina];
      if (!pagina) return;
      const ancho = pagina.getWidth() - MARGEN;
      const x = Math.max(12, (r.paso.x || 29) - 5);
      const derecha = ancho - 26;
      const alto = t.arriba - t.abajo;
      if (e.discontinuo) {
        rectanguloDiscontinuo(pagina, { x, y: t.abajo, width: derecha - x, height: alto, color: e.borde });
      } else {
        pagina.drawRectangle({ x, y: t.abajo, width: derecha - x, height: alto, color: e.relleno, opacity: e.opacidad, borderColor: e.borde, borderWidth: 1.2, borderOpacity: 1 });
      }
      // La nota va sólo en el primer tramo; los tramos de las páginas
      // siguientes llevan el color, que ya dice lo mismo.
      if (i > 0 || t.continuacion) return;

      const lineas = envolver(r.motivo, normal, 6.5, MARGEN - 22);
      const altoNota = 14 + lineas.length * 8 + 4;
      const libre = ocupado.get(t.pagina) ?? pagina.getHeight() - 32;
      const arriba = Math.min(t.arriba - 2, libre);
      const nx = ancho + 8;
      pagina.drawRectangle({ x: nx, y: arriba - altoNota, width: MARGEN - 12, height: altoNota, color: rgb(1, 1, 1), borderColor: e.borde, borderWidth: 1, borderDashArray: e.discontinuo ? [3, 2] : undefined });
      pagina.drawText(textoSeguro(`${r.codigo} · ${r.recomendacion}`), { x: nx + 4, y: arriba - 10, size: 7.5, font: negrita, color: e.texto });
      lineas.forEach((l, k) => pagina.drawText(l, { x: nx + 4, y: arriba - 19 - k * 8, size: 6.5, font: normal, color: TINTA }));
      pagina.drawLine({ start: { x: derecha, y: t.arriba - 4 }, end: { x: nx, y: arriba - 6 }, thickness: 0.6, color: e.borde });
      ocupado.set(t.pagina, arriba - altoNota - 6);
    });
  }

  portada(pdf, { normal, negrita }, {
    titulo,
    subtitulo,
    recomendaciones,
    ancho: anchoOriginal + MARGEN,
    alto: altoOriginal,
  });

  return pdf.save();
}

/** El nombre del archivo: el del RMD con "_VoBo". */
export function nombreDelRmdColoreado(nombre) {
  const base = String(nombre || "RMD").replace(/\.pdf$/i, "");
  return `${base}_VoBo.pdf`;
}
