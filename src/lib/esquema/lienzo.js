// Dibuja el diagrama de flujo del Formato 01 como un lienzo de Word.
//
// El formato original está hecho con cuadros de texto y flechas colocados a
// mano dentro de un "lienzo" (wpc:wpc), no con tablas. Aquí se genera ese
// mismo XML: cada operación es un rectángulo redondeado con su texto dentro y
// entre dos operaciones consecutivas va un conector con punta de flecha.
//
// Word mide en EMU (914 400 por pulgada). Todo lo que aquí se llama "mm" se
// convierte a EMU al escribir el XML, porque razonar la maquetación en
// milímetros es mucho más llevadero que en unidades de 1/914400 de pulgada.

const EMU_POR_MM = 36000;

export const mm = (valor) => Math.round(valor * EMU_POR_MM);

function escapar(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Un renglón de texto dentro de un cuadro.
 *
 * `negrita` para el nombre de la operación, `cursiva` para el equipo —que es
 * como los distingue el formato—, `subrayado` para los encabezados de las
 * notas al margen ("Controles en proceso:") y `tam` en medios puntos.
 */
function parrafo({
  texto,
  negrita = false,
  cursiva = false,
  subrayado = false,
  tam = 15,
  izquierda = false,
}) {
  const rPr =
    `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>` +
    (negrita ? "<w:b/><w:bCs/>" : "") +
    (cursiva ? "<w:i/><w:iCs/>" : "") +
    (subrayado ? `<w:u w:val="single"/>` : "") +
    `<w:sz w:val="${tam}"/><w:szCs w:val="${tam}"/></w:rPr>`;

  return (
    `<w:p><w:pPr><w:pStyle w:val="NormalWeb"/>` +
    `<w:spacing w:before="0" w:beforeAutospacing="0" w:after="0" w:afterAutospacing="0"/>` +
    `<w:jc w:val="${izquierda ? "left" : "center"}"/>${rPr}</w:pPr>` +
    `<w:r>${rPr}<w:t xml:space="preserve">${escapar(texto)}</w:t></w:r></w:p>`
  );
}

/**
 * Un cuadro del diagrama.
 *
 * `x`, `y`, `ancho` y `alto` van en milímetros desde la esquina superior
 * izquierda del lienzo.
 *
 * El instructivo IVAL-P201-00 fija qué línea lleva cada figura: las
 * operaciones unitarias, la predeterminada; el cuadro que agrupa operaciones,
 * tipo "guion" (`discontinuo`); y las indicaciones del proceso, la leyenda y
 * el almacenamiento, tipo "punto redondo" a 0.25 pto (`punteado`).
 */
export function cuadro({
  id,
  x,
  y,
  ancho,
  alto,
  lineas,
  discontinuo = false,
  punteado = false,
  sinBorde = false,
  recto = false,
}) {
  // 3175 EMU son 0.25 pto, el ancho que el instructivo pide para el punteado
  // y el mismo que ya llevaban las demás figuras.
  const trazo = punteado ? "sysDot" : discontinuo ? "dash" : "solid";
  const borde = sinBorde
    ? `<a:ln w="3175"><a:noFill/></a:ln>`
    : `<a:ln w="3175" cap="flat" cmpd="sng" algn="ctr">` +
      `<a:solidFill><a:sysClr val="windowText" lastClr="000000"/></a:solidFill>` +
      `<a:prstDash val="${trazo}"/></a:ln>`;

  return (
    `<wps:wsp><wps:cNvPr id="${id}" name="Cuadro ${id}"/><wps:cNvSpPr/><wps:spPr>` +
    `<a:xfrm><a:off x="${mm(x)}" y="${mm(y)}"/><a:ext cx="${mm(ancho)}" cy="${mm(alto)}"/></a:xfrm>` +
    // Las operaciones van en rectángulo redondeado y las agrupaciones en
    // rectángulo recto, como en el formato.
    (recto
      ? `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`
      : `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 8944"/></a:avLst></a:prstGeom>`) +
    `<a:noFill/>${borde}<a:effectLst/></wps:spPr>` +
    `<wps:txbx><w:txbxContent>${lineas.map(parrafo).join("")}</w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" spcFirstLastPara="0" vert="horz" wrap="square" lIns="27432" tIns="18288"` +
    ` rIns="27432" bIns="18288" numCol="1" spcCol="0" rtlCol="0" fromWordArt="0" anchor="ctr"` +
    ` anchorCtr="0" forceAA="0" compatLnSpc="1">` +
    `<a:prstTxWarp prst="textNoShape"><a:avLst/></a:prstTxWarp><a:noAutofit/></wps:bodyPr></wps:wsp>`
  );
}

/**
 * Una flecha recta entre dos puntos, en milímetros.
 *
 * Word dibuja el conector dentro de su propio rectángulo: si el destino queda
 * arriba o a la izquierda del origen, el conector se voltea con los atributos
 * flipH / flipV en vez de admitir medidas negativas.
 *
 * `sinPunta` deja la raya pelada, que es como el formato lleva los insumos
 * hasta la operación; `punteado` la dibuja de puntos, que es como cuelga las
 * notas y los controles en proceso del margen.
 */
export function flecha({ id, x1, y1, x2, y2, sinPunta = false, punteado = false }) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const cx = Math.abs(x2 - x1);
  const cy = Math.abs(y2 - y1);
  const flip = `${x2 < x1 ? ' flipH="1"' : ""}${y2 < y1 ? ' flipV="1"' : ""}`;

  return (
    `<wps:wsp><wps:cNvPr id="${id}" name="Flecha ${id}"/>` +
    `<wps:cNvCnPr/><wps:spPr>` +
    `<a:xfrm${flip}><a:off x="${mm(x)}" y="${mm(y)}"/><a:ext cx="${mm(cx)}" cy="${mm(cy)}"/></a:xfrm>` +
    `<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>` +
    `<a:ln w="${punteado ? 3175 : 9525}"><a:solidFill><a:sysClr val="windowText" lastClr="000000"/></a:solidFill>` +
    (punteado ? `<a:prstDash val="dot"/>` : "") +
    (sinPunta ? "" : `<a:tailEnd type="triangle" w="med" len="med"/>`) +
    `</a:ln>` +
    `</wps:spPr><wps:bodyPr/></wps:wsp>`
  );
}

/** Texto suelto sobre el lienzo, sin recuadro (rótulos de etapa, notas). */
export function rotulo({ id, x, y, ancho, alto, lineas }) {
  return cuadro({ id, x, y, ancho, alto, lineas, sinBorde: true });
}

/**
 * El lienzo completo, listo para meter en un párrafo del documento.
 *
 * `ancho` y `alto` en milímetros: es el hueco que el dibujo ocupa en la
 * página, y las posiciones de las formas son relativas a él.
 */
export function lienzo({ id, ancho, alto, formas }) {
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${mm(ancho)}" cy="${mm(alto)}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="Esquema ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas">` +
    `<wpc:wpc><wpc:bg/><wpc:whole/>${formas.join("")}</wpc:wpc>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}
