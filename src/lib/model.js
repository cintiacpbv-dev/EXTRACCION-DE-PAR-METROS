import { computeStats } from "./stats.js";
import { documentoEsMuestraMedica } from "./muestraMedica.js";
import { firstWord } from "./productIdentity.js";
import { tamanosPorFamilia } from "./tamanoLote.js";

/** Categorías que se muestran en la vista "Parámetros de proceso". */
const PROCESS_VIEW = new Set(["critico", "verificacion"]);

/**
 * Un mismo lote recorre varias etapas y en cada una el registro nombra al
 * producto de forma distinta, añadiendo texto según la presentación (el
 * granel, el sachet, la caja): "FLUIBRONCOL ORAL 600mg GRN", "...GRN SAC3g",
 * "...GRN 3g CJA x20". Se agrupan bajo la misma familia los nombres que
 * comparten primera palabra (ver productIdentity.js); la familia se etiqueta
 * con el nombre más corto del grupo, que suele ser el del producto base.
 */
export function withFamilies(documents) {
  const porPrimeraPalabra = new Map();
  for (const doc of documents) {
    const clave = firstWord(doc.producto);
    const actual = porPrimeraPalabra.get(clave);
    if (!actual || doc.producto.length < actual.length) {
      porPrimeraPalabra.set(clave, doc.producto);
    }
  }

  const base = (doc) => porPrimeraPalabra.get(firstWord(doc.producto));

  // Un producto que se fabrica a dos escalas son dos validaciones distintas y
  // se separan en dos análisis; el que se fabrica siempre igual no cambia de
  // nombre (ver tamanoLote.js).
  const { porLote, familias } = tamanosPorFamilia(documents, base);

  return documents.map((doc) => {
    const familia = base(doc);
    const tamano = porLote.get(doc.lote);
    const varias = (familias.get(familia)?.size || 0) > 1;
    return {
      ...doc,
      tamanoLote: tamano || null,
      familia: varias && tamano ? `${familia} · ${tamano}` : familia,
    };
  });
}

/**
 * Identidad de la columna de un lote.
 *
 * Un mismo lote fabrica a la vez producto de venta y muestra medica: el
 * 2036006 trae "...3g CJA x20" y "...3g CJA x2MM" bajo Acondicionado, cada
 * uno con su propia orden, su propia receta y sus propios parametros. Es el
 * mismo numero de lote pero no el mismo producto, asi que indexar las
 * columnas solo por el numero haria que una presentacion pisara a la otra.
 * La muestra medica se rotula aparte para poder distinguirlas. Se reconoce
 * con el mismo criterio que usa el boton de omitir muestras medicas, para
 * que lo que se omite y lo que lleva columna propia sean siempre lo mismo.
 */
export function claveLote(doc) {
  return documentoEsMuestraMedica(doc) ? `${doc.lote} MM` : doc.lote;
}

export function listProducts(documents) {
  return [...new Set(documents.map((d) => d.familia))].sort();
}

/**
 * Un resumen por producto para la pantalla de inicio: lotes cargados, etapas
 * presentes, total de parámetros detectados y cuándo se tocó por última vez.
 * Es la base de la "biblioteca" de análisis guardados.
 */
export function summarizeProducts(documents) {
  const porFamilia = new Map();

  for (const doc of documents) {
    if (!porFamilia.has(doc.familia)) {
      porFamilia.set(doc.familia, {
        familia: doc.familia,
        lotes: new Set(),
        etapas: new Set(),
        totalParams: 0,
        totalDocs: 0,
        updatedAt: null,
      });
    }
    const s = porFamilia.get(doc.familia);
    s.lotes.add(doc.lote);
    s.etapas.add(doc.stage);
    s.totalParams += doc.params.length;
    s.totalDocs += 1;
    if (doc.uploadedAt && (!s.updatedAt || doc.uploadedAt > s.updatedAt)) s.updatedAt = doc.uploadedAt;
  }

  return [...porFamilia.values()]
    .map((s) => ({
      ...s,
      lotes: [...s.lotes].sort(),
      etapas: [...s.etapas].sort((a, b) => ordenEtapa(a) - ordenEtapa(b) || a.localeCompare(b)),
    }))
    .sort((a, b) => a.familia.localeCompare(b.familia));
}

