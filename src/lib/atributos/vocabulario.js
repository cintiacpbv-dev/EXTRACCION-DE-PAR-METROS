// Qué es un ATRIBUTO DE CALIDAD y qué es un PARÁMETRO DE PROCESO.
//
// La distinción es la de ICH Q8 y es la que da sentido a toda esta sección:
//
//   * Un parámetro de proceso es algo que se AJUSTA en el equipo: la
//     temperatura de la chaqueta, las rpm del agitador, la presión de los
//     rodillos, el tiempo de agitación.
//   * Un atributo de calidad es algo que se MIDE DEL PRODUCTO: la dureza de
//     la cápsula, el pH del bulk, los grados Brix de la gelatina, la
//     hermeticidad del blíster, la desintegración.
//
// El registro de manufactura trae los dos mezclados en las mismas tablas,
// porque a quien fabrica le da igual: anota lo que le toca anotar. Separarlos
// es lo primero que hay que hacer para poder decir qué parámetro afecta a qué
// atributo.
//
// Esta lista NO se adivinó: salió de leer los cuatro registros reales
// —cápsula blanda (fabricación, envase, acondicionado) y crema— y separar a
// mano cada lectura. Lo que se midió está en la prueba.
//
// Igual que el vocabulario de parámetros, esto crecerá con cada forma
// farmacéutica nueva. Por eso la sección enseña siempre qué separó y de dónde
// lo sacó: quien valida tiene que poder corregirlo, no confiar a ciegas.

import { normalizarTermino } from "../vocabulario.js";

/**
 * Magnitudes que se miden DEL PRODUCTO.
 *
 * Ordenadas por familia para poder revisarlas. Las que llevan comentario son
 * las que se vieron en los registros reales; el resto son de la misma familia
 * y se añaden porque nombrarlas cuesta lo mismo que dejarlas fuera.
 */
const ATRIBUTOS = [
  // --- lo que se midió en el registro de cápsula blanda ---
  "DUREZA", //            DUREZA FINAL DE CAPSULA SECA [5 kp - 18 kp]
  "DESINTEGRACION", //    DESINTEGRACION, en el rango de aceptación final
  "PESO PROMEDIO", //     PESO PROMEDIO (CONTENIDO)
  "PESO ESPECIFICO", //   PESO ESPECIFICO del bulk
  "GRADOS BRIX", //       GRADOS BRIX (4.4.27) [61.5°bx - 63.5°bx] de la gelatina
  "PORCENTAJE DE SELLADO", // [MAYOR O IGUAL A 60%]
  "ESPESOR DE LA PARED", //   ESPESOR DE LA PARED DE GELATINA [0.80 - 0.95 mm]
  "HUMEDAD FINAL", //     HUMEDAD FINAL DE BULK [6-10%] y DE GELATINA [4-14%]
  "AUSENCIA DE BURBUJAS", //  control visual de la gelatina desaireada
  // --- lo que se midió en envase ---
  "HERMETICIDAD", //      HERMETICIDAD del blíster
  "FORMADO", //           FORMADO del blíster
  "CORTE", //             CORTE del blíster
  "SELLADO", //           SELLADO del blíster — va con los tres de arriba: los
  //                      cuatro son la misma verificación del blíster vacío.
  //                      "TEMPERATURA DE SELLADO" y "TIEMPO DE SELLADO DE
  //                      BOLSAS" siguen siendo parámetros: SIEMPRE_PARAMETRO
  //                      manda, y los dos empiezan por su magnitud.
  // --- lo que se midió en acondicionado ---
  "CONTENIDO POR CAJA", // [20 BLISTERS, 01 FOLLETO DENTRO]
  "ENCAJADO",
  // --- de la misma familia, aunque no estuvieran en estos cuatro ---
  "DISOLUCION",
  "FRIABILIDAD",
  "UNIFORMIDAD DE CONTENIDO",
  "UNIFORMIDAD DE MASA",
  "UNIFORMIDAD DE DOSIS",
  "VALORACION",
  "POTENCIA",
  "IMPUREZAS",
  "VISCOSIDAD",
  "EXTENSIBILIDAD",
  "ASPECTO",
  "COLOR",
  "OLOR",
  "TURBIDEZ",
  "CONDUCTIVIDAD",
  "PARTICULAS VISIBLES",
  "ESTERILIDAD",
  "ENDOTOXINAS",
  "BIOCARGA",
  "VOLUMEN DE LLENADO",
  "VOLUMEN EXTRAIBLE",
  "INTEGRIDAD DEL SELLO",
  "LEGIBILIDAD",
];

