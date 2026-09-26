// La severidad de cada atributo de calidad: lo que decide todo el
// procedimiento, y lo único que se guarda entre productos.
//
// Por qué se guarda. La severidad es una propiedad DEL ATRIBUTO, no del
// producto ni del parámetro: "qué tan grave sería que la dureza saliera
// fuera" se contesta una vez y vale para todas las tabletas de la planta. El
// procedimiento lo dice en su Paso 1 — "fijar, una sola vez por atributo, de
// forma independiente de cualquier parámetro de proceso". Volver a decidirla
// en cada corrida es justamente lo que hace que dos evaluaciones del mismo
// atributo salgan distintas.
//
// Cómo se llena. La IA propone severidad y justificación usando la matriz
// Severidad × Incertidumbre; quien valida la corrige en pantalla; y lo
// corregido es lo que queda. Una severidad tocada a mano NUNCA vuelve a ser
// pisada por la IA: se marca con origen "revisada" y a partir de ahí manda.
//
// Los nombres tienen que ser únicos. En las corridas reales el Paso 1 parte
// "Descripción" e "Identidad" en dos filas con severidades distintas
// ("— empaque primario" 4, "— empaque secundario" 3) mientras el Paso 2 las
// nombra sin el calificativo. Una persona lo resuelve por contexto; aquí no
// se puede, así que el nombre completo ES la clave.

import { supabase, supabaseEnabled } from "../supabaseClient.js";
import { normalizarTermino } from "../vocabulario.js";

export { MATRIZ_SEVERIDAD, PREGUNTAS_SEVERIDAD } from "./modelo.js";

/** La clave de un atributo: su nombre normalizado, calificativo incluido. */
export function claveDeAtributo(nombre) {
  return normalizarTermino(nombre);
}

