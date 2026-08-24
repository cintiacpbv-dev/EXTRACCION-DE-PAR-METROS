// Lectura y reescritura de un protocolo de validación en formato Word.
//
// El protocolo es un documento largo y formal —portada, firmas, encabezados,
// numeración— del que sólo hay que tocar unas celdas. Rehacerlo con la
// librería que genera el FORMATO A09 significaría reconstruir todo lo demás y
// perderlo por el camino, así que en vez de eso se abre el .docx como lo que
// es —un zip con un XML dentro—, se cambian esas celdas en el propio XML y se
// vuelve a cerrar. Todo lo que no se toca sale byte por byte como entró.

import JSZip from "jszip";

const RE_TABLA = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
const RE_FILA = /<w:tr\b[\s\S]*?<\/w:tr>/g;
const RE_CELDA = /<w:tc>[\s\S]*?<\/w:tc>/g;
const RE_TEXTO = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const RE_PARRAFO = /<w:p\b(?:[^>]*)>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g;

/** Texto visible de un fragmento de XML de Word. */
export function textoDe(xml) {
  const partes = [];
  for (const m of xml.matchAll(RE_TEXTO)) partes.push(desescapar(m[1]));
  return partes.join("").replace(/\s+/g, " ").trim();
}

function desescapar(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapar(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Abre el .docx y devuelve su XML principal junto con el mapa de sus tablas.
 *
 * De cada celda se guarda dónde empieza y acaba en el XML, que es lo que
 * después permite sustituir su contenido sin tocar nada más.
 */
export async function leerProtocolo(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entrada = zip.file("word/document.xml");
  if (!entrada) throw new Error("El archivo no parece un documento de Word (no tiene word/document.xml).");

  const xml = await entrada.async("string");
  return { zip, xml, nombre: file.name, tablas: mapearTablas(xml) };
}

function mapearTablas(xml) {
  const tablas = [];

  for (const mt of xml.matchAll(RE_TABLA)) {
    const baseTabla = mt.index;
    const filas = [];

    for (const mf of mt[0].matchAll(RE_FILA)) {
      const baseFila = baseTabla + mf.index;
      const celdas = [];

      for (const mc of mf[0].matchAll(RE_CELDA)) {
        const inicio = baseFila + mc.index;
        celdas.push({ inicio, fin: inicio + mc[0].length, texto: textoDe(mc[0]) });
      }

      filas.push({ celdas, texto: celdas.map((c) => c.texto).join(" | ") });
    }

    tablas.push({ indice: tablas.length, inicio: baseTabla, filas });
  }

  return tablas;
}

/**
 * Título que precede a una tabla: el último párrafo con texto que hay antes
 * de ella. Es lo que identifica de qué habla la tabla ("FÓRMULA DEL PRODUCTO
 * POR LOTE", "Etapa: Envase"), porque las tablas no llevan nombre propio.
 */
export function tituloAntesDe(xml, posicionTabla) {
  let titulo = "";
  for (const m of xml.slice(0, posicionTabla).matchAll(RE_PARRAFO)) {
    const t = textoDe(m[0]);
    if (t) titulo = t;
  }
  return titulo;
}

const AMARILLO = '<w:shd w:val="clear" w:color="auto" w:fill="FFF2A8"/>';

/**
 * Escribe un texto nuevo en una celda.
 *
 * El texto de una celda puede venir repartido en varios fragmentos —Word los
 * parte cada vez que cambia el formato, o al corregir la ortografía—, así que
 * el texto nuevo entra entero en el primero y los demás se vacían. Conservar
 * el primero, en vez de crear uno, es lo que mantiene la letra y el tamaño de
 * la celda tal como estaban.
 */
function celdaConTexto(xmlCelda, texto, resaltar) {
  let primero = true;
  let salida = xmlCelda.replace(RE_TEXTO, (completo) => {
    const abre = completo.slice(0, completo.indexOf(">") + 1);
    if (!primero) return `${abre.replace(/<w:t(\s[^>]*)?>/, '<w:t xml:space="preserve">')}</w:t>`;
    primero = false;
    return `<w:t xml:space="preserve">${escapar(texto)}</w:t>`;
  });

  // Celda sin ningún fragmento de texto (vacía en el original): no se toca,
  // porque insertar un párrafo a mano se sale de lo que este lector entiende.
  if (primero) return null;

  return resaltar ? conFondoAmarillo(salida) : salida;
}

// Dentro de las propiedades de una celda, Word exige un orden concreto de
// elementos: el sombreado va detrás de los bordes y del ancho, y delante del
// resto. Puesto en otro sitio el documento se abre igual, pero Word ignora el
// color y el resaltado no se ve.
const ANTES_DEL_SOMBREADO = [/<\/w:tcBorders>/, /<w:tcW\b[^>]*\/>/, /<w:gridSpan\b[^>]*\/>/];

function conFondoAmarillo(xmlCelda) {
  // Un sombreado previo se reemplaza, no se duplica.
  const limpio = xmlCelda.replace(/<w:shd\b[^>]*\/>|<w:shd\b[^>]*>[\s\S]*?<\/w:shd>/, "");

  if (!limpio.includes("<w:tcPr>")) {
    return limpio.replace(/<w:tc>/, `<w:tc><w:tcPr>${AMARILLO}</w:tcPr>`);
  }

  const props = limpio.slice(limpio.indexOf("<w:tcPr>"), limpio.indexOf("</w:tcPr>"));
  for (const marca of ANTES_DEL_SOMBREADO) {
    const m = props.match(marca);
    if (m) return limpio.replace(m[0], m[0] + AMARILLO);
  }
  return limpio.replace("<w:tcPr>", `<w:tcPr>${AMARILLO}`);
}

/**
 * Aplica una lista de cambios y devuelve el .docx resultante.
 *
 * Cada cambio dice qué celda y qué texto nuevo. Se aplican de atrás hacia
 * delante para que cambiar una celda no desplace la posición de las
 * anteriores, que se calcularon sobre el XML original.
 */
export async function escribirProtocolo({ zip, xml }, cambios, { resaltar = true, resumen = null } = {}) {
  const ordenados = [...cambios].sort((a, b) => b.celda.inicio - a.celda.inicio);

  let salida = xml;
  let aplicados = 0;

  for (const cambio of ordenados) {
    const { inicio, fin } = cambio.celda;
    const nueva = celdaConTexto(salida.slice(inicio, fin), cambio.textoNuevo, resaltar);
    if (nueva === null) continue;
    salida = salida.slice(0, inicio) + nueva + salida.slice(fin);
    aplicados += 1;
  }

  if (resumen) salida = conApartadoFinal(salida, resumen);

  zip.file("word/document.xml", salida);
  return { blob: await zip.generateAsync({ type: "blob" }), aplicados };
}

/**
 * Añade contenido al final del cuerpo del documento.
 *
 * Va justo antes del último <w:sectPr>, que no es una sección más sino la
 * configuración de página del cuerpo entero y tiene que seguir siendo lo
 * último. Metido después, Word da el archivo por dañado.
 */
function conApartadoFinal(xml, xmlNuevo) {
  const cierre = xml.lastIndexOf("<w:sectPr");
  if (cierre === -1) return xml.replace("</w:body>", `${xmlNuevo}</w:body>`);
  return xml.slice(0, cierre) + xmlNuevo + xml.slice(cierre);
}
