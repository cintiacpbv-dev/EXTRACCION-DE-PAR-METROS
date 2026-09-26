// El historial de las evaluaciones de Criticidad y Riesgo.
//
// Una evaluación vivía sólo en la pantalla: al recargar se perdía la corrida
// —que es cara, porque pregunta a Consulta PDF y a la IA por cada atributo y
// cada parámetro— y, peor, lo ajustado a mano encima: las severidades, las
// respuestas de desempeño, las sugerencias aceptadas. Aquí cada evaluación
// queda guardada entera, se puede volver a abrir tal como quedó y volver a
// emitir su Word o su Excel sin repetir nada.
//
// Como el historial del Análisis de Riesgo (lib/riesgo/historial.js), se
// guarda en dos sitios a la vez: en este navegador, para que esté a la vista
// al instante y aunque no haya conexión, y en Supabase (supabase_migration_v19.sql),
// que es lo que la conserva al limpiar el navegador o desde otra computadora.

import { supabase, supabaseEnabled } from "../supabaseClient.js";

const CLAVE_LOCAL = "deteccion-parametros:criticidad:historial:v1";
const TABLA = "analisis_criticidad";

// Una evaluación con el análisis de riesgo de un protocolo pesa unos cientos
// de kilobytes, y el almacenamiento del navegador ronda los cinco megas que
// comparte con el resto de la aplicación. Aquí se quedan las más recientes;
// el historial completo vive en Supabase.
const MAX_LOCALES = 10;

function ahora() {
  return new Date().toISOString();
}

function nuevoId() {
  return `criticidad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Cómo se llama una evaluación en la lista: el producto y de dónde salió. */
export function nombreDe({ producto, fuente, protocoloNombre }) {
  const archivo = String(protocoloNombre || "").replace(/\.docx$/i, "");
  const origen = fuente === "protocolo" ? `protocolo${archivo ? ` ${archivo}` : ""}` : "registros";
  return `${producto || "Sin producto"} · desde ${origen}`;
}

/**
 * Arma el registro que se guarda.
 *
 * `datos` es todo lo necesario para reabrirla sin volver a preguntar nada: la
 * corrida (screening, FMEA, atributos, corroboración) y lo ajustado a mano.
 * Las severidades van tal como quedaron en ESTA evaluación: el catálogo de la
 * planta puede cambiar después, y el historial tiene que enseñar lo que se
 * decidió entonces.
 */
export function evaluacionDesde({ id, creado, producto, forma, lote, fuente, protocoloNombre, meta, corrida, severidades, desempeno, vinculos, resumen }) {
  return {
    id: id || nuevoId(),
    producto: producto || "",
    nombre: nombreDe({ producto, fuente, protocoloNombre }),
    fuente: fuente || "",
    resumen: resumen || {},
    datos: {
      producto: producto || "",
      forma: forma || "",
      lote: lote || "",
      fuente: fuente || "",
      protocoloNombre: protocoloNombre || "",
      corrida,
      severidades: severidades || [],
      desempeno: desempeno || {},
      vinculos: vinculos || {},
      // Lo demás del documento: etapas con sus equipos, documentos fuente y
      // los datos que se llenaron a mano (secciones A, B, C, F y G).
      meta: meta || {},
    },
    creado: creado || ahora(),
    actualizado: ahora(),
  };
}

// --- en este navegador ------------------------------------------------------

export function listarHistorialLocal() {
  try {
    const raw = localStorage.getItem(CLAVE_LOCAL);
    const lista = raw ? JSON.parse(raw) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/**
 * Escribe la lista, quitando de la cola lo que no quepa: si el navegador se
 * queda sin sitio, se sacrifican las evaluaciones más antiguas —que siguen en
 * Supabase— antes que dejar de guardar la que se está trabajando.
 */
function escribirLocal(lista) {
  let recorte = lista.slice(0, MAX_LOCALES);
  while (recorte.length > 0) {
    try {
      localStorage.setItem(CLAVE_LOCAL, JSON.stringify(recorte));
      return true;
    } catch {
      recorte = recorte.slice(0, -1);
    }
  }
  try {
    localStorage.removeItem(CLAVE_LOCAL);
  } catch {
    // Sin almacenamiento: sólo queda la nube.
  }
  return false;
}

export function guardarEnHistorialLocal(evaluacion) {
  const lista = listarHistorialLocal().filter((a) => a.id !== evaluacion.id);
  return escribirLocal([evaluacion, ...lista]);
}

export function borrarDelHistorialLocal(id) {
  escribirLocal(listarHistorialLocal().filter((a) => a.id !== id));
}

// --- en Supabase ------------------------------------------------------------

/** La lista, sin los datos de cada evaluación: sólo nombre, resumen y fecha. */
export async function listarHistorialRemoto() {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase
    .from(TABLA)
    .select("id,producto,nombre,fuente,resumen,creado,actualizado")
    .order("actualizado", { ascending: false });
  if (error || !data) return [];
  return data;
}

export async function traerEvaluacion(id) {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase.from(TABLA).select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function guardarEnHistorialRemoto(evaluacion) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase.from(TABLA).upsert(
    {
      id: evaluacion.id,
      producto: evaluacion.producto,
      nombre: evaluacion.nombre,
      fuente: evaluacion.fuente,
      resumen: evaluacion.resumen,
      datos: evaluacion.datos,
      creado: evaluacion.creado,
      actualizado: evaluacion.actualizado,
    },
    { onConflict: "id" }
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function borrarDelHistorialRemoto(id) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase.from(TABLA).delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// --- las dos fuentes, unidas ------------------------------------------------

/**
 * Lo de la nube y lo de este navegador juntos, sin repetir, lo más reciente
 * primero. Se unen en vez de pisarse: una evaluación hecha sin conexión vive
 * sólo aquí, y quedarse con lo remoto la borraría de la vista.
 */
export async function listarHistorial() {
  const porId = new Map(listarHistorialLocal().map((a) => [a.id, a]));
  for (const remoto of await listarHistorialRemoto()) {
    const local = porId.get(remoto.id);
    if (!local || (remoto.actualizado || "") >= (local.actualizado || "")) {
      porId.set(remoto.id, { ...local, ...remoto });
    }
  }
  return [...porId.values()].sort((a, b) => (b.actualizado || "").localeCompare(a.actualizado || ""));
}

export async function guardarEvaluacion(evaluacion) {
  guardarEnHistorialLocal(evaluacion);
  return guardarEnHistorialRemoto(evaluacion);
}

/** Se borra de los dos sitios: si sólo se fuera de aquí, volvería al recargar. */
export async function borrarEvaluacion(id) {
  borrarDelHistorialLocal(id);
  return borrarDelHistorialRemoto(id);
}

/** Abre una: la de la nube si está (es la completa), si no la de aquí. */
export async function abrirEvaluacion(id) {
  const remota = await traerEvaluacion(id);
  if (remota?.datos?.corrida) return remota;
  return listarHistorialLocal().find((a) => a.id === id) || null;
}