/** Una severidad válida es un entero de 1 a 5. Nada más. */
export function severidadValida(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

const severidades = new Map();

/** Pone en uso una tabla de severidades (lo que venga de Supabase o de local). */
export function usarSeveridades(lista) {
  severidades.clear();
  for (const s of lista || []) {
    const clave = claveDeAtributo(s?.atributo);
    const valor = severidadValida(s?.severidad);
    if (!clave || valor === null) continue;
    severidades.set(clave, {
      atributo: String(s.atributo).trim(),
      severidad: valor,
      justificacion: s.justificacion || "",
      decision: s.decision || "",
      origen: s.origen || "ia",
    });
  }
}

export function severidadesEnUso() {
  return [...severidades.values()];
}

/**
 * Anota severidades EN el catálogo, sin reemplazarlo.
 *
 * La diferencia con `usarSeveridades` no es un matiz: esta tabla es el
 * catálogo de toda la planta, no el estado de una corrida. Reemplazarlo con
 * lo de la evaluación en curso borraba las severidades de los demás
 * productos — evaluar una crema después de una tableta dejaba a la tableta
 * sin ninguna. Devuelve el catálogo entero, que es lo que hay que guardar.
 */
export function anotarSeveridades(lista) {
  for (const s of lista || []) {
    const clave = claveDeAtributo(s?.atributo);
    const valor = severidadValida(s?.severidad);
    if (!clave || valor === null) continue;
    severidades.set(clave, {
      atributo: String(s.atributo).trim(),
      severidad: valor,
      justificacion: s.justificacion || "",
      decision: s.decision || "",
      origen: s.origen || "ia",
      tipoVinculo: s.tipoVinculo || "",
      incertidumbre: s.incertidumbre || "",
      otrosFactores: s.otrosFactores || "",
    });
  }
  return severidadesEnUso();
}

/**
 * Severidades fijadas por Validaciones para toda la planta.
 *
 * Son decisiones de quien valida, no propuestas: entran como «revisada», así
 * que la IA no las pisa, y valen desde la primera evaluación aunque el
 * catálogo esté vacío (un navegador nuevo, o antes de que Supabase tenga
 * nada). Si después alguien la cambia a mano en el Paso 1 y la guarda, manda
 * lo guardado: esto sólo cubre el hueco, no impone por encima de una
 * revisión posterior.
 *
 * El nombre es exacto. «Descripción» es la del producto terminado; las
 * descripciones de intermedios («Descripción de la gelatina», «de la
 * mezcla») son otros atributos y conservan su propia severidad.
 */
export const SEVERIDADES_DE_PLANTA = [
  {
    atributo: "Descripción",
    severidad: 4,
    decision: "CQA",
    justificacion:
      "Fijada por Validaciones: la descripción del producto terminado es un atributo crítico de calidad (severidad 4).",
    origen: "revisada",
  },
];

/**
 * Pone las severidades de planta de los atributos de esta evaluación.
 *
 * Sólo donde no hay nada, o donde lo que hay es una propuesta de la IA: una
 * propuesta anterior no puede ganarle a una decisión de Validaciones, pero
 * una revisión hecha después en pantalla sí.
 */
export function aplicarSeveridadesDePlanta(nombres) {
  const pedidos = new Set((nombres || []).map(claveDeAtributo));
  const aplicadas = [];
  for (const s of SEVERIDADES_DE_PLANTA) {
    const clave = claveDeAtributo(s.atributo);
    if (!pedidos.has(clave)) continue;
    const actual = severidades.get(clave);
    if (actual && actual.origen === "revisada") continue;
    severidades.set(clave, { ...s });
    aplicadas.push(s.atributo);
  }
  return aplicadas;
}

/** El mapa {nombre → severidad} que consume el modelo de decisión. */
export function mapaDeSeveridades(extra = []) {
  const mapa = {};
  for (const s of severidades.values()) mapa[s.atributo] = s.severidad;
  // Lo de esta corrida que todavía no se ha guardado manda sobre lo guardado:
  // es lo que quien valida acaba de ajustar en pantalla.
  for (const s of extra) {
    const valor = severidadValida(s?.severidad);
    if (s?.atributo && valor !== null) mapa[s.atributo] = valor;
  }
  return mapa;
}

/** Lo guardado para un atributo, si lo hay. */
export function severidadDeAtributo(nombre) {
  return severidades.get(claveDeAtributo(nombre)) || null;
}

/**
 * Junta lo propuesto por la IA con lo ya guardado.
 *
 * Lo revisado a mano manda siempre. Lo que la IA proponga sobre un atributo
 * ya revisado se descarta, pero se devuelve aparte para poder enseñarlo: que
 * el modelo discrepe de una severidad revisada es información, no ruido.
 */
export function fusionar(propuestas = []) {
  const filas = [];
  const discrepancias = [];

  for (const p of propuestas) {
    const nombre = String(p?.atributo || "").trim();
    const propuesta = severidadValida(p?.severidad);
    if (!nombre || propuesta === null) continue;

    const guardada = severidadDeAtributo(nombre);
    if (guardada && guardada.origen === "revisada") {
      if (guardada.severidad !== propuesta) {
        discrepancias.push({ atributo: nombre, guardada: guardada.severidad, propuesta, motivo: p.justificacion || "" });
      }
      filas.push({ ...guardada });
      continue;
    }

    filas.push({
      atributo: nombre,
      severidad: propuesta,
      justificacion: p.justificacion || guardada?.justificacion || "",
      decision: p.decision || guardada?.decision || "",
      origen: guardada?.origen === "revisada" ? "revisada" : "ia",
      // Las columnas del registro de severidad del formato (Paso 1b).
      tipoVinculo: p.tipoVinculo || guardada?.tipoVinculo || "",
      incertidumbre: p.incertidumbre || guardada?.incertidumbre || "",
      otrosFactores: p.otrosFactores || guardada?.otrosFactores || "",
    });
  }

  // Los atributos guardados que la IA no mencionó siguen valiendo.
  const nombrados = new Set(filas.map((f) => claveDeAtributo(f.atributo)));
  for (const s of severidades.values()) {
    if (!nombrados.has(claveDeAtributo(s.atributo))) filas.push({ ...s });
  }

  return { filas, discrepancias };
}

// --- guardado ---------------------------------------------------------------

const CLAVE_LOCAL = "deteccion-parametros:severidades:v1";

export function guardarSeveridadesLocal(lista) {
  try {
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(lista));
    return true;
  } catch {
    return false;
  }
}

