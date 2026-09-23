// Corroborar la evaluación con la bibliografía (Consulta PDF) y con una
// segunda lectura de la IA.
//
// Tres usos, los tres con la misma regla: la bibliografía aporta EVIDENCIA
// con su cita, la IA razona con esa evidencia delante, y nada de lo que ya
// estaba decidido cambia solo.
//
//   1. Severidad (Paso 1). Por cada atributo se le pregunta a Consulta PDF
//      qué consecuencia tiene que falle. Lo que encuentre va a la IA cuando
//      propone una severidad nueva, y a una segunda opinión sobre las
//      severidades ya guardadas: si no cuadran, se señala; no se cambia.
//   2. Causa-efecto desde registros (Paso 2). La evidencia de cada parámetro
//      se le da a la IA junto con el parámetro. Antes la bibliografía y la IA
//      contestaban cada una por su lado y nunca se veían.
//   3. Causa-efecto desde el protocolo (Paso 2). El análisis de riesgo ya
//      está escrito y firmado: aquí se revisa fila por fila contra la
//      bibliografía y la IA, y lo que falte o sobre queda como sugerencia
//      para aceptar o no.

import { citasComoTexto, preguntaDe } from "../atributos/pregunta.js";
import { SEVERIDADES_DE_PLANTA } from "./severidad.js";

// Lo que admite /api/verificar-bibliografia en una llamada, y cuántas
// llamadas a la vez: cada una ya abre cuatro preguntas en paralelo contra
// Consulta PDF, así que dos llamadas son ocho preguntas simultáneas — lo
// bastante para no eternizar un protocolo de cien filas sin saturar la otra
// aplicación.
const POR_LLAMADA = 12;
const LLAMADAS_A_LA_VEZ = 2;
const LOTE_IA = 20;

// Las respuestas ya obtenidas en esta sesión, por pregunta. Volver a evaluar
// tras ajustar algo no debe volver a esperar a la bibliografía por lo mismo.
const yaRespondidas = new Map();

/** Para las pruebas: olvidar lo respondido. */
export function olvidarBibliografia() {
  yaRespondidas.clear();
}

async function pedirIA(fetchImpl, cuerpo) {
  const respuesta = await fetchImpl("/api/evaluar-criticidad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!respuesta.ok) {
    const detalle = await respuesta.json().catch(() => ({}));
    throw new Error(detalle.error || `La IA respondió ${respuesta.status}.`);
  }
  return respuesta.json();
}

/**
 * Hace una lista de preguntas a Consulta PDF.
 *
 * Devuelve un Map id → { texto, referencias } SÓLO con lo que vino
 * confirmado y con cita: una respuesta sin cita es un modelo hablando de
 * memoria, y eso no es evidencia. Nunca lanza: si la bibliografía no está,
 * la evaluación sigue igual que sin ella.
 */
export async function consultarBibliografia(preguntas, { fetchImpl = fetch, onAvance } = {}) {
  const evidencias = new Map();
  const porPregunta = new Map();
  const faltan = [];
  for (const p of preguntas) {
    if (yaRespondidas.has(p.pregunta)) {
      const previa = yaRespondidas.get(p.pregunta);
      if (previa) evidencias.set(p.id, previa);
    } else {
      faltan.push(p);
      porPregunta.set(p.id, p.pregunta);
    }
  }

  const lotes = [];
  for (let i = 0; i < faltan.length; i += POR_LLAMADA) lotes.push(faltan.slice(i, i + POR_LLAMADA));

  let hechas = preguntas.length - faltan.length;
  let siguiente = 0;
  const reintentar = [];

  async function llamar(lote, esReintento) {
    try {
      const respuesta = await fetchImpl("/api/verificar-bibliografia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preguntas: lote }),
      });
      if (!respuesta.ok) return;
      const { resultados = [], pendientes = [] } = await respuesta.json().catch(() => ({}));
      for (const r of resultados) {
        const pregunta = porPregunta.get(r?.id);
        if (!pregunta) continue;
        const evidencia =
          r.confirmado && r.respuesta ? { texto: r.respuesta, referencias: citasComoTexto(r.citas) } : null;
        // Lo que no encontró también se recuerda: preguntar otra vez lo mismo
        // en la misma sesión va a dar lo mismo.
        yaRespondidas.set(pregunta, evidencia);
        if (evidencia) evidencias.set(r.id, evidencia);
      }
      // Lo que no alcanzó a entrar en el tiempo de la función se pide otra
      // vez, una sola, en una llamada con su propio presupuesto.
      if (!esReintento) {
        const pend = new Set(pendientes);
        reintentar.push(...lote.filter((p) => pend.has(p.id)));
      }
    } catch {
      // La bibliografía es un apoyo, no un requisito.
    } finally {
      hechas += esReintento ? 0 : lote.length;
      onAvance?.({ hechas: Math.min(hechas, preguntas.length), total: preguntas.length });
    }
  }

  async function trabajador() {
    while (siguiente < lotes.length) {
      const lote = lotes[siguiente++];
      await llamar(lote, false);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LLAMADAS_A_LA_VEZ, lotes.length) }, trabajador));

  for (let i = 0; i < reintentar.length; i += POR_LLAMADA) {
    await llamar(reintentar.slice(i, i + POR_LLAMADA), true);
  }

  return evidencias;
}

