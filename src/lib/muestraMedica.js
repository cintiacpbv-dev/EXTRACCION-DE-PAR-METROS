// Las muestras médicas se reconocen porque su descripción lleva dos emes
// mayúsculas seguidas ("CJA FLUIBRONCOL ORAL 600 GRNx2MM LTM").
//
// La comprobación distingue mayúsculas de minúsculas a propósito: "48mm" o
// "200 mm/s" aparecen a menudo en medidas y velocidades del propio registro,
// y no tienen nada que ver con una muestra médica.
const MARCA_MM = /MM/;

export function esMuestraMedica(texto) {
  return MARCA_MM.test(String(texto || ""));
}

/** ¿Alguno de los textos del documento delata una muestra médica? */
export function documentoEsMuestraMedica(doc) {
  if (esMuestraMedica(doc?.producto)) return true;
  if (esMuestraMedica(doc?.meta?.producto)) return true;
  return esMuestraMedica(doc?.orden?.cabecera?.producto);
}
