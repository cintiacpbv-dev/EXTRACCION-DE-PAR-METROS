import { supabase, supabaseEnabled } from "./supabaseClient.js";

const LOCAL_KEY = "deteccion-parametros:documentos:v2";

/** Un documento queda identificado por producto + lote + etapa. */
export function docKey(doc) {
  return `${doc.producto}::${doc.lote}::${doc.stage}`;
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

export async function syncDocumentToSupabase(doc) {
  if (!supabaseEnabled) return { ok: true, skipped: true };

  const { data: batchRow, error: batchErr } = await supabase
    .from("batches")
    .upsert({ producto: doc.producto, lote: doc.lote }, { onConflict: "producto,lote" })
    .select()
    .single();

  if (batchErr) return { ok: false, error: batchErr.message };

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

  const { data: batchRow } = await supabase
    .from("batches")
    .select("id")
    .eq("producto", doc.producto)
    .eq("lote", doc.lote)
    .maybeSingle();

  if (!batchRow) return { ok: true };

  const { error } = await supabase
    .from("batch_values")
    .delete()
    .eq("batch_id", batchRow.id)
    .eq("stage", doc.stage);

  return error ? { ok: false, error: error.message } : { ok: true };
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

    const key = `${batch.producto}::${batch.lote}::${row.stage}`;
    if (!docs.has(key)) {
      docs.set(key, {
        producto: batch.producto,
        lote: batch.lote,
        stage: row.stage,
        fileName: row.file_name,
        meta: { producto: batch.producto, lote: batch.lote, stage: row.stage },
        params: [],
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
