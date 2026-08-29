// Cómo se llama en el esquema cada sección del registro de manufactura.
//
// El registro nombra las secciones por el trabajo administrativo
// ("PREPARACION DE LA SOLUCION GRANULANTE", "TAMIZADO Y MEZCLA") y el esquema
// las nombra por el verbo de la operación ("DISOLVER", "MEZCLAR"). Es una
// traducción, no un dato: por eso está aquí a la vista y no escondida en el
// código que dibuja.
//
// Tomado de los Formato 01 de PYRIDIUM, DOLORAL, FLUIBRONCOL, SOLUNA y
// BUMEJORAL. Lo que no esté en la tabla sale con el nombre del registro, que
// es lo honesto: vale para cualquier producto sin inventarle un verbo.

const NOMBRES = [
  [/SOLUCION\s+GRANULANTE/i, "DISOLVER"],
  [/SUSPENSION\s+DE\s+RECUBRIMIENTO/i, "DISPERSAR"],
  [/TAMIZADO\s+Y\s+MEZCLA/i, "TAMIZAR Y MEZCLAR"],
  [/GRANULACI[OÓ]N\s+H[UÚ]MEDA/i, "TAMIZAR (granulación húmeda)"],
  [/GRANULACI[OÓ]N\s+SECA/i, "TAMIZAR (granulación seca)"],
  [/^AMASADO/i, "AMASAR"],
  [/^SECADO/i, "SECAR"],
  [/^MEZCLA\b/i, "MEZCLAR"],
  [/^LUBRICACION|^LUBRICACIÓN/i, "MEZCLAR (FINAL)"],
  [/^TAMIZADO/i, "TAMIZAR MANUALMENTE"],
  [/^TABLETEADO/i, "TABLETEADO"],
  [/^RECUBRIMIENTO/i, "RECUBRIMIENTO"],
  [/^HOMOGENIZACION|^HOMOGENEIZACION/i, "HOMOGENEIZAR"],
  [/^REPOSO/i, "REPOSAR"],
  [/^ENCAPSULADO/i, "ENCAPSULADO"],
  [/^ENVASE|^ENVASADO/i, "ENVASE"],
  [/IMPRESI[OÓ]N\s+DE\s+CAJAS/i, "Codificado de cajas"],
  [/OPERACI[OÓ]N\s*N\s*[°ºo.]*\s*2\s*:?\s*ACONDICIONADO/i, "ACONDICIONADO"],
];

/** El nombre con el que la operación aparece en el esquema. */
export function nombreDeOperacion(seccion) {
  const conocido = NOMBRES.find(([re]) => re.test(seccion));
  return conocido ? conocido[1] : seccion;
}