// Orden natural del proceso, sólo para presentar las pestañas. Es una
// preferencia, no una restricción: una etapa que no esté aquí se muestra igual,
// ordenada alfabéticamente después de las conocidas.
const ORDEN_ETAPAS = [
  "FABRICACION",
  "GRANULACION",
  "COMPRESION",
  "RECUBRIMIENTO",
  "LAVADO",
  "ENVASE",
  "ACONDICIONADO",
  "INSPECCION",
  "EMPAQUE",
];

function ordenEtapa(stage) {
  const i = ORDEN_ETAPAS.indexOf(stage);
  return i === -1 ? ORDEN_ETAPAS.length : i;
}

/** Compara dos etapas por el orden natural del proceso. Para usar en `.sort()`. */
export function compararEtapas(a, b) {
  return ordenEtapa(a) - ordenEtapa(b) || a.localeCompare(b);
}

/** Etapas encontradas para un producto, en el orden en que ocurren. */
export function listStages(documents, familia) {
  const stages = [];
  for (const doc of documents) {
    if (doc.familia !== familia) continue;
    if (!stages.includes(doc.stage)) stages.push(doc.stage);
  }
  return stages.sort((a, b) => ordenEtapa(a) - ordenEtapa(b) || a.localeCompare(b));
}

/**
 * Construye la tabla maestra de una etapa: la unión ordenada de los parámetros
 * detectados en todos los lotes, agrupada por sección, con una columna por lote
 * y las estadísticas calculadas sobre los valores numéricos.
 *
 * Si un lote no registró un parámetro que otro sí trae, la celda queda vacía;
 * así la comparación entre lotes nunca desalinea las filas.
 */
export function buildTable(documents, familia, stage, { onlyCritical = true } = {}) {
  const docs = documents.filter((d) => d.familia === familia && d.stage === stage);
  const lotes = [...new Set(docs.map(claveLote))].sort();

  const rowsById = new Map();
  const sectionOrder = [];

  for (const doc of docs) {
    for (const p of doc.params) {
      if (onlyCritical && !PROCESS_VIEW.has(p.category)) continue;

      if (!sectionOrder.includes(p.section)) sectionOrder.push(p.section);

      if (!rowsById.has(p.id)) {
        rowsById.set(p.id, {
          id: p.id,
          section: p.section,
          label: p.label,
          setpoint: p.setpoint,
          unit: p.unit,
          valueType: p.valueType,
          category: p.category,
          values: {},
        });
      }

      const row = rowsById.get(p.id);
      row.values[claveLote(doc)] = p.value;
      if (p.valueType === "number") row.valueType = "number";
      if (!row.setpoint && p.setpoint) row.setpoint = p.setpoint;
      if (!row.unit && p.unit) row.unit = p.unit;
    }
  }

  const bySection = new Map();
  for (const row of rowsById.values()) {
    if (!bySection.has(row.section)) bySection.set(row.section, []);
    const serie = lotes.map((l) => row.values[l]).filter((v) => typeof v === "number");
    row.stats = row.valueType === "number" ? computeStats(serie) : null;
    bySection.get(row.section).push(row);
  }

  const sections = sectionOrder
    .filter((s) => bySection.has(s))
    .map((title) => ({ title, rows: bySection.get(title) }));

  return { familia, stage, lotes, sections, rowCount: rowsById.size };
}

/**
 * Une los operarios ("Realizado / Por") y supervisores ("VB") de todos los
 * lotes cargados de un producto en una etapa, sumando cuántas veces
 * intervino cada uno.
 */
export function aggregatePersonnel(documents, familia, stage) {
  const docsStage = documents.filter((d) => d.familia === familia && d.stage === stage);

  const sum = (role) => {
    const counter = new Map();
    for (const doc of docsStage) {
      for (const { name, count } of doc.personnel?.[role] || []) {
        counter.set(name, (counter.get(name) || 0) + count);
      }
    }
    return [...counter.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };

  return { operarios: sum("operarios"), supervisores: sum("supervisores") };
}
