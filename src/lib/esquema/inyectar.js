// Mete los lienzos del esquema dentro de un .docx ya generado.
//
// La librería con la que se arma el documento no sabe de formas ni de
// lienzos, y su importador de XML crudo envuelve lo que se le pasa en un
// elemento inválido que Word rechaza al abrir. Así que el documento se genera
// con una marca de texto donde va cada dibujo y aquí se sustituye la marca —y
// el párrafo entero que la contiene— por el XML del lienzo.
//
// Es la misma cirugía que se le hace al protocolo (protocolo/documento.js):
// abrir el zip, tocar word/document.xml y volver a cerrarlo, sin alterar nada
// más del documento.

import JSZip from "jszip";

/** La marca que se escribe en el documento donde luego va un lienzo. */
export function marcaDeLienzo(n) {
  return `@@LIENZO_${n}@@`;
}

/**
 * Sustituye cada marca por su lienzo.
 *
 * `lienzos` es una lista de cadenas XML, en el mismo orden en que se
 * escribieron las marcas.
 */
export async function inyectarLienzos(bytes, lienzos) {
  const zip = await JSZip.loadAsync(bytes);
  let xml = await zip.file("word/document.xml").async("string");

  lienzos.forEach((lienzo, i) => {
    const marca = marcaDeLienzo(i);
    const donde = xml.indexOf(marca);
    if (donde < 0) return;

    // Se reemplaza el párrafo completo, no sólo el texto: un <w:drawing> no
    // puede quedar dentro del <w:r> que sostiene la marca.
    const ini = xml.lastIndexOf("<w:p ", donde);
    const iniAlt = xml.lastIndexOf("<w:p>", donde);
    const desde = Math.max(ini, iniAlt);
    const cierre = xml.indexOf("</w:p>", donde);
    if (desde < 0 || cierre < 0) return;

    xml = xml.slice(0, desde) + lienzo + xml.slice(cierre + "</w:p>".length);
  });

  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "uint8array" });
}
