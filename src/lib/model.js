import { computeStats } from "./stats.js";

/** Categorías que se muestran en la vista "Parámetros de proceso". */
const PROCESS_VIEW = new Set(["critico", "verificacion"]);

/**
 * Un mismo lote recorre varias etapas y en cada una el registro nombra al
 * producto con un código distinto (el granel, el sachet, la caja). Para
 * comparar el lote completo se agrupa por familia: el nombre más corto de
 * los que comparten número de lote, que es siempre el del producto base.
 */
export function withFamilies(documents) {
  const porLote = new Map();
  for (const doc of documents) {
    if (!porLote.has(doc.lote)) porLote.set(doc.lote, []);
    porLote.get(doc.lote).push(doc.producto);
  }

  const familiaPorLote = new Map();
  for (const [lote, productos] of porLote) {
    const familia = productos.reduce((a, b) => (b.length < a.length ? b : a), productos[0]);
    familiaPorLote.set(lote, familia);
  }

  return documents.map((doc) => ({ ...doc, familia: familiaPorLote.get(doc.lote) || doc.producto }));
}

export function listProducts(documents) {
  return [...new Set(documents.map((d) => d.familia))].sort();
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
  const lotes = [...new Set(docs.map((d) => d.lote))].sort();

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
      row.values[doc.lote] = p.value;
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
