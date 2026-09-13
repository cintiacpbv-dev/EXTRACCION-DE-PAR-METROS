// El vocabulario aprendido de parámetros de proceso.
//
// El detector genérico decide que una lectura es un parámetro de proceso por
// dos vías: porque el documento le imprime un criterio de aceptación al lado,
// o porque su etiqueta nombra una magnitud conocida (ver PROCESS_KEYWORDS en
// parsers/genericParser.js). Esa segunda lista está escrita a mano, y el
// propio comentario que la acompaña dice lo que pasa: "el vocabulario de
// sólidos orales no sirve para un inyectable estéril… esto crece con cada
// documento nuevo".
//
// Crecer a mano significa que un producto de una familia nueva llega, sus
// lecturas caen en "otros", y alguien tiene que editar el código. Este módulo
// es la alternativa: los términos aprendidos se guardan, se cargan al abrir y
// se suman a los de siempre.
//
// Dos reglas que hacen que esto sea seguro:
//
//   1. Sólo suma. Un término aprendido puede ASCENDER una lectura que ya se
//      detectó —de "otros" a parámetro de proceso— y nunca puede quitar ni
//      cambiar nada de lo que ya funcionaba.
//   2. Deja rastro. Cada término guarda de qué producto, etapa y etiqueta
//      salió, para poder revisarlo y borrarlo. En un expediente de validación
//      no vale "lo decidió la máquina": tiene que constar por qué.

import { supabase, supabaseEnabled } from "./supabaseClient.js";

const terminos = new Map();

/** Un término normalizado: en mayúsculas, sin acentos y sin sobras. */
export function normalizarTermino(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pone en uso una lista de términos aprendidos.
 *
 * La aplicación la llama al abrir, con lo que venga de Supabase o de este
 * navegador. Se reemplaza entera en vez de acumularse: si alguien borró un
 * término, borrarlo tiene que notarse.
 */
export function usarVocabulario(lista) {
  terminos.clear();
  for (const t of lista || []) {
    const termino = normalizarTermino(t.termino || t);
    // Un término de menos de cuatro letras ("PH" aparte, que ya está en la
    // lista base) engancharía media palabra de cualquier etiqueta.
    if (termino.length < 4) continue;
    if (!terminos.has(termino)) {
      // El término se guarda ya normalizado DENTRO del objeto, no sólo como
      // clave: si no, el panel enseñaría "penetracion de cono" mientras la
      // tabla guarda "PENETRACION DE CONO", y borrarlo desde el panel
      // compararía una forma contra la otra.
      terminos.set(termino, typeof t === "string" ? { termino } : { ...t, termino });
    }
  }
}

/** Los términos en uso, para poder enseñarlos y revisarlos. */
export function vocabularioEnUso() {
  return [...terminos.values()];
}

/**
 * Si una etiqueta nombra una magnitud aprendida.
 *
 * Se compara por palabras completas y no por trozos: "PESO" no debe
 * engancharse dentro de "REPESO", ni "SELLO" dentro de "DESELLO".
 */
export function esParametroAprendido(label) {
  if (terminos.size === 0) return false;
  const texto = ` ${normalizarTermino(label)} `;
  for (const termino of terminos.keys()) {
    if (texto.includes(` ${termino} `)) return true;
  }
  return false;
}

// --- lo aprendido, guardado en este navegador -------------------------------

const CLAVE_LOCAL = "deteccion-parametros:vocabulario:v1";

export function guardarVocabularioLocal(lista) {
  try {
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(lista));
    return true;
  } catch {
    return false;
  }
}

export function cargarVocabularioLocal() {
  try {
    const raw = localStorage.getItem(CLAVE_LOCAL);
    const leido = raw ? JSON.parse(raw) : null;
    return Array.isArray(leido) ? leido : [];
  } catch {
    return [];
  }
}

// --- lo aprendido, guardado para toda la planta ------------------------------
//
// Un término aprendido en esta computadora tiene que valer en la de al lado:
// si no, cada equipo tendría que redescubrir lo mismo y gastar otra llamada a
// la IA. La tabla la crea supabase_migration_v16.sql.

