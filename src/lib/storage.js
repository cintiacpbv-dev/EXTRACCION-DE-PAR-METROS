import { supabase, supabaseEnabled } from "./supabaseClient.js";
import { documentKey, firstWord, slotKey } from "./productIdentity.js";

const LOCAL_KEY = "deteccion-parametros:documentos:v2";
const LOCAL_ELIMINADOS = "deteccion-parametros:eliminados:v1";

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

// --- eliminaciones pendientes ------------------------------------------------
//
// Borrar en Supabase se hace documento a documento y tarda. Si la página se
// recarga a mitad, lo que aún no se había borrado vuelve a leerse y reaparece
// como si nunca se hubiera eliminado. Por eso la intención de borrar se anota
// aquí: sobrevive a la recarga, oculta esos documentos aunque sigan en la
// nube, y el borrado se reintenta en el siguiente arranque hasta lograrlo.

export function cargarEliminados() {
  try {
    const raw = localStorage.getItem(LOCAL_ELIMINADOS);
    const lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function guardarEliminados(lista) {
  try {
    localStorage.setItem(LOCAL_ELIMINADOS, JSON.stringify(lista));
  } catch {
    // Sin espacio en el almacenamiento local no se puede anotar; el borrado
    // se intenta igual, sólo pierde la garantía de sobrevivir a la recarga.
  }
}

/**
 * Anota que estos documentos deben desaparecer, aunque aún no se haya podido.
 *
 * La anotación va también a Supabase: si viviera sólo en este navegador,
 * otra computadora que aún tuviera su copia local la vería como trabajo sin
 * subir y la resucitaría para todos (ver deleted_documents en la migración
 * v8).
 */
export function marcarEliminados(docs) {
  const previos = cargarEliminados();
  const claves = new Set(previos.map(docKey));

  for (const d of docs) {
    if (claves.has(docKey(d))) continue;
    claves.add(docKey(d));
    previos.push({ producto: d.producto, lote: d.lote, stage: d.stage, kind: d.kind || "registro" });
  }

  guardarEliminados(previos);
  anunciarEliminados(docs);
}

/** Deja constancia compartida, para que ninguna otra computadora los resucite. */
async function anunciarEliminados(docs) {
  if (!supabaseEnabled || docs.length === 0) return;

  const filas = docs.map((d) => ({
    clave: docKey(d),
    producto: d.producto,
    lote: d.lote,
    stage: d.stage,
    kind: d.kind || "registro",
  }));

  // Best-effort: sin la migración v8 la aplicación sigue funcionando, sólo
  // que la memoria de lo borrado no se comparte entre computadoras.
  await supabase.from("deleted_documents").upsert(filas, { onConflict: "clave" });
}

/** Quita la anotación: o ya se borró, o el usuario volvió a subir ese documento. */
export function olvidarEliminado(doc) {
  const clave = docKey(doc);
  guardarEliminados(cargarEliminados().filter((d) => docKey(d) !== clave));
}

/**
 * Olvida la eliminación en todas partes. Se usa cuando el usuario vuelve a
 * subir un documento: sin esto quedaría marcado como borrado para siempre y
 * ninguna computadora lo aceptaría.
 */
export async function readmitirDocumento(doc) {
  olvidarEliminado(doc);
  if (supabaseEnabled) {
    await supabase.from("deleted_documents").delete().eq("clave", docKey(doc));
  }
}

/**
 * Reintenta los borrados pendientes y devuelve las claves que deben seguir
 * ocultas. Se llama al arrancar, antes de mostrar nada.
 */
export async function purgarEliminados() {
  const pendientes = cargarEliminados();

  if (!supabaseEnabled) return new Set(pendientes.map(docKey));

  // A lo anotado en este navegador se suma lo que otras computadoras hayan
  // eliminado: sin esa parte, esta máquina volvería a subir su copia local
  // de algo ya borrado en otra.
  const { data: remotas } = await supabase.from("deleted_documents").select("*");
  const ocultas = new Set([...pendientes.map(docKey), ...(remotas || []).map((r) => r.clave)]);

  // Sólo se reintenta lo anotado aquí; lo de otras máquinas ya lo borró quien
  // lo eliminó.
  const quedan = [];
  for (const doc of pendientes) {
    const res = await deleteDocumentFromSupabase(doc);
    if (!res.ok && !res.skipped) quedan.push(doc);
  }
  guardarEliminados(quedan);

  return ocultas;
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
/**
 * Todas las filas de "batches" de ese lote que pertenecen a la misma familia
 * de producto.
 *
 * Son varias a propósito: cada presentación del mismo lote se guardó con su
 * propio nombre ("… GRN", "… GRN SAC3g", "… GRN 3g CJA x20"), así que un
 * lote puede tener tres filas. Al borrar hay que recorrerlas todas — mirar
 * sólo la primera dejaba datos vivos en las otras y el producto reaparecía
 * en cuanto se recargaba la página.
 */
async function findBatchRows(producto, lote) {
  const { data, error } = await supabase
    .from("batches")
    .select("*")
    .eq("lote", lote)
    .order("created_at", { ascending: true });
  if (error || !data) return { rows: [], error };

  return { rows: data.filter((b) => firstWord(b.producto) === firstWord(producto)), error: null };
}

/**
 * La fila donde escribir. Tiene que ser la del nombre exacto: un mismo lote
 * y etapa pueden traer producto de venta y muestra médica a la vez
 * ("…3g CJA x20" y "…3g CJA x2MM"), y reaprovechar la fila de otra
 * presentación metía los dos en la misma casilla, donde el segundo borraba
 * al primero. Sin coincidencia exacta se crea una fila nueva.
 */
async function findBatchRow(producto, lote) {
  const { rows, error } = await findBatchRows(producto, lote);
  if (error) return { row: null, error };
  return { row: rows.find((b) => b.producto === producto) || null, error: null };
}

/**
 * Quita las filas de "batches" que ya no tienen nada colgando. Si no, queda
 * el lote registrado sin contenido y estorba a las búsquedas posteriores.
 */
async function limpiarBatchesVacios(ids) {
  for (const id of ids) {
    const cuentas = await Promise.all(
      ["batch_values", "batch_orders", "batch_personnel", "batch_insumos"].map(async (tabla) => {
        const { count, error } = await supabase
          .from(tabla)
          .select("id", { count: "exact", head: true })
          .eq("batch_id", id);
        // Una tabla que aún no existe (migración sin correr) no debe impedir
        // la limpieza, pero tampoco contar como contenido.
        return error ? 0 : count || 0;
      })
    );

    if (cuentas.reduce((a, b) => a + b, 0) === 0) {
      await supabase.from("batches").delete().eq("id", id);
    }
  }
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

// PostgREST nombra la columna que no encuentra ("Could not find the 'x'
// column of 'batches' in the schema cache", code PGRST204). Sirve para
// reintentar sin ella en vez de perder todo el escrito: "batches" tiene dos
// columnas opcionales que dependen de qué migración se haya corrido (receta
// de la v5, teorico/teorico_unidad de la v9), y un insert o un update es
// todo o nada — si una columna no existe, el resto tampoco se guarda, aunque
// sí exista. Eso perdía la receta con sólo que faltara la migración v9.
function columnaAusente(error) {
  if (error?.code !== "PGRST204") return null;
  const m = error.message?.match(/'([^']+)' column/);
  return m ? m[1] : null;
}

/**
 * Ejecuta una escritura y, si PostgREST rechaza una columna que el proyecto
 * aún no tiene, la quita del payload y reintenta con lo que sí se pudo
 * reconocer. Devuelve también qué columnas tuvo que quitar, para avisar de
 * qué migración falta sin bloquear el resto del guardado.
 */
async function conColumnasOpcionales(ejecutar, payloadInicial) {
  const payload = { ...payloadInicial };
  const faltantes = [];

  for (;;) {
    if (Object.keys(payload).length === 0) return { data: null, error: null, faltantes };

    const { data, error } = await ejecutar(payload);
    if (!error) return { data, error: null, faltantes };

    const columna = columnaAusente(error);
    if (!columna || !(columna in payload)) return { data: null, error, faltantes };

    delete payload[columna];
    faltantes.push(columna);
  }
}

export async function syncDocumentToSupabase(doc) {
  if (!supabaseEnabled) return { ok: true, skipped: true };

  const { row: existing, error: findErr } = await findBatchRow(doc.producto, doc.lote);
  if (findErr) return { ok: false, error: findErr.message };

  const receta = doc.meta?.receta || null;
  // El tamaño de lote separa validaciones: un producto que se fabrica a dos
  // escalas son dos análisis distintos, y sin este dato quedan mezclados.
  const teorico = doc.meta?.teorico || null;
  const teoricoUnidad = doc.meta?.teoricoUnidad || null;
  // Qué migraciones opcionales faltan por correr, para avisar sin bloquear
  // el guardado de lo esencial (producto, lote, parámetros).
  let columnasFaltantes = [];

  let batchRow = existing;
  if (!batchRow) {
    const { data, error, faltantes } = await conColumnasOpcionales(
      (payload) => supabase.from("batches").insert(payload).select().single(),
      { producto: doc.producto, lote: doc.lote, receta, teorico, teorico_unidad: teoricoUnidad }
    );
    if (error) return { ok: false, error: error.message };
    batchRow = data;
    columnasFaltantes = faltantes;
  } else {
    // La primera etapa cargada de un lote puede no haber traído la receta o
    // el teórico (por ejemplo, si sólo se subió una orden); se completan en
    // cuanto un documento posterior sí los aporta.
    const parche = {};
    if (receta && batchRow.receta !== receta) parche.receta = receta;
    if (teorico && batchRow.teorico !== teorico) {
      parche.teorico = teorico;
      parche.teorico_unidad = teoricoUnidad;
    }

    if (Object.keys(parche).length > 0) {
      const { data, error, faltantes } = await conColumnasOpcionales(
        (payload) => supabase.from("batches").update(payload).eq("id", batchRow.id).select().single(),
        parche
      );
      if (data) batchRow = data;
      else if (error) return { ok: false, error: error.message };
      columnasFaltantes = faltantes;
    }
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
    return { ok: true, batchId: batchRow.id, columnasFaltantes };
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

  return { ok: true, batchId: batchRow.id, personnelWarning, columnasFaltantes, insumosWarning };
}

export async function deleteDocumentFromSupabase(doc) {
  if (!supabaseEnabled) return { ok: true, skipped: true };

  // Se borra en TODAS las filas del lote de esa familia, no sólo en la
  // primera: un mismo lote tiene una fila por presentación, y dejar una sin
  // tocar hacía que el producto volviera a aparecer al recargar.
  const { rows, error } = await findBatchRows(doc.producto, doc.lote);
  if (error) return { ok: false, error: error.message };

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return { ok: true };

  if (doc.kind === "orden") {
    const { error: e } = await supabase
      .from("batch_orders")
      .delete()
      .in("batch_id", ids)
      .eq("stage", doc.stage);
    if (e) return { ok: false, error: e.message };
  } else {
    const { error: delErr } = await supabase
      .from("batch_values")
      .delete()
      .in("batch_id", ids)
      .eq("stage", doc.stage);
    if (delErr) return { ok: false, error: delErr.message };

    // Best-effort: si batch_personnel o batch_insumos no existen todavía
    // (faltan las migraciones v3 / v6), no hace fallar el borrado de los
    // parámetros.
    await supabase.from("batch_personnel").delete().in("batch_id", ids).eq("stage", doc.stage);
    await supabase.from("batch_insumos").delete().in("batch_id", ids).eq("stage", doc.stage);
  }

  await limpiarBatchesVacios(ids);
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
        meta: {
          producto: batch.producto,
          lote: batch.lote,
          stage,
          receta: batch.receta || null,
          teorico: batch.teorico || null,
          teoricoUnidad: batch.teorico_unidad || null,
        },
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
      meta: {
        producto: row.producto || batch.producto,
        lote: batch.lote,
        stage: row.stage,
        teorico: batch.teorico || null,
        teoricoUnidad: batch.teorico_unidad || null,
      },
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
