// Una corrida completa del Procedimiento de Evaluación de Criticidad y Riesgo.
//
// Encadena los 7 pasos sobre los registros ya cargados. Lo que decide cada
// paso y quién lo decide:
//
//   Paso 0  Atributos de calidad ........ el registro y el protocolo (leídos)
//   Paso 1  Severidad por atributo ...... lo guardado, y la IA para lo que falte
//   Paso 2  Causa-efecto por parámetro .. Consulta PDF, y la IA para lo que quede
//   Paso 3  Clasificación ............... una regla, sin IA
//   Paso 4  FMEA de los Críticos ........ la IA propone P y D
//   Paso 5  Vínculo estadístico ......... una fórmula, sin IA
//   Paso 6  Plan de reevaluación ........ texto fijo del procedimiento
//
// Los pasos 3 y 5 no le preguntan a nadie a propósito: son reglas
// deterministas, y pedírselas a un modelo sólo añadiría una forma de que
// salgan mal. La IA se usa donde hace falta juicio y nada más.

import { separarLecturas, porRelevancia } from "../atributos/modelo.js";
import { citasComoTexto, idDe, preguntaDe } from "../atributos/clasificar.js";
import { evaluar, npr, requisitoEstadistico, muestraPorAtributo } from "./modelo.js";
import { fusionar, mapaDeSeveridades, severidadValida } from "./severidad.js";

const LOTE_BIBLIOGRAFIA = 6;
const LOTE_IA = 20;