/**
 * La pregunta a la bibliografía por un atributo: la consecuencia de que
 * falle, que es justo lo que el Paso 1 necesita — y nada sobre parámetros,
 * porque la severidad se decide sin mirarlos.
 */
export function preguntaDeSeveridad(atributo, { producto, forma } = {}) {
  return (
    `Producto: ${producto || "no indicado"}${forma ? ` (${forma})` : ""}. ` +
    `Atributo de calidad: ${atributo.nombre}` +
    (atributo.criterio || atributo.criterios?.[0] ? ` (especificación: ${atributo.criterio || atributo.criterios[0]})` : "") +
    ".\n\n" +
    "¿Qué consecuencia tiene para la seguridad del paciente o la eficacia del medicamento que este atributo " +
    "esté fuera de especificación? ¿Qué dice la farmacopea o la guía aplicable sobre su límite y su tolerancia? " +
    "Cita el documento y la sección o página que lo sustenta. " +
    "Si en los documentos no hay información sobre esto, dilo claramente y no propongas nada por tu cuenta."
  );
}

const FIJADAS_POR_LA_PLANTA = new Set(SEVERIDADES_DE_PLANTA.map((s) => s.atributo));

/** La evidencia de cada atributo, por nombre. */
export async function evidenciasDeAtributos(atributos, { producto, forma, fetchImpl, onAvance } = {}) {
  const unicos = [...new Map(atributos.map((a) => [a.nombre, a])).values()];
  const porId = await consultarBibliografia(
    unicos.map((a) => ({ id: a.nombre, pregunta: preguntaDeSeveridad(a, { producto, forma }) })),
    { fetchImpl, onAvance }
  );
  return porId;
}

/**
 * Segunda opinión sobre severidades que no se propusieron en esta corrida
 * (las guardadas de antes, revisadas o no).
 *
 * Devuelve, por atributo, { coincide, severidadSugerida, motivo, referencias }.
 * Las que fijó Validaciones para toda la planta no se revisan: ya se
 * decidieron a propósito, y una IA llevándoles la contraria sólo sería ruido.
 */
export async function revisarSeveridades(filas, { producto, forma, evidencias = new Map(), fetchImpl = fetch } = {}) {
  const aRevisar = filas.filter((f) => !FIJADAS_POR_LA_PLANTA.has(f.atributo));
  const salida = {};
  for (let i = 0; i < aRevisar.length; i += LOTE_IA) {
    const lote = aRevisar.slice(i, i + LOTE_IA);
    const { filas: r = [] } = await pedirIA(fetchImpl, {
      tarea: "revisar-severidad",
      producto,
      forma,
      atributos: lote.map((f) => ({
        nombre: f.atributo,
        severidad: f.severidad,
        decision: f.decision,
        justificacion: f.justificacion,
        evidencia: evidencias.get(f.atributo) || null,
      })),
    });
    for (const x of r) {
      const fila = lote.find((f) => f.atributo === x?.atributo);
      if (!fila) continue;
      const sugerida = Number(x.severidadSugerida);
      const valida = Number.isInteger(sugerida) && sugerida >= 1 && sugerida <= 5;
      // "No coincide" pero sugiriendo la misma severidad no es un desacuerdo
      // que se pueda aplicar: se trata como coincidencia con comentario.
      const coincide = x.coincide !== false || !valida || sugerida === fila.severidad;
      salida[fila.atributo] = {
        coincide,
        severidadSugerida: coincide ? null : sugerida,
        motivo: String(x.motivo || ""),
        referencias: evidencias.get(fila.atributo)?.referencias || "",
      };
    }
  }
  return salida;
}