/**
 * Magnitudes que se miden del producto SÓLO cuando la etiqueta las sitúa en
 * él, porque el mismo nombre vale para las dos cosas.
 *
 * "pH" del bulk es un atributo; "pH del agua de enjuague" es un control de
 * limpieza. "PESO NETO" de una fase es dosificación —un parámetro— y "PESO
 * PROMEDIO" de la cápsula es un atributo. Aquí sólo entran los que traen un
 * criterio de aceptación impreso: sin criterio no se está midiendo contra
 * nada, y en un registro eso suele ser una anotación de trabajo.
 */
const ATRIBUTOS_CON_CRITERIO = ["PH", "HUMEDAD", "ESPESOR", "RENDIMIENTO"];

/**
 * Magnitudes que son SIEMPRE parámetro de proceso, por mucho que su nombre se
 * parezca a un atributo.
 *
 * Esta lista manda sobre las de arriba y es la que evita el error que más
 * ensucia el cuadro: "TEMPERATURA DE SELLADO" (150-225 °C, la que se pone en
 * la selladora) no es el sellado del blíster, y "TIEMPO DE SELLADO DE BOLSAS"
 * tampoco. Son ajustes de máquina que AFECTAN a un atributo — que es
 * justamente lo que la sección tiene que relacionar, no confundir.
 */
const SIEMPRE_PARAMETRO =
  /^(TEMPERATURA|TIEMPO|VELOCIDAD|PRESION|PRESIÓN|NIVEL|N\s|FORMATO|TROQUEL|MEDIDA REFERENCIAL|CODIGO|CANTIDAD|PISTON|AJUSTE)\b/;

// La humedad relativa de la sala no es un atributo del producto por mucho que
// se llame "humedad": es la condición ambiental en la que se trabaja, y sale
// en la cabecera de cada etapa de los cuatro registros. Sin esta regla era el
// "atributo" más repetido de todos, en las cuatro — y ninguna vez de verdad.
//
// Sin anclar al principio a propósito: el registro escribe "HUMEDAD RELATIVA
// (INICIO)" pero el protocolo la pone dentro de su grupo, "Condiciones
// ambientales · Humedad relativa", y ahí la magnitud no abre la etiqueta.
const AMBIENTAL = /\bHUMEDAD RELATIVA\b|\bCONDICIONES AMBIENTALES\b/;

const NORMALIZADOS = ATRIBUTOS.map(normalizarTermino);
const CON_CRITERIO = ATRIBUTOS_CON_CRITERIO.map(normalizarTermino);

/** Si el texto nombra el término como palabra completa, no como trozo. */
function nombra(texto, termino) {
  return ` ${texto} `.includes(` ${termino} `);
}

/**
 * Si una lectura del registro es un atributo de calidad del producto.
 *
 * Devuelve el nombre de la magnitud reconocida, o null. Se devuelve el nombre
 * y no un booleano porque es lo que se escribe en el cuadro: la etiqueta del
 * registro dice "DUREZA FINAL DE CAPSULA SECA" y el atributo se llama
 * "DUREZA", y así dos registros que lo escriben distinto caen en el mismo.
 */
export function atributoDe(lectura) {
  // Lo que va entre paréntesis es una nota, no la magnitud. El protocolo
  // escribe "Peso del IFA (Sujeto a ajuste por potencia)" —que es el peso a
  // dispensar, no la potencia del producto— y sin quitar el paréntesis esa
  // fila se colaba como atributo en las dos formas farmacéuticas.
  const etiqueta = normalizarTermino(String(lectura?.label ?? "").replace(/\([^)]*\)/g, " "));
  if (!etiqueta) return null;
  if (SIEMPRE_PARAMETRO.test(etiqueta) || AMBIENTAL.test(etiqueta)) return null;

  // Un atributo se mide: tiene una lectura anotada, o un criterio contra el
  // que compararla, o las dos. Sin ninguna de las dos cosas la fila es el
  // título de una operación —"Armado manual de cajas – Faja transportadora"—
  // y en acondicionado hay seis de esas por cada lectura de verdad.
  const tieneLectura = String(lectura?.value ?? "").trim() !== "";
  const tieneCriterio = String(lectura?.setpoint ?? "").trim() !== "";
  if (!tieneLectura && !tieneCriterio) return null;

  for (const termino of NORMALIZADOS) {
    if (nombra(etiqueta, termino)) return termino;
  }
  if (lectura?.setpoint) {
    for (const termino of CON_CRITERIO) {
      if (nombra(etiqueta, termino)) return termino;
    }
  }
  return null;
}

/** Los términos en uso, para poder enseñarlos y revisarlos. */
export function atributosConocidos() {
  return [...NORMALIZADOS, ...CON_CRITERIO];
}