async function pedir(fetchImpl, url, cuerpo) {
  const respuesta = await fetchImpl(url, {
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
 * Paso 1 — la severidad de cada atributo.
 *
 * Sólo se le preguntan a la IA los que no tienen severidad guardada: los ya
 * revisados no se vuelven a proponer, que es lo que hace que la evaluación
 * sea estable entre corridas. Si todos están guardados, no se gasta llamada.
 */
export async function pasoSeveridad(atributos, { producto, forma, fetchImpl = fetch } = {}) {
  const enUso = mapaDeSeveridades();
  const faltan = atributos.filter((a) => !(a.nombre in enUso));

  let propuestas = [];
  if (faltan.length > 0) {
    const { filas = [] } = await pedir(fetchImpl, "/api/evaluar-criticidad", {
      tarea: "severidad",
      producto,
      forma,
      atributos: faltan.map((a) => ({ nombre: a.nombre, criterio: a.criterios?.[0] || "", etapa: a.etapa })),
    });
    propuestas = filas;
  }

  const { filas, discrepancias } = fusionar(propuestas);
  // Sólo los atributos de esta corrida, en el orden en que se midieron.
  const nombres = new Set(atributos.map((a) => a.nombre));
  return {
    filas: filas.filter((f) => nombres.has(f.atributo)),
    discrepancias,
    consultados: faltan.length,
  };
}

/**
 * Paso 2 — el screening causa-efecto.
 *
 * Primero la bibliografía: si Consulta PDF responde con citas, ésa es la
 * sospecha y queda con su referencia. Lo que no resuelva va a la IA. Que la
 * bibliografía esté caída no puede dejar el paso sin resultado.
 */
export async function pasoScreening(parametros, { producto, forma, etapa, atributos, fetchImpl = fetch } = {}) {
  const respaldos = new Map();

  for (let i = 0; i < parametros.length; i += LOTE_BIBLIOGRAFIA) {
    const lote = parametros.slice(i, i + LOTE_BIBLIOGRAFIA);
    try {
      const respuesta = await fetchImpl("/api/verificar-bibliografia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preguntas: lote.map((p) => ({ id: idDe(p), pregunta: preguntaDe(p, { producto, atributos }) })),
        }),
      });
      if (!respuesta.ok) continue;
      const { resultados = [] } = await respuesta.json().catch(() => ({}));
      for (const r of resultados) {
        if (!r?.confirmado || !r?.respuesta) continue;
        respaldos.set(r.id, { texto: r.respuesta, referencias: citasComoTexto(r.citas) });
      }
    } catch {
      // La bibliografía es un apoyo, no un requisito: si falla, sigue la IA.
    }
  }

  const porId = new Map();
  for (let i = 0; i < parametros.length; i += LOTE_IA) {
    const lote = parametros.slice(i, i + LOTE_IA);
    const { filas = [] } = await pedir(fetchImpl, "/api/evaluar-criticidad", {
      tarea: "screening",
      producto,
      forma,
      etapa,
      atributos: atributos.map((a) => ({ nombre: a.nombre, severidad: a.severidad })),
      parametros: lote.map((p) => ({
        id: idDe(p),
        magnitud: p.magnitud,
        seccion: p.seccion,
        criterios: p.criterios,
      })),
    });
    for (const f of filas) porId.set(String(f?.id || ""), f);
  }

  const nombresValidos = new Map(atributos.map((a) => [a.nombre.toUpperCase(), a.nombre]));

  return parametros.map((p) => {
    const id = idDe(p);
    const cruda = porId.get(id);
    const respaldo = respaldos.get(id);

    // Un atributo que la IA nombre y que no esté en la lista del Paso 0 no
    // entra: sin severidad fijada no puede clasificar nada, y aceptarlo
    // metería una fila que el Paso 3 no sabría resolver. Se guarda aparte
    // para poder enseñarlo — que el modelo vea algo que el registro no mide
    // es justo lo que quien valida querría revisar.
    const propuestos = Array.isArray(cruda?.afecta) ? cruda.afecta.map((x) => String(x).trim()).filter(Boolean) : [];
    const afecta = [];
    const fuera = [];
    for (const nombre of propuestos) {
      const conocido = nombresValidos.get(nombre.toUpperCase());
      if (conocido) {
        if (!afecta.includes(conocido)) afecta.push(conocido);
      } else if (!fuera.includes(nombre)) {
        fuera.push(nombre);
      }
    }

    return {
      ...p,
      id,
      sospecha: cruda?.sospecha === true && afecta.length > 0,
      afecta,
      atributosFueraDeLista: fuera,
      racional: respaldo?.texto || cruda?.origen || "",
      referencias: respaldo?.referencias || "",
      fuenteSospecha: respaldo ? (cruda ? "IA+bibliografía" : "bibliografía") : cruda ? "IA" : "sin resolver",
    };
  });
}

/** Paso 4 — P y D de los que ya son Críticos. */
export async function pasoFmea(criticos, { producto, forma, fetchImpl = fetch } = {}) {
  if (criticos.length === 0) return [];

  const porId = new Map();
  for (let i = 0; i < criticos.length; i += LOTE_IA) {
    const lote = criticos.slice(i, i + LOTE_IA);
    const { filas = [] } = await pedir(fetchImpl, "/api/evaluar-criticidad", {
      tarea: "fmea",
      producto,
      forma,
      parametros: lote.map((p) => ({
        id: p.id,
        magnitud: p.magnitud,
        etapa: p.etapa,
        seccion: p.seccion,
        criterios: p.criterios,
        afecta: p.afecta,
        severidad: p.severidad,
      })),
    });
    for (const f of filas) porId.set(String(f?.id || ""), f);
  }

  return criticos.map((p) => {
    const f = porId.get(p.id);
    const probabilidad = severidadValida(f?.probabilidad);
    const detectabilidad = severidadValida(f?.detectabilidad);
    return {
      ...p,
      probabilidad,
      detectabilidad,
      npr: npr(p.severidad, probabilidad, detectabilidad),
      racionalFmea: f?.racional || "",
    };
  });
}

