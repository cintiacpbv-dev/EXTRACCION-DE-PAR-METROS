// La estructura estándar del cuadro de verificación de acondicionado.
//
// El informe de validación agrupa el acondicionado en las operaciones
// manuales que lo componen —armar la caja, encajar, embalar, sellar, apilar—
// y bajo cada una pone qué se verifica. Esa redacción no está en el registro
// de manufactura: el registro dice "4.4.22.- ENCAJADO: ARMAR LA CAJA,
// COLOCAR 20 SOBRES Y UN FOLLETO DOBLADO, CERRAR LA CAJA", y el informe lo
// reparte en dos verificaciones distintas con otras palabras.
//
// Por eso va aquí escrito, como estructura estándar del proceso, y no
// deducido. Las casillas —el criterio de cada verificación y el resultado de
// cada lote— quedan en blanco: unas dependen del producto (cuántos sobres por
// caja, cuántas cajas por parihuela) y las otras las firma quien valida.
//
// Tomado de la Adenda N° 4 al reporte RVP-17-80(I)-01.

export const SECCION_ACONDICIONADO = "ACONDICIONADO";

/**
 * Las bandas de operación y, bajo cada una, lo que se verifica.
 *
 * Una banda ocupa el ancho del cuadro y no lleva datos; una verificación es
 * una fila normal con su nombre a la izquierda.
 */
const ESTRUCTURA = [
  {
    banda: "Armado manual de cajas - Faja transportadora",
    filas: ["Armado de cajas"],
  },
  {
    banda: "Encajado manual – Faja transportadora",
    filas: ["Contenido por caja"],
  },
  {
    banda: "Armado manual de cajas de embalaje – Caballete de acero inoxidable + dispensador de cinta",
    filas: ["Armado de cajas de embalaje"],
  },
  {
    banda: "Embalado manual – Caballete de acero inoxidable",
    filas: ["Contenido por caja de embalaje", "Distribución por caja de embalaje"],
  },
  {
    banda: "Sellado manual de cajas de embalaje – Caballete de acero inoxidable + dispensador de cinta",
    filas: ["Sellado de cajas de embalaje"],
  },
  {
    banda: "Apilamiento manual de cajas de embalaje - Parihuela",
    filas: ["Número de cajas de embalaje por parihuela", "Distribución por parihuela"],
  },
];

function identificador(texto) {
  return `estandar::${texto}`.toLowerCase().replace(/\s+/g, "-").replace(/[^\w:-]/g, "");
}

/**
 * La sección estándar del acondicionado, con la forma de una sección de
 * buildTable para poder insertarla junto a las que salen del registro.
 */
export function seccionEstandarAcondicionado() {
  const rows = [];

  for (const bloque of ESTRUCTURA) {
    rows.push({
      id: identificador(bloque.banda),
      section: SECCION_ACONDICIONADO,
      label: bloque.banda,
      // Una banda no es un parámetro: ocupa el ancho del cuadro y sólo dice
      // qué operación viene a continuación.
      banda: true,
      setpoint: "",
      sinRango: true,
      unit: "",
      valueType: "text",
      category: "critico",
      values: {},
    });

    for (const nombre of bloque.filas) {
      rows.push({
        id: identificador(`${bloque.banda}::${nombre}`),
        section: SECCION_ACONDICIONADO,
        label: nombre,
        setpoint: "",
        sinRango: true,
        // El criterio y el resultado de cada lote se completan a mano: unos
        // dependen del producto (cuántos sobres por caja, cuántas cajas por
        // parihuela) y los otros los firma quien valida.
        enBlanco: true,
        unit: "",
        valueType: "text",
        category: "critico",
        values: {},
      });
    }
  }

  return { title: SECCION_ACONDICIONADO, rotulo: SECCION_ACONDICIONADO, rows };
}
