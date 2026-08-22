import { supabase, supabaseEnabled } from "./supabaseClient.js";
import { documentKey, firstWord, slotKey } from "./productIdentity.js";

const LOCAL_KEY = "deteccion-parametros:documentos:v2";

/** Producto (primera palabra) + lote + etapa + tipo de documento. */
export function docKey(doc) {
  return documentKey(doc);
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
  const { data, error } = await supabase
    .from("batches")
    .select("*")
    .eq("lote", lote)
    .order("created_at", { ascending: true });
  if (error || !data) return { row: null, error };

  // Se prefiere el nombre exacto; si no está, cualquiera de la misma familia.
  // El orden por fecha de creación hace la elección estable entre llamadas,
  // para no repartir las etapas de un mismo lote en filas distintas.
  const mismos = data.filter((b) => firstWord(b.producto) === firstWord(producto));
  const exacto = mismos.find((b) => b.producto === producto);
  return { row: exacto || mismos[0] || null, error: null };
}

// PostgREST devuelve como máximo 1000 filas por consulta. Con varios lotes se
// supera ese tope enseguida, así que hay que pedir la tabla por tramos: sin
// esto se cargaban datos incompletos sin ningún aviso.
const PAGE_SIZE = 1000;

async function selectAll(tabla, orderBy) {
  const filas = [];

  for (let desde = 0; ; desde += PAGE_SIZE) {
    let query = supabase.from(tabla).select("*").range(desde, desde + PAGE_SIZE - 1);
    if (orderBy) query = query.order(orderBy, { ascending: true });

    const { data, error } = await query;
    if (error) return { data: null, error };

    filas.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return { data: filas, error: null };
}

export async function syncDocumentToSupabase(doc) {
  if (!supabaseEnabled) return { ok: true, skipped: true };

  const { row: existing, error: findErr } = await findBatchRow(doc.producto, doc.lote);
  if (findErr) return { ok: false, error: findErr.message };

  const receta = doc.meta?.receta || null;
  // La columna "receta" es de la migración v5: si un proyecto todavía no la
  // corrió, no debe bloquear la creación del lote, que es lo esencial.
  let recetaWarning = null;

  let batchRow = existing;
  if (!batchRow) {
    const { data, error } = await supabase
      .from("batches")
      .insert({ producto: doc.producto, lote: doc.lote, receta })
      .select()
      .single();
    if (!error) {
      batchRow = data;
    } else {
      const { data: data2, error: error2 } = await supabase
        .from("batches")
        .insert({ producto: doc.producto, lote: doc.lote })
        .select()
        .single();
      if (error2) return { ok: false, error: error2.message };
      batchRow = data2;
      recetaWarning = "falta columna";
    }
  } else if (receta && batchRow.receta !== receta) {
    // La primera etapa cargada de un lote puede no haber traído la receta
    // (por ejemplo, si sólo se subió una orden); se completa en cuanto un
    // documento posterior sí la aporta.
    const { data, error } = await supabase
      .from("batches")
      .update({ receta })
      .eq("id", batchRow.id)
      .select()
      .single();
    if (!error) batchRow = data;
    else if (batchRow.receta === undefined) recetaWarning = "falta columna";
  }

  // Una orden de producción no aporta parámetros ni personal de planta: su
  // contenido va entero a batch_orders y no toca lo que guardó el registro.
  if (doc.kind === "orden") {
    const { error } = await supabase.from("batch_orders").upsert(
      {
        batch_id: batchRow.id,
        stage: doc.stage,
        orden: doc.orden?.cabecera?.orden || null,
        producto: doc.producto,
        data: doc.orden,
        file_name: doc.fileName || null,
      },
      { onConflict: "batch_id,stage" }
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, batchId: batchRow.id, recetaWarning };
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

  // Los participantes se guardan en una tabla aparte, añadida después de la
  // primera versión del esquema (supabase_migration_v3.sql). Si un proyecto
  // todavía no corrió esa migración la tabla no existe: se avisa pero no se
  // hace fallar el guardado de los parámetros, que es lo esencial.
  let personnelWarning = null;
  const { error: delPersonnelErr } = await supabase
    .from("batch_personnel")
    .delete()
    .eq("batch_id", batchRow.id)
    .eq("stage", doc.stage);

  if (delPersonnelErr) {
    personnelWarning = delPersonnelErr.message;
  } else {
    const personnelRows = [
      ...(doc.personnel?.operarios || []).map((p) => ({ ...p, role: "operario" })),
      ...(doc.personnel?.supervisores || []).map((p) => ({ ...p, role: "supervisor" })),
    ].map((p) => ({
      batch_id: batchRow.id,
      stage: doc.stage,
      role: p.role,
      name: p.name,
      count: p.count,
    }));

    if (personnelRows.length > 0) {
      const { error } = await supabase.from("batch_personnel").insert(personnelRows);
      if (error) personnelWarning = error.message;
    }
  }

  // Los materiales de la sección INSUMOS se guardan en su propia tabla,
  // añadida después de la primera versión del esquema
  // (supabase_migration_v6.sql). Si un proyecto todavía no corrió esa
  // migración la tabla no existe: se avisa pero no se hace fallar el
  // guardado de los parámetros, que es lo esencial.
  let insumosWarning = null;
  if ((doc.insumos?.length || 0) > 0) {
    const { error } = await supabase.from("batch_insumos").upsert(
      { batch_id: batchRow.id, stage: doc.stage, data: doc.insumos, file_name: doc.fileName || null },
      { onConflict: "batch_id,stage" }
    );
    if (error) insumosWarning = error.message;
  }

  return { ok: true, batchId: batchRow.id, personnelWarning, recetaWarning, insumosWarning };
}

export async function deleteDocumentFromSupabase(doc) {
  if (!supabaseEnabled) return { ok: true, skipped: true };

  const { row: batchRow, error } = await findBatchRow(doc.producto, doc.lote);
  if (error) return { ok: false, error: error.message };
  if (!batchRow) return { ok: true };

  if (doc.kind === "orden") {
    const { error: e } = await supabase
      .from("batch_orders")
      .delete()
      .eq("batch_id", batchRow.id)
      .eq("stage", doc.stage);
    return e ? { ok: false, error: e.message } : { ok: true };
  }

  const { error: delErr } = await supabase
    .from("batch_values")
    .delete()
    .eq("batch_id", batchRow.id)
    .eq("stage", doc.stage);
  if (delErr) return { ok: false, error: delErr.message };

  // Best-effort: si batch_personnel o batch_insumos no existen todavía
  // (faltan las migraciones v3 / v6), no hace fallar el borrado de los
  // parámetros.
  await supabase.from("batch_personnel").delete().eq("batch_id", batchRow.id).eq("stage", doc.stage);
  await supabase.from("batch_insumos").delete().eq("batch_id", batchRow.id).eq("stage", doc.stage);

  return { ok: true };
}

/** Reconstruye la colección de documentos a partir de lo guardado en Supabase. */
export async function loadDocumentsFromSupabase() {
  if (!supabaseEnabled) return [];

  const { data: batchRows, error: batchErr } = await selectAll("batches");
  if (batchErr || !batchRows) return [];

  const { data: valueRows, error: valErr } = await selectAll("batch_values", "sort_order");
  if (valErr) return [];

  // batch_personnel, batch_orders y batch_insumos son best-effort: si el
  // proyecto todavía no corrió las migraciones v3 / v4 / v6, se sigue
  // cargando todo lo demás.
  const { data: personnelRows } = await selectAll("batch_personnel");
  const { data: orderRows } = await selectAll("batch_orders");
  const { data: insumosRows } = await selectAll("batch_insumos");

  const byId = new Map(batchRows.map((b) => [b.id, b]));
  const docs = new Map();

  const ensureDoc = (batch, stage, fileName) => {
    const key = slotKey({ producto: batch.producto, lote: batch.lote, stage });
    if (!docs.has(key)) {
      docs.set(key, {
        producto: batch.producto,
        lote: batch.lote,
        stage,
        fileName,
        meta: { producto: batch.producto, lote: batch.lote, stage, receta: batch.receta || null },
        params: [],
        paramIds: new Set(),
        personnel: { operarios: [], supervisores: [] },
        insumos: [],
        uploadedAt: batch.updated_at || batch.created_at || null,
      });
    }
    return docs.get(key);
  };

  for (const row of valueRows || []) {
    const batch = byId.get(row.batch_id);
    if (!batch) continue;

    // Misma casilla (primera palabra + lote + etapa) que pudo haberse llenado
    // desde más de una fila de "batches" si el nombre del producto varió; en
    // ese caso el mismo parámetro llega repetido y basta con quedarse con uno.
    const doc = ensureDoc(batch, row.stage, row.file_name);
    if (doc.paramIds.has(row.param_id)) continue;
    doc.paramIds.add(row.param_id);

    doc.params.push({
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

  for (const row of personnelRows || []) {
    const batch = byId.get(row.batch_id);
    if (!batch) continue;

    const doc = ensureDoc(batch, row.stage, null);
    const list = row.role === "supervisor" ? doc.personnel.supervisores : doc.personnel.operarios;
    const yaEsta = list.find((p) => p.name === row.name);
    if (yaEsta) yaEsta.count = Math.max(yaEsta.count, row.count);
    else list.push({ name: row.name, count: row.count });
  }

  for (const row of insumosRows || []) {
    const batch = byId.get(row.batch_id);
    if (!batch) continue;
    ensureDoc(batch, row.stage, row.file_name).insumos = row.data || [];
  }

  // Las órdenes viven en su propio documento, complementario al registro del
  // mismo lote y etapa (ver documentKey en productIdentity.js).
  const ordenes = (orderRows || []).map((row) => {
    const batch = byId.get(row.batch_id);
    if (!batch) return null;
    return {
      kind: "orden",
      producto: row.producto || batch.producto,
      lote: batch.lote,
      stage: row.stage,
      fileName: row.file_name,
      meta: { producto: row.producto || batch.producto, lote: batch.lote, stage: row.stage },
      params: [],
      personnel: { operarios: [], supervisores: [] },
      orden: row.data,
      uploadedAt: row.updated_at || row.created_at || null,
    };
  });

  // paramIds sólo sirve para deduplicar durante la reconstrucción; no forma
  // parte del documento que se guarda ni se compara más adelante.
  const registros = [...docs.values()].map(({ paramIds: _paramIds, ...doc }) => ({
    ...doc,
    kind: "registro",
  }));

  return [...registros, ...ordenes.filter(Boolean)];
}