/** Paso 5 — el requisito de muestreo que sale de la severidad de cada atributo. */
export function pasoEstadistico(severidades) {
  const porNivel = new Map();
  for (const s of severidades) {
    const req = requisitoEstadistico(s.severidad);
    if (!req) continue;
    if (!porNivel.has(req.etiqueta)) {
      porNivel.set(req.etiqueta, {
        ...req,
        n: muestraPorAtributo(req.confianza, req.cobertura),
        atributos: [],
      });
    }
    porNivel.get(req.etiqueta).atributos.push(s.atributo);
  }
  return [...porNivel.values()];
}

/**
 * La corrida entera.
 *
 * Va etapa por etapa en el Paso 2 porque los atributos son de la etapa: la
 * hermeticidad es del blíster y se decide en envase, no en fabricación.
 */
export async function correr(documentos, { producto, forma, atributosExtra = [], onAvance, fetchImpl = fetch } = {}) {
  const avisos = [];
  const aviso = (paso, err) => avisos.push(`Paso ${paso}: ${err.message}`);

  // Paso 0
  onAvance?.({ paso: 0, texto: "Identificando atributos de calidad…" });
  const { parametros, atributos } = separarLecturas(documentos);
  const todosLosAtributos = [...atributos, ...atributosExtra];

  if (todosLosAtributos.length === 0) {
    return { atributos: [], severidades: [], filas: [], fmea: [], estadistico: [], resumen: null,
             avisos: ["No se reconoció ningún atributo de calidad en los documentos cargados."] };
  }

  // Paso 1
  onAvance?.({ paso: 1, texto: "Fijando la severidad de cada atributo…" });
  let severidades = [];
  let discrepancias = [];
  try {
    const r = await pasoSeveridad(todosLosAtributos, { producto, forma, fetchImpl });
    severidades = r.filas;
    discrepancias = r.discrepancias;
  } catch (err) {
    aviso(1, err);
  }

  const mapa = mapaDeSeveridades(severidades);
  const conSeveridad = todosLosAtributos.map((a) => ({ ...a, severidad: mapa[a.nombre] ?? null }));

  // Paso 2, etapa por etapa
  const etapas = [...new Set(parametros.map((p) => p.etapa))];
  const screening = [];
  for (const etapa of etapas) {
    const deLaEtapa = porRelevancia(parametros.filter((p) => p.etapa === etapa));
    const suyos = conSeveridad.filter((a) => !a.etapa || a.etapa === etapa);
    onAvance?.({ paso: 2, texto: `${etapa} · analizando ${deLaEtapa.length} parámetros…` });
    try {
      screening.push(...(await pasoScreening(deLaEtapa, { producto, forma, etapa, atributos: suyos, fetchImpl })));
    } catch (err) {
      aviso(2, err);
      // Sin screening, los parámetros de esa etapa siguen en el cuadro: se
      // quedan sin sospecha y bajan a la pregunta de desempeño, que es lo
      // que corresponde cuando no hay información.
      screening.push(...deLaEtapa.map((p) => ({ ...p, id: idDe(p), sospecha: false, afecta: [], racional: "", fuenteSospecha: "sin resolver" })));
    }
  }

  // Paso 3
  onAvance?.({ paso: 3, texto: "Clasificando…" });
  const { filas, paraFmea, resumen } = evaluar(screening, mapa);

  // Paso 4
  let fmea = [];
  if (paraFmea.length > 0) {
    onAvance?.({ paso: 4, texto: `FMEA de ${paraFmea.length} parámetros críticos…` });
    try {
      fmea = await pasoFmea(paraFmea, { producto, forma, fetchImpl });
    } catch (err) {
      aviso(4, err);
      fmea = paraFmea.map((p) => ({ ...p, probabilidad: null, detectabilidad: null, npr: null, racionalFmea: "" }));
    }
  }

  // Paso 5
  const estadistico = pasoEstadistico(severidades);

  return { atributos: conSeveridad, severidades, discrepancias, filas, fmea, estadistico, resumen, avisos };
}
