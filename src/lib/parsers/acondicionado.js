// Lo que el registro de acondicionado dice sobre cómo se encaja, se embala y
// se apila el producto.
//
// Son las frases del procedimiento, no campos con su etiqueta y su valor, así
// que el detector genérico no las ve: "COLOCAR 20 SOBRES Y UN FOLLETO
// DOBLADO", "CONSIDERANDO LA DISTRIBUCIÓN INDICADA: 03 DE ALTO, 04 DE ANCHO Y
// 12 DE LARGO", "NIVEL MAXIMO DE APILAMIENTO : 03 NIVELES". De ahí salen los
// criterios de las verificaciones manuales del informe.
//
// Los números cambian con el producto —FLUIBRONCOL lleva 20 sobres por caja y
// EVACLEAN 4— pero la redacción es la misma, así que se leen y no se escriben.

const PASO_RE = /^\d+(\.\d+)*\s*\.-/;

// Los recuadros de firma empiezan a esta altura de la página. El texto del
// paso se lee sólo a su izquierda: si no, "Realizado", "Por" y "VB" se cuelan
// en medio de la frase y la parten.
const X_FIRMA = 465;

/**
 * El texto completo de un paso: su primera línea y las de continuación, sin
 * lo que hay en los recuadros de firma.
 */
function textoDelPaso(lineas, desde) {
  const partes = [];
  for (let i = desde; i < lineas.length; i++) {
    if (i > desde && PASO_RE.test(lineas[i].text)) break;
    const izquierda = (lineas[i].segments || [])
      .filter((s) => s.x < X_FIRMA)
      .map((s) => s.str)
      .join(" ");
    partes.push(izquierda || lineas[i].text);
  }
  return partes.join(" ").replace(/\s+/g, " ").trim();
}

/** Todas las líneas del documento, en orden, con sus segmentos. */
function lineasDe(pages) {
  const lineas = [];
  for (const page of pages) for (const l of page.lines) lineas.push(l);
  return lineas;
}

/** El texto del primer paso que contenga el patrón. */
function pasoQueDice(lineas, patron) {
  for (let i = 0; i < lineas.length; i++) {
    if (!PASO_RE.test(lineas[i].text)) continue;
    const texto = textoDelPaso(lineas, i);
    if (patron.test(texto)) return texto;
  }
  return "";
}

/**
 * Los criterios de las verificaciones manuales del acondicionado.
 *
 * Lo que no esté en el registro sale vacío: el informe lo deja en blanco para
 * completar a mano, que es preferible a rellenarlo con una suposición.
 */
export function criteriosAcondicionado(pages) {
  const lineas = lineasDe(pages);
  const criterios = {};

  // "ENCAJADO: ARMAR LA CAJA, COLOCAR 20 SOBRES Y UN FOLLETO DOBLADO, CERRAR
  // LA CAJA" -> "20 SOBRES Y UN FOLLETO DOBLADO".
  const encajado = pasoQueDice(lineas, /ENCAJADO\s*:/i);
  const contenido = encajado.match(/COLOCAR\s+(.+?)(?:,\s*CERRAR|\.\s|$)/i);
  if (contenido) criterios.contenidoPorCaja = contenido[1].trim();

  // "LA DISTRIBUCIÓN INDICADA: 03 DE ALTO, 04 DE ANCHO Y 12 DE LARGO" -> se
  // conserva el orden en que el registro las nombra, que cambia de un
  // producto a otro.
  const embalaje = pasoQueDice(lineas, /DISTRIBUCI[OÓ]N\s+INDICADA/i);
  const tras = embalaje.split(/DISTRIBUCI[OÓ]N\s+INDICADA\s*:?/i)[1] || "";
  const caras = [...tras.matchAll(/(\d+)\s*DE\s*(ALTO|ANCHO|LARGO)/gi)].map(
    (m) => `${m[1]} DE ${m[2].toUpperCase()}`
  );
  if (caras.length > 0) criterios.distribucionCajaEmbalaje = caras.join(", ");

  // "CADA CAJA DE EMBALAJE CONTIENE 144 CAJAS x 20 SOBRES" -> "144 CAJAS".
  const porCaja = pasoQueDice(lineas, /CADA\s+CAJA\s+DE\s+EMBALAJE\s+CONTIENE/i);
  const cuantas = porCaja.match(/CONTIENE\s+(\d+)\s*CAJAS/i);
  if (cuantas) criterios.contenidoCajaEmbalaje = `${cuantas[1]} CAJAS`;

  // El apilamiento se declara en dos renglones dentro del mismo paso.
  const apilamiento = pasoQueDice(lineas, /NIVEL\s+MAXIMO\s+DE\s+APILAMIENTO/i);
  const niveles = apilamiento.match(/NIVEL\s+MAXIMO\s+DE\s+APILAMIENTO\s*:?\s*(\d+)/i);
  const porNivel = apilamiento.match(/CAJAS\s+DE\s+EMBALAJE\s+POR\s+NIVEL\s*:?\s*(\d+)/i);

  if (niveles && porNivel) {
    criterios.distribucionParihuela = `${porNivel[1]} CAJAS x ${niveles[1]} NIVELES`;
    // Cuántas caben en la parihuela: las de cada nivel por el número de
    // niveles. El registro da los dos factores, no el producto.
    criterios.cajasPorParihuela = `${Number(porNivel[1]) * Number(niveles[1])} CAJAS`;
  }

  return criterios;
}
