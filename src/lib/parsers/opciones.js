// Lector de las opciones excluyentes del registro: los bloques que empiezan
// por "OPCION ELEGIDA:" y listan varios equipos, de los que el operario marca
// uno.
//
// En acondicionado el codificado se puede hacer con la codificadora IMAJE 9040
// (que va con la faja transportadora N° 6) o con la lotizadora HAPA N°1 o la
// N°2. Cuál se usó en cada lote sólo lo dice la casilla marcada; las tres
// líneas de texto son idénticas esté marcada la que esté.
//
// Cómo se sabe cuál está marcada: dentro del bloque, la casilla del elegido se
// dibuja con un tamaño distinto al de las demás —el visto ocupa unos 10 puntos
// y el guion unos 15—. No se compara con una medida fija, que sería casarse
// con esta edición del formulario, sino que se busca la que se sale de la
// norma dentro de su propio bloque: en una elección excluyente sólo puede
// haber una marcada, así que la distinta es esa. Comprobado contra los 13
// lotes de FLUIBRONCOL de la Adenda N° 4 y los de EVACLEAN: coincide en todos.

import { norm } from "./utils.js";
import { matchSectionHeading } from "./genericParser.js";

const INICIO_RE = /OPCI[OÓ]N\s+ELEGIDA/i;
// A partir de dónde, a la derecha, están las casillas del formulario.
const X_CASILLA_MIN = 380;
// Cuánto puede desviarse verticalmente la casilla respecto de su renglón.
const TOLERANCIA_Y = 14;
// El paso siguiente del procedimiento ("4.4.5.- ROTULAR LA LINEA...") cierra
// el bloque de opciones sin discusión.
const PASO_RE = /^\d+(\.\d+)*\s*\.-/;
// Cuántos renglones sin casilla se toleran entre dos opciones. Un bloque que
// cambia de página lleva en medio la cabecera del formulario, que ocupa una
// docena de renglones.
const MAX_SALTOS = 15;

/** La casilla que le corresponde a un renglón, si la hay. */
function casillaDe(linea, casillas) {
  return casillas.find(
    (c) => c.x >= X_CASILLA_MIN && c.y < linea.y + TOLERANCIA_Y && c.y + c.alto > linea.y - 6
  );
}

/**
 * De un bloque de opciones, cuál está marcada.
 *
 * Devuelve el índice de la elegida, o -1 si no se puede afirmar: si todas las
 * casillas miden lo mismo, o si hay más de una que se sale de la norma, no hay
 * nada que deducir y es mejor no decir nada que inventarlo.
 */
export function indiceElegido(opciones) {
  if (opciones.length < 2) return -1;

  const cuenta = new Map();
  for (const o of opciones) {
    const lado = Math.round(o.casilla.ancho);
    cuenta.set(lado, (cuenta.get(lado) || 0) + 1);
  }
  if (cuenta.size < 2) return -1;

  const unicos = [...cuenta.entries()].filter(([, n]) => n === 1);
  if (unicos.length !== 1) return -1;

  const lado = unicos[0][0];
  return opciones.findIndex((o) => Math.round(o.casilla.ancho) === lado);
}

/**
 * Los bloques de opción elegida de un registro.
 *
 * Cada bloque devuelve la sección en la que aparece y sus opciones, con cuál
 * quedó marcada.
 */
export function detectOpciones(pages) {
  // Las páginas se recorren en una sola lista porque un bloque de opciones
  // puede partirse entre dos: en el lote 2035726 las dos primeras opciones
  // quedaron al final de la página 4 y la tercera al principio de la 5.
  const lineas = [];
  for (const page of pages) {
    for (const linea of page.lines) {
      lineas.push({ linea, casillas: page.casillas || [] });
    }
  }

  const bloques = [];
  let seccion = null;

  for (let i = 0; i < lineas.length; i++) {
    const texto = norm(lineas[i].linea.text).trim();

    const encabezado = matchSectionHeading(texto);
    if (encabezado) seccion = encabezado.title;

    if (!INICIO_RE.test(texto)) continue;

    const opciones = [];
    let saltados = 0;
    let j = i + 1;

    for (; j < lineas.length; j++) {
      const { linea, casillas } = lineas[j];
      const t = norm(linea.text).trim();
      if (!t) continue;

      // El siguiente paso del procedimiento cierra el bloque siempre.
      if (PASO_RE.test(t)) break;

      const casilla = casillaDe(linea, casillas);
      if (casilla) {
        opciones.push({ texto: t, casilla });
        saltados = 0;
        continue;
      }

      // Entre dos opciones puede colarse una nota o —si el bloque cambia de
      // página— la cabecera del formulario, que son una docena de renglones.
      if (++saltados > MAX_SALTOS) break;
    }

    if (opciones.length < 2) continue;

    const elegido = indiceElegido(opciones);
    bloques.push({
      seccion,
      opciones: opciones.map((o, k) => ({ texto: o.texto, elegida: k === elegido })),
      resuelto: elegido >= 0,
    });

    i = j - 1;
  }

  return bloques;
}

// Cómo se nombra cada equipo en el informe de validación. El registro los
// llama por su rótulo de planta ("LOTIZADORA HAPA N°1", "CODIFICADORA 9040
// SERIE 8400017U") y el informe por lo que se verifica de ellos: la velocidad
// del equipo de codificado, y la de la faja que lo acompaña. Es una
// traducción, no un dato del registro, y por eso está aquí a la vista.
//
// Lo que no esté en la tabla sale con el nombre del registro, que es lo
// honesto: vale para cualquier otro producto sin inventarle un nombre.
const NOMBRES = [
  { re: /LOTIZADORA\s+HAPA\s*N?\s*[°ºo.]*\s*1/i, nombre: "Velocidad", sub: "HAPA N° 1" },
  { re: /LOTIZADORA\s+HAPA\s*N?\s*[°ºo.]*\s*2/i, nombre: "Velocidad", sub: "HAPA N° 2" },
  {
    re: /CODIFICADORA\s+9040/i,
    nombre: "Velocidad de la faja transportadora N° 6",
    sub: "IMAJE 9040",
  },
];

/** El nombre con el que la opción sale en el cuadro de parámetros. */
export function nombreDeOpcion(texto) {
  const conocido = NOMBRES.find((n) => n.re.test(texto));
  if (conocido) return { nombre: conocido.nombre, sub: conocido.sub };
  return { nombre: texto, sub: "" };
}
