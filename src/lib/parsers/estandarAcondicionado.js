// La estructura estándar del cuadro de verificación de acondicionado.
//
// El informe agrupa el acondicionado en las operaciones manuales que lo
// componen —armar la caja, encajar, embalar, sellar, apilar— y bajo cada una
// pone qué se verifica. Esa redacción no está en el registro: el registro dice
// "4.4.22.- ENCAJADO: ARMAR LA CAJA, COLOCAR 20 SOBRES Y UN FOLLETO DOBLADO,
// CERRAR LA CAJA" y el informe lo reparte en dos verificaciones distintas con
// otras palabras. Por eso los nombres van escritos aquí, como estructura fija
// del proceso.
//
// Los criterios sí salen del registro cuando están en él (ver
// acondicionado.js): cuántos sobres por caja, cómo se distribuyen en la caja
// de embalaje, cuántas caben en la parihuela. Los que no, quedan en blanco
// para completar a mano.
//
// Tomado de la Adenda N° 4 al reporte RVP-17-80(I)-01.

import { criteriosAcondicionado } from "./acondicionado.js";

export const SECCION_ACONDICIONADO = "ACONDICIONADO";

// Las bandas de operación y, bajo cada una, lo que se verifica. `criterio`
// dice de qué dato del registro sale su rango de operación.
const ESTRUCTURA = [
  {
    banda: "Armado manual de cajas - Faja transportadora",
    filas: [{ nombre: "Armado de cajas" }],
  },
  {
    banda: "Encajado manual – Faja transportadora",
    filas: [{ nombre: "Contenido por caja", criterio: "contenidoPorCaja" }],
  },
  {
    banda: "Armado manual de cajas de embalaje – Caballete de acero inoxidable + dispensador de cinta",
    filas: [{ nombre: "Armado de cajas de embalaje" }],
  },
  {
    banda: "Embalado manual – Caballete de acero inoxidable",
    filas: [
      { nombre: "Contenido por caja de embalaje", criterio: "contenidoCajaEmbalaje" },
      { nombre: "Distribución por caja de embalaje", criterio: "distribucionCajaEmbalaje" },
    ],
  },
  {
    banda: "Sellado manual de cajas de embalaje – Caballete de acero inoxidable + dispensador de cinta",
    filas: [{ nombre: "Sellado de cajas de embalaje" }],
  },
  {
    banda: "Apilamiento manual de cajas de embalaje - Parihuela",
    filas: [
      { nombre: "Número de cajas de embalaje por parihuela", criterio: "cajasPorParihuela" },
      { nombre: "Distribución por parihuela", criterio: "distribucionParihuela" },
    ],
  },
];

function identificador(texto) {
  return `estandar::${texto}`.toLowerCase().replace(/\s+/g, "-").replace(/[^\w:-]/g, "");
}

function base(label) {
  return {
    section: SECCION_ACONDICIONADO,
    label,
    baseLabel: label,
    unit: "",
    valueType: "text",
    category: "critico",
    // El resultado de cada lote lo firma quien valida, no lo dice el registro.
    value: "",
    enBlanco: true,
  };
}

/**
 * Antepone a los parámetros del registro las verificaciones manuales del
 * acondicionado, con su criterio ya leído del propio registro.
 *
 * Sólo se aplica a la etapa de acondicionado: las demás no tienen estas
 * operaciones.
 */
export function conEstandarAcondicionado(params, pages, stage) {
  if (stage !== "ACONDICIONADO") return params;

  const criterios = criteriosAcondicionado(pages);
  const estandar = [];

  for (const bloque of ESTRUCTURA) {
    estandar.push({
      ...base(bloque.banda),
      id: identificador(bloque.banda),
      // Una banda no es un parámetro: ocupa el ancho del cuadro y sólo nombra
      // la operación que viene debajo.
      banda: true,
      setpoint: "",
      sinRango: true,
    });

    for (const fila of bloque.filas) {
      const criterio = fila.criterio ? criterios[fila.criterio] || "" : "";
      estandar.push({
        ...base(fila.nombre),
        id: identificador(`${bloque.banda}::${fila.nombre}`),
        setpoint: criterio,
        // Sin criterio en el registro la casilla queda vacía, no "Referencial".
        sinRango: !criterio,
      });
    }
  }

  return [...estandar, ...params];
}