/** Lo que se guarda de cada término: el término y de dónde salió. Nada más. */
function filaDeTermino(t) {
  return {
    termino: normalizarTermino(t.termino),
    etiqueta: t.etiqueta ?? null,
    producto: t.producto ?? null,
    receta: t.receta ?? null,
    etapa: t.etapa ?? null,
    origen: t.origen || "ia",
  };
}

export async function cargarVocabularioRemoto() {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase
    .from("vocabulario_parametros")
    .select("termino, etiqueta, producto, receta, etapa, origen, created_at")
    .order("created_at", { ascending: true });
  if (error) return null;
  return data || [];
}

/**
 * Guarda términos nuevos sin pisar los que ya estaban.
 *
 * `upsert` sobre la clave primaria: aprender dos veces la misma magnitud no
 * duplica filas, y el rastro que queda es el del primer registro donde se vio
 * —el que de verdad la enseñó— y no el del último que pasó por aquí.
 */
export async function guardarVocabularioRemoto(lista) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const filas = (lista || []).map(filaDeTermino).filter((f) => f.termino.length >= 4);
  if (filas.length === 0) return { ok: true, skipped: true };
  const { error } = await supabase
    .from("vocabulario_parametros")
    .upsert(filas, { onConflict: "termino", ignoreDuplicates: true });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Quitar un término: la detección vuelve exactamente a como estaba antes. */
export async function borrarTerminoRemoto(termino) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase
    .from("vocabulario_parametros")
    .delete()
    .eq("termino", normalizarTermino(termino));
  return error ? { ok: false, error: error.message } : { ok: true };
}

// --- qué recetas y etapas ya se revisaron -----------------------------------
//
// "Basta con analizar un registro por cada versión y etapa" sólo es cierto si
// queda constancia de que esa revisión ya se hizo. La marca se pone aunque no
// se haya aprendido nada, que es el caso normal a partir del segundo lote: sin
// ella, cada lote nuevo volvería a gastar una llamada para no encontrar nada.

export function claveDeRevision({ producto, receta, etapa }) {
  return [producto || "?", receta || "sin receta", etapa || "?"]
    .map((x) => normalizarTermino(x) || "?")
    .join("|");
}

export async function cargarRevisionesRemotas() {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase.from("vocabulario_revisiones").select("clave");
  if (error) return null;
  return new Set((data || []).map((r) => r.clave));
}

export async function marcarRevision(datos, cuentas) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase.from("vocabulario_revisiones").upsert(
    {
      clave: claveDeRevision(datos),
      producto: datos.producto ?? null,
      receta: datos.receta ?? null,
      etapa: datos.etapa ?? null,
      candidatos: cuentas?.candidatos ?? 0,
      aprendidos: cuentas?.aprendidos ?? 0,
    },
    { onConflict: "clave" }
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

// --- aplicar lo aprendido a lo que ya estaba analizado -----------------------

/**
 * Asciende las lecturas que el vocabulario aprendido ahora sí reconoce.
 *
 * Sin esto, aprender un término sólo serviría para los registros que se
 * suban después: los que ya están guardados quedaron con su clasificación
 * escrita dentro, y la magnitud recién aprendida seguiría escondida en
 * "otros" en el documento que la enseñó. Aquí no se reanaliza el PDF —sólo
 * se vuelve a mirar la etiqueta de cada lectura, que es lo único de lo que
 * depende esta decisión.
 *
 * Sólo sube, nunca baja: una lectura que ya era parámetro de proceso se
 * queda como está, y si se borra el término del vocabulario, la lectura
 * vuelve a "otros" sola, porque esto se recalcula, no se guarda.
 */
export function promoverParams(params) {
  if (terminos.size === 0 || !Array.isArray(params)) return params;
  let cambio = false;
  const salida = params.map((p) => {
    if (p.category !== "otros" || !esParametroAprendido(p.label)) return p;
    cambio = true;
    return { ...p, category: "critico", aprendido: true };
  });
  return cambio ? salida : params;
}

/** Lo mismo, sobre la lista de documentos entera. */
export function promoverDocumentos(documentos) {
  if (terminos.size === 0 || !Array.isArray(documentos)) return documentos;
  let cambio = false;
  const salida = documentos.map((d) => {
    const params = promoverParams(d.params);
    if (params === d.params) return d;
    cambio = true;
    return { ...d, params };
  });
  return cambio ? salida : documentos;
}