export function cargarSeveridadesLocal() {
  try {
    const leido = JSON.parse(localStorage.getItem(CLAVE_LOCAL) || "[]");
    return Array.isArray(leido) ? leido : [];
  } catch {
    return [];
  }
}

function fila(s) {
  return {
    clave: claveDeAtributo(s.atributo),
    atributo: String(s.atributo).trim(),
    severidad: severidadValida(s.severidad),
    justificacion: s.justificacion || null,
    decision: s.decision || null,
    origen: s.origen || "ia",
  };
}

export async function cargarSeveridadesRemotas() {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase
    .from("severidad_atributos")
    .select("clave, atributo, severidad, justificacion, decision, origen")
    .order("atributo", { ascending: true });
  if (error) return null;
  return data || [];
}

/**
 * Guarda severidades.
 *
 * `upsert` sobre la clave: la severidad de un atributo es una sola, y la
 * última revisión manda. A diferencia del vocabulario aprendido, aquí SÍ se
 * pisa lo anterior — porque corregir una severidad es justamente lo que se
 * espera que haga quien valida.
 */
export async function guardarSeveridadesRemotas(lista) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const filas = (lista || []).map(fila).filter((f) => f.clave && f.severidad !== null);
  if (filas.length === 0) return { ok: true, skipped: true };
  const { error } = await supabase.from("severidad_atributos").upsert(filas, { onConflict: "clave" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function borrarSeveridadRemota(atributo) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase.from("severidad_atributos").delete().eq("clave", claveDeAtributo(atributo));
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Marca de que lo guardado sólo en este navegador ya se subió.
const CLAVE_SUBIDO = "deteccion-parametros:severidades:subido:v1";

/**
 * Pone en uso el catálogo guardado, al abrir la sección.
 *
 * Manda lo de Supabase, que es lo que ven todos los equipos; lo local es el
 * respaldo para cuando no hay conexión o la tabla aún no existe.
 *
 * Con la misma salvedad que el vocabulario aprendido, y por haber tropezado
 * dos veces en la misma piedra: lo ajustado antes de que la tabla existiera
 * vive SÓLO en este navegador. Mientras no existía, la consulta fallaba y se
 * usaba el respaldo local; en cuanto se creó, la consulta empezó a devolver
 * una lista vacía, y dar por buena esa lista vacía habría borrado las
 * severidades ajustadas —de la memoria y del respaldo— sin decir nada. Así
 * que la primera vez se sube lo que hubiera aquí, y desde entonces manda lo
 * remoto, que es lo que hace que borrar una severidad en otra computadora se
 * note en ésta.
 */
export async function iniciarSeveridades({
  cargar = cargarSeveridadesRemotas,
  guardar = guardarSeveridadesRemotas,
} = {}) {
  const remoto = await cargar();

  // Sin Supabase, o con la tabla aún sin crear: este navegador es todo lo que hay.
  if (!remoto) {
    usarSeveridades(cargarSeveridadesLocal());
    return severidadesEnUso();
  }

  let yaSubido = true;
  try {
    yaSubido = localStorage.getItem(CLAVE_SUBIDO) === "si";
  } catch {
    /* sin localStorage no hay nada local que rescatar */
  }

  let lista = remoto;

  if (!yaSubido) {
    const enLaNube = new Set(remoto.map((s) => claveDeAtributo(s.atributo)));
    const soloAqui = cargarSeveridadesLocal().filter((s) => !enLaNube.has(claveDeAtributo(s.atributo)));

    // Se usan igual, se hayan podido subir o no: lo que no se puede es
    // perderlas por no haber llegado a Supabase.
    lista = [...remoto, ...soloAqui];

    // La marca sólo se pone si la subida salió bien; si no, se reintenta al
    // volver a abrir. Subir dos veces lo mismo no duplica filas.
    const subida = soloAqui.length === 0 ? { ok: true } : await guardar(soloAqui);
    if (subida.ok) {
      try {
        localStorage.setItem(CLAVE_SUBIDO, "si");
      } catch {
        /* sin localStorage se reintentará cada vez, que tampoco hace daño */
      }
    }
  }

  usarSeveridades(lista);
  guardarSeveridadesLocal(severidadesEnUso());
  return severidadesEnUso();
}