/**
 * Revisa el análisis de riesgo del protocolo contra la bibliografía y la IA.
 *
 * Cada fila vuelve con `corroboracion`:
 *   { estado: "coincide" | "revisar" | "sin revisar",
 *     faltan: [atributos que se sugiere añadir], sobran: [...],
 *     motivo, referencias }
 * y con su `afecta` intacto: aceptar la sugerencia es cosa de quien valida.
 */
export async function revisarCausaEfecto(filas, { producto, forma, atributos, fetchImpl = fetch, onAvance } = {}) {
  const evidencias = await consultarBibliografia(
    filas.map((f) => ({ id: f.id, pregunta: preguntaDe(f, { producto, atributos }) })),
    {
      fetchImpl,
      onAvance: ({ hechas, total }) => onAvance?.(`Consulta PDF · ${hechas} de ${total} parámetros…`),
    }
  );

  const nombres = new Map(atributos.map((a) => [a.nombre.toUpperCase(), a.nombre]));
  const deLaLista = (lista) => [
    ...new Set((Array.isArray(lista) ? lista : []).map((n) => nombres.get(String(n).trim().toUpperCase())).filter(Boolean)),
  ];

  const respuestas = new Map();
  const etapas = [...new Set(filas.map((f) => f.etapa))];
  for (const etapa of etapas) {
    const suyas = filas.filter((f) => f.etapa === etapa);
    for (let i = 0; i < suyas.length; i += LOTE_IA) {
      const lote = suyas.slice(i, i + LOTE_IA);
      onAvance?.(`IA · revisando ${etapa}…`);
      try {
        const { filas: r = [] } = await pedirIA(fetchImpl, {
          tarea: "revisar-causa-efecto",
          producto,
          forma,
          etapa,
          atributos: atributos.map((a) => ({ nombre: a.nombre, severidad: a.severidad })),
          parametros: lote.map((f) => ({
            id: f.id,
            magnitud: f.magnitud,
            seccion: f.seccion,
            criterios: f.criterios,
            afecta: f.afecta,
            analisis: f.racional,
            evidencia: evidencias.get(f.id) || null,
          })),
        });
        for (const x of r) respuestas.set(String(x?.id || ""), x);
      } catch {
        // Sin la IA, las filas de esta etapa se quedan "sin revisar"; la
        // evaluación en sí no depende de esta revisión.
      }
    }
  }

  return filas.map((f) => {
    const r = respuestas.get(f.id);
    const evidencia = evidencias.get(f.id);
    if (!r) {
      return { ...f, corroboracion: { estado: "sin revisar", faltan: [], sobran: [], motivo: "", referencias: evidencia?.referencias || "" } };
    }
    const actuales = new Set(f.afecta || []);
    const faltan = deLaLista(r.faltan).filter((n) => !actuales.has(n));
    const sobran = deLaLista(r.sobran).filter((n) => actuales.has(n));
    const hayCambio = faltan.length > 0 || sobran.length > 0;
    return {
      ...f,
      corroboracion: {
        // Un "no coincide" sin nada concreto que añadir o quitar no se puede
        // aplicar: se enseña como comentario, no como desacuerdo.
        estado: hayCambio ? "revisar" : "coincide",
        faltan,
        sobran,
        motivo: String(r.motivo || ""),
        referencias: evidencia?.referencias || "",
        conBibliografia: !!evidencia,
      },
    };
  });
}

/**
 * Aplica, sobre las filas, los vínculos que quien valida aceptó.
 * `ajustes` es id → lista de atributos vinculados, ya corregida.
 */
export function aplicarAjustesDeVinculo(filas, ajustes) {
  if (!ajustes || Object.keys(ajustes).length === 0) return filas;
  return filas.map((f) => {
    if (!(f.id in ajustes)) return f;
    const afecta = ajustes[f.id];
    return { ...f, afecta, sospecha: afecta.length > 0, vinculoRevisado: true };
  });
}
