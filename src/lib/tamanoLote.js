// A qué escala se fabricó cada lote.
//
// Un mismo producto se fabrica en más de un tamaño de lote —EVACLEAN tiene
// lotes de 200 kg y de 390 kg— y cada escala es una validación aparte: sus
// propios lotes, sus propios cuadros, su propio protocolo. Compararlos entre
// sí no dice nada, porque no son el mismo proceso.
//
// La escala la fija la etapa de fabricación, no las de después: en
// FLUIBRONCOL todos los lotes se fabrican a 200 kg y luego se envasan en
// sachets de 11 876, 54 104 o 65 980 unidades según la presentación. Esas
// diferencias son de presentación, no de escala, y no deben partir nada.

const ETAPA_QUE_MANDA = "FABRICACION";

/** "390.000" + "kg" → "390 kg". Sin unidad, sólo el número. */
export function etiquetaTamano(teorico, unidad) {
  if (!teorico) return null;
  const n = parseFloat(String(teorico).replace(/\s+/g, "").replace(",", "."));
  if (Number.isNaN(n)) return null;
  const numero = Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
  return unidad ? `${numero} ${unidad}` : numero;
}

function tamanoDe(doc) {
  return etiquetaTamano(doc.meta?.teorico, doc.meta?.teoricoUnidad);
}

/**
 * El tamaño de cada lote, resuelto para todas sus etapas.
 *
 * Manda lo que diga su registro de fabricación. Un lote del que sólo se
 * cargaron etapas posteriores no lo declara en kilos, así que se deduce por
 * correspondencia: si en otro lote un envase de 3 484 sobres acompaña a una
 * fabricación de 390 kg, un envase de 3 484 sobres es de 390 kg. Es lo mismo
 * que se haría a mano mirando otro lote de la misma familia.
 */
export function tamanoPorLote(documents) {
  const porLote = new Map();
  const correspondencia = new Map();

  for (const doc of documents) {
    const tamano = tamanoDe(doc);
    if (!tamano) continue;
    if (doc.stage !== ETAPA_QUE_MANDA) continue;
    porLote.set(doc.lote, tamano);
  }

  // Con los lotes ya resueltos se aprende qué tamaño de cada etapa posterior
  // corresponde a qué escala de fabricación.
  for (const doc of documents) {
    const tamano = tamanoDe(doc);
    if (!tamano || doc.stage === ETAPA_QUE_MANDA) continue;
    const deFabricacion = porLote.get(doc.lote);
    if (deFabricacion) correspondencia.set(`${doc.stage}::${tamano}`, deFabricacion);
  }

  for (const doc of documents) {
    if (porLote.has(doc.lote)) continue;
    const tamano = tamanoDe(doc);
    if (!tamano) continue;
    const equivalente = correspondencia.get(`${doc.stage}::${tamano}`);
    // Sin equivalencia conocida se usa lo que el propio documento declara: es
    // menos preciso, pero separa igual dos escalas distintas, que es de lo
    // que se trata.
    porLote.set(doc.lote, equivalente || tamano);
  }

  return porLote;
}

/**
 * Los tamaños distintos que tiene cada familia de producto.
 *
 * Sólo se parte lo que de verdad tiene más de una escala: si un producto se
 * fabrica siempre igual, su análisis se queda como estaba y no cambia de
 * nombre por nada.
 */
export function tamanosPorFamilia(documents, familiaDe) {
  const porLote = tamanoPorLote(documents);
  const familias = new Map();

  for (const doc of documents) {
    const familia = familiaDe(doc);
    if (!familias.has(familia)) familias.set(familia, new Set());
    const tamano = porLote.get(doc.lote);
    if (tamano) familias.get(familia).add(tamano);
  }

  return { porLote, familias };
}
