// Dónde están dibujadas las casillas de verificación de cada página.
//
// El registro de manufactura marca las casillas con una imagen diminuta —un
// visto o un guion— que no aparece en la capa de texto del PDF. Sin leerla no
// hay manera de saber cuál de las opciones de un "OPCION ELEGIDA" eligió el
// operario: las tres líneas ("CODIFICADORA 9040...", "LOTIZADORA HAPA N°1",
// "LOTIZADORA HAPA N°2") se leen exactamente igual esté marcada la que esté.
//
// Aquí sólo se recogen la posición y el tamaño de esas imágenes. Qué
// significan lo decide parsers/opciones.js.

// Las casillas del formulario rondan los 10-15 puntos de lado. El filtro deja
// fuera el logotipo de la cabecera y cualquier ilustración.
const LADO_MIN = 5;
const LADO_MAX = 30;
const RELACION_MAX = 1.6; // aproximadamente cuadradas

/**
 * Las casillas dibujadas en una página, en el mismo sistema de coordenadas
 * que las líneas de texto (origen abajo a la izquierda).
 *
 * Se recorre la lista de operadores de dibujo llevando la cuenta de la matriz
 * de transformación, que es lo que dice dónde acaba pintada cada imagen.
 */
export async function casillasDePagina(pdfjsLib, page) {
  const { OPS, Util } = pdfjsLib;

  let ops;
  try {
    ops = await page.getOperatorList();
  } catch {
    // Sin la lista de operadores se pierde la lectura de las casillas, pero
    // no el resto del análisis.
    return [];
  }

  const casillas = [];
  const pila = [];
  let matriz = [1, 0, 0, 1, 0, 0];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];

    if (fn === OPS.save) {
      pila.push(matriz.slice());
      continue;
    }
    if (fn === OPS.restore) {
      matriz = pila.pop() || matriz;
      continue;
    }
    if (fn === OPS.transform) {
      matriz = Util.transform(matriz, ops.argsArray[i]);
      continue;
    }
    if (fn !== OPS.paintImageXObject && fn !== OPS.paintImageMaskXObject) continue;

    // La imagen se pinta en el cuadrado unidad, así que sus esquinas
    // transformadas dan el rectángulo real.
    const a = [0, 0];
    const b = [1, 1];
    Util.applyTransform(a, matriz);
    Util.applyTransform(b, matriz);

    const ancho = Math.abs(b[0] - a[0]);
    const alto = Math.abs(b[1] - a[1]);
    if (ancho < LADO_MIN || ancho > LADO_MAX || alto < LADO_MIN || alto > LADO_MAX) continue;
    if (Math.max(ancho, alto) / Math.min(ancho, alto) > RELACION_MAX) continue;

    casillas.push({
      x: Math.min(a[0], b[0]),
      y: Math.min(a[1], b[1]),
      ancho,
      alto,
    });
  }

  return casillas;
}
