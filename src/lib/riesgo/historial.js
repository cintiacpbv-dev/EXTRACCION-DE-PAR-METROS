// El historial de los análisis de riesgo.
//
// Hasta ahora un AMFE vivía sólo en la pantalla: al recargar la página se
// perdía todo —el borrador de la IA y, peor, las correcciones hechas a mano
// encima, que son el trabajo de verdad—. Aquí cada análisis queda guardado
// con su producto y su fecha, se puede volver a abrir, y se puede borrar
// cuando ya no haga falta.
//
// Se guarda en dos sitios a la vez y a propósito: en este navegador, para que
// el historial esté a la vista al instante y siga habiendo algo aunque no haya
// conexión; y en Supabase, que es lo que hace que el análisis siga ahí al
// limpiar el navegador o al abrirlo desde otra computadora.

import { supabase, supabaseEnabled } from "../supabaseClient.js";

const CLAVE_LOCAL = "deteccion-parametros:riesgo:historial:v1";

// Un tope para lo que se guarda en este navegador: el almacenamiento local
// ronda los cinco megabytes y un AMFE largo pesa lo suyo. Lo que se pase de
// aquí sigue en Supabase, que es donde vive el historial completo.
const MAX_LOCALES = 30;

function ahora() {
  return new Date().toISOString();
}

function nuevoId() {
  return `riesgo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Cómo se llama un análisis en la lista.
 *
 * Lo que distingue a uno de otro es el producto y las etapas que cubre; la
 * fecha va aparte, en su propia columna, porque dos análisis del mismo
 * producto se diferencian por ella.
 */
export function nombreDe({ producto, etapas }) {
  const partes = [producto || "Sin producto"];
  if (etapas) partes.push(etapas);
  return partes.join(" · ");
}

/** Arma el registro que se guarda, a partir de lo que hay en la pantalla. */
export function analisisDesde({ id, producto, etapas, filas, creado }) {
  return {
    id: id || nuevoId(),
    producto: producto || "",
    etapas: etapas || "",
    nombre: nombreDe({ producto, etapas }),
    filas: filas || [],
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

function escribirLocal(lista) {
  try {
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(lista.slice(0, MAX_LOCALES)));
    return true;
  } catch {
    return false;
  }
}

/** Guarda o reemplaza un análisis, dejándolo el primero de la lista. */
export function guardarEnHistorialLocal(analisis) {
  const lista = listarHistorialLocal().filter((a) => a.id !== analisis.id);
  return escribirLocal([analisis, ...lista]);
}

export function borrarDelHistorialLocal(id) {
  escribirLocal(listarHistorialLocal().filter((a) => a.id !== id));
}

// --- en Supabase ------------------------------------------------------------

/**
 * Trae el historial guardado. Las filas del cuadro no se piden aquí: la lista
 * sólo necesita nombre y fecha, y un AMFE completo por cada entrada haría
 * lenta la apertura del panel. Se cargan al abrir uno (ver `traerAnalisis`).
 */
export async function listarHistorialRemoto() {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase
    .from("analisis_riesgo")
    .select("id,producto,etapas,nombre,creado,actualizado,filas_total")
    .order("actualizado", { ascending: false });

  if (error || !data) return [];
  return data;
}

/** El análisis completo, con sus filas, para volver a abrirlo. */
export async function traerAnalisis(id) {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase.from("analisis_riesgo").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function guardarEnHistorialRemoto(analisis) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase.from("analisis_riesgo").upsert(
    {
      id: analisis.id,
      producto: analisis.producto,
      etapas: analisis.etapas,
      nombre: analisis.nombre,
      filas: analisis.filas,
      // Se guarda contado para poder enseñar "42 filas" en la lista sin
      // traerse las filas de todos los análisis.
      filas_total: analisis.filas.length,
      creado: analisis.creado,
      actualizado: analisis.actualizado,
    },
    { onConflict: "id" }
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function borrarDelHistorialRemoto(id) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase.from("analisis_riesgo").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// --- las dos fuentes, unidas ------------------------------------------------

/**
 * El historial que se enseña: lo de la nube y lo de este navegador juntos, sin
 * repetir, y lo más reciente primero.
 *
 * Se unen en vez de que una fuente pise a la otra por la misma razón que en el
 * resto de la aplicación: un análisis hecho sin conexión vive sólo aquí, y
 * quedarse con lo remoto lo borraría de la vista.
 */
export async function listarHistorial() {
  const locales = listarHistorialLocal();
  const remotos = await listarHistorialRemoto();

  const porId = new Map(locales.map((a) => [a.id, { ...a, filas_total: a.filas?.length ?? a.filas_total ?? 0 }]));
  for (const remoto of remotos) {
    const local = porId.get(remoto.id);
    // Gana el más reciente: si se editó en otra computadora después, es esa
    // versión la que hay que ofrecer.
    if (!local || (remoto.actualizado || "") >= (local.actualizado || "")) {
      porId.set(remoto.id, { ...local, ...remoto });
    }
  }

  return [...porId.values()].sort((a, b) => (b.actualizado || "").localeCompare(a.actualizado || ""));
}

/** Guarda en los dos sitios. El local nunca falla de forma visible. */
export async function guardarAnalisis(analisis) {
  guardarEnHistorialLocal(analisis);
  return guardarEnHistorialRemoto(analisis);
}

/** Lo borra de los dos: si sólo se fuera de aquí, volvería al recargar. */
export async function borrarAnalisis(id) {
  borrarDelHistorialLocal(id);
  return borrarDelHistorialRemoto(id);
}

/** Abre uno del historial: se prefiere el de la nube, que es el más completo. */
export async function abrirAnalisis(id) {
  const remoto = await traerAnalisis(id);
  if (remoto?.filas) return remoto;
  return listarHistorialLocal().find((a) => a.id === id) || null;
}
