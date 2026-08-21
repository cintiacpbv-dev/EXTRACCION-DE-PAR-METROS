import { supabase, supabaseEnabled } from "./supabaseClient.js";
import { firstWord, slotKey } from "./productIdentity.js";

const LOCAL_KEY = "deteccion-parametros:documentos:v2";

/** Un documento queda identificado por producto (primera palabra) + lote + etapa. */
export function docKey(doc) {
  return slotKey(doc);
}

export function loadLocalDocuments() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalDocuments(documents) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(documents));
}

/** Inserta o reemplaza un documento dentro de la colección en memoria. */
export function upsertDocument(documents, doc) {
  const key = docKey(doc);
  const next = documents.filter((d) => docKey(d) !== key);
  next.push(doc);
  return next;
}

/**
 * Busca en Supabase la fila de "batches" que corresponde a este documento,
 * comparando por primera palabra del producto y lote (no por el nombre
 * completo: el mismo lote puede traer texto adicional según la presentación).
 */
async function findBatchRow(producto, lote) {
  const { data, error } = await supabase.from("batches").select("*").eq("lote", lote);
  if (error || !data) return { row: null, error };
  return { row: data.find((b) => firstWord(b.producto) === firstWord(producto)) || null, error: null };
}

export async function syncDocumentToSupabase(doc) {
  if (!supabaseEnabled) return { ok: true, skipped: true };

  const { row: existing, error: findErr } = await findBatchRow(doc.producto, doc.lote);
  if (findErr) return { ok: false, error: findErr.message };

  let batchRow = existing;
  if (!batchRow) {
    const { data, error } = await supabase
      .from("batches")
      .insert({ producto: doc.producto, lote: doc.lote })
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    batchRow = data;
  }

  // Se reemplazan los valores de esta etapa: al volver a procesar un PDF, los
  // parámetros detectados pueden cambiar y no deben quedar filas huérfanas.
  const { error: delErr } = await supabase
    .from("batch_values")
    .delete()
    .eq("batch_id", batchRow.id)
    .eq("stage", doc.stage);
  if (delErr) return { ok: false, error: delErr.message };

  const rows = doc.params.map((p, index) => ({
    batch_id: batchRow.id,
    stage: doc.stage,
    param_id: p.id,
    label: p.label,
    section: p.section,
    setpoint: p.setpoint || null,
    unit: p.unit || null,
    category: p.category,
    value_number: typeof p.value === "number" ? p.value : null,
    value_text: typeof p.value === "string" ? p.value : null,
    sort_order: index,
    file_name: doc.fileName || null,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("batch_values").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true, batchId: batchRow.id };
}

export async function deleteDocumentFromSupabase(doc) {
  if (!supabaseEnabled) return { ok: true, skipped: true };

  const { row: batchRow, error } = await findBatchRow(doc.producto, doc.lote);
  if (error) return { ok: false, error: error.message };
  if (!batchRow) return { ok: true };

  const { error: delErr } = await supabase
    .from("batch_values")
    .delete()
    .eq("batch_id", batchRow.id)
    .eq("stage", doc.stage);

  return delErr ? { ok: false, error: delErr.message } : { ok: true };
}

/** Reconstruye la colección de documentos a partir de lo guardado en Supabase. */
export async function loadDocumentsFromSupabase() {
  if (!supabaseEnabled) return [];

  const { data: batchRows, error: batchErr } = await supabase.from("batches").select("*");
  if (batchErr || !batchRows) return [];

  const { data: valueRows, error: valErr } = await supabase
    .from("batch_values")
    .select("*")
    .order("sort_order", { ascending: true });
  if (valErr) return [];

  const byId = new Map(batchRows.map((b) => [b.id, b]));
  const docs = new Map();

  for (const row of valueRows || []) {
    const batch = byId.get(row.batch_id);
    if (!batch) continue;

    // Misma casilla (primera palabra + lote + etapa) que pudo haberse llenado
    // desde más de una fila de "batches" si el nombre del producto varió.
    const key = slotKey({ producto: batch.producto, lote: batch.lote, stage: row.stage });
    if (!docs.has(key)) {
      docs.set(key, {
        producto: batch.producto,
        lote: batch.lote,
        stage: row.stage,
        fileName: row.file_name,
        meta: { producto: batch.producto, lote: batch.lote, stage: row.stage },
        params: [],
        uploadedAt: batch.updated_at || batch.created_at || null,
      });
    }

    docs.get(key).params.push({
      id: row.param_id,
      section: row.section || "GENERAL",
      label: row.label || row.param_id,
      baseLabel: row.label || row.param_id,
      setpoint: row.setpoint || "",
      unit: row.unit || "",
      category: row.category || "critico",
      valueType: row.value_number !== null ? "number" : "text",
      value: row.value_number !== null ? row.value_number : row.value_text,
    });
  }

  return [...docs.values()];
}
