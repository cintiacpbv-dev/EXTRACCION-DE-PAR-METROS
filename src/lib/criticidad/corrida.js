// Una corrida completa del Procedimiento de Evaluación de Criticidad y Riesgo.
//
// Encadena los 7 pasos sobre los registros ya cargados. Lo que decide cada
// paso y quién lo decide:
//
//   Paso 0  Atributos de calidad ........ el registro y el protocolo (leídos)
//   Paso 1  Severidad por atributo ...... lo guardado, y la IA para lo que falte,
//                                         con la evidencia de Consulta PDF
//   Paso 2  Causa-efecto por parámetro .. la IA, con la evidencia de Consulta PDF
//                                         (o el protocolo, revisado por ambas)
//   Paso 3  Clasificación ............... una regla, sin IA
//   Paso 4  FMEA de los Críticos ........ la IA propone P y D
//   Paso 5  Vínculo estadístico ......... una fórmula, sin IA
//   Paso 6  Plan de reevaluación ........ texto fijo del procedimiento
//
// Los pasos 3 y 5 no le preguntan a nadie a propósito: son reglas
// deterministas, y pedírselas a un modelo sólo añadiría una forma de que
// salgan mal. La IA se usa donde hace falta juicio y nada más.

import { separarLecturas, porRelevancia } from "../atributos/modelo.js";
import { idDe, preguntaDe } from "../atributos/pregunta.js";
import { evaluar, npr, requisitoEstadistico, muestraPorAtributo } from "./modelo.js";
import { aplicarSeveridadesDePlanta, fusionar, mapaDeSeveridades, severidadValida } from "./severidad.js";
import { atributosDelProtocolo, resolverAfecta } from "./protocolo.js";
import { consultarBibliografia, evidenciasDeAtributos, revisarCausaEfecto, revisarSeveridades } from "./corroborar.js";

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
export async function pasoSeveridad(atributos, { producto, forma, corroborar = false, onAvance, fetchImpl = fetch } = {}) {
  // Las decisiones de Validaciones primero: lo que ya está fijado para la
  // planta no se le pregunta a la IA.
  aplicarSeveridadesDePlanta(atributos.map((a) => a.nombre));
  const enUso = mapaDeSeveridades();
  const faltan = atributos.filter((a) => !(a.nombre in enUso));

  // Lo que dice la bibliografía de cada atributo: la consecuencia de que
  // falle. Se pide para todos, no sólo para los nuevos, porque también sirve
  // para revisar las severidades que ya estaban guardadas.
  const evidencias = corroborar
    ? await evidenciasDeAtributos(atributos, {
        producto,
        forma,
        fetchImpl,
        onAvance: ({ hechas, total }) => onAvance?.(`Consulta PDF · ${hechas} de ${total} atributos…`),
      })
    : new Map();

  let propuestas = [];
  if (faltan.length > 0) {
    onAvance?.(`IA · proponiendo la severidad de ${faltan.length} atributo(s)…`);
    const { filas = [] } = await pedir(fetchImpl, "/api/evaluar-criticidad", {
      tarea: "severidad",
      producto,
      forma,
      atributos: faltan.map((a) => ({
        nombre: a.nombre,
        criterio: a.criterios?.[0] || a.especificacion || "",
        etapa: a.etapa,
        evidencia: evidencias.get(a.nombre) || null,
      })),
    });
    propuestas = filas;
  }

  const { filas, discrepancias } = fusionar(propuestas);
  // Sólo los atributos de esta corrida, en el orden en que se midieron.
  const nombres = new Set(atributos.map((a) => a.nombre));
  const deEstaCorrida = filas.filter((f) => nombres.has(f.atributo));

  // Qué respaldo tiene cada severidad. Las propuestas ahora ya se hicieron
  // con la evidencia delante; las que venían guardadas reciben una segunda
  // opinión, que se enseña pero no se aplica sola.
  const corroboracion = {};
  const nuevas = new Set(faltan.map((a) => a.nombre));
  for (const f of deEstaCorrida) {
    const evidencia = evidencias.get(f.atributo);
    if (nuevas.has(f.atributo) && evidencia) {
      corroboracion[f.atributo] = { coincide: true, severidadSugerida: null, motivo: "", referencias: evidencia.referencias, conEvidencia: true };
    }
  }
  let avisoRevision = "";
  if (corroborar) {
    const guardadas = deEstaCorrida.filter((f) => !nuevas.has(f.atributo));
    if (guardadas.length > 0) {
      onAvance?.(`IA · revisando ${guardadas.length} severidad(es) guardada(s)…`);
      try {
        Object.assign(corroboracion, await revisarSeveridades(guardadas, { producto, forma, evidencias, fetchImpl }));
      } catch (err) {
        avisoRevision = `no se pudo revisar las severidades guardadas (${err.message}).`;
      }
    }
  }

  return {
    filas: deEstaCorrida,
    discrepancias,
    consultados: faltan.length,
    corroboracion,
    avisoRevision,
  };
}

/**
 * Paso 2 — el screening causa-efecto.
 *
 * Primero la bibliografía: lo que Consulta PDF responda con citas se le da a
 * la IA como evidencia de ese parámetro, y la IA decide con ella delante —
 * la fila queda con su referencia. Que la bibliografía esté caída no puede
 * dejar el paso sin resultado: la IA contesta igual, sin evidencia.
 */
export async function pasoScreening(parametros, { producto, forma, etapa, atributos, corroborar = true, onAvance, fetchImpl = fetch } = {}) {
  // La bibliografía primero, y su respuesta se le PASA a la IA: así la IA
  // decide con la evidencia delante en vez de contestar por su lado.
  const respaldos = corroborar
    ? await consultarBibliografia(
        parametros.map((p) => ({ id: idDe(p), pregunta: preguntaDe(p, { producto, atributos }) })),
        { fetchImpl, onAvance: ({ hechas, total }) => onAvance?.(`${etapa} · Consulta PDF · ${hechas} de ${total}…`) }
      )
    : new Map();

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
        evidencia: respaldos.get(idDe(p)) || null,
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
      // La pregunta de desempeño de proceso, que es la que decide entre Clave
      // y No Clave para todo lo que no llega a Crítico. Si la IA no la
      // contesta se queda en null y la fila sale "pendiente": suponer un NO
      // convertiría en "No Clave" a parámetros que nadie miró.
      desempeno: typeof cruda?.desempeno === "boolean" ? cruda.desempeno : null,
      desempenoMotivo: cruda?.desempenoMotivo || "",
      codigoOrigen: ["CP", "L", "E", "M"].includes(cruda?.codigoOrigen) ? cruda.codigoOrigen : "",
      atributosFueraDeLista: fuera,
      // El mecanismo que escribió la IA ya viene razonado con la evidencia y
      // con su cita; la respuesta entera de la bibliografía sólo queda cuando
      // la IA no dijo nada.
      racional: cruda?.origen || respaldo?.texto || "",
      referencias: respaldo?.referencias || "",
      fuenteSospecha: respaldo ? (cruda ? "IA+bibliografía" : "bibliografía") : cruda ? "IA" : "sin resolver",
    };
  });
}

/**
 * Pasos 0 y 2 leídos del protocolo, cuando el protocolo trae su análisis de
 * riesgo.
 *
 * Es el camino bueno, y el que siguen las corridas: el Paso 0 es la
 * especificación del producto terminado más los atributos citados en el
 * análisis, y el Paso 2 es ese mismo análisis — su texto es el origen de la
 * sospecha y su columna «Afecta» dice con qué atributo. Nada de eso se le
 * pregunta a la IA: ya está escrito y firmado en el protocolo.
 *
 * Lo único que el protocolo no contesta es la pregunta de desempeño de los
 * parámetros que no llegan a Críticos, salvo cuando su «Afecta» nombra el
 * tiempo de proceso o el rendimiento — que es justamente la respuesta SÍ.
 */
export function desdeProtocolo(protocolo) {
  const catalogo = atributosDelProtocolo(protocolo);
  const vistos = new Map();

  const filas = protocolo.analisis.map((f) => {
    const { calidad, desempeno } = resolverAfecta(
      f.afecta.map((a) => a.atributo),
      catalogo,
      protocolo.especificaciones
    );
    // El mismo parámetro puede repetirse en la misma operación ("Tiempo"
    // dos veces); el número lo mantiene distinto.
    const base = idDe({ etapa: f.etapa, seccion: f.operacion, magnitud: f.parametro });
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);

    return {
      id: n > 1 ? `${base}-${n}` : base,
      etapa: f.etapa,
      seccion: f.operacion,
      magnitud: f.parametro,
      ejemplo: f.parametro,
      criterios: f.setpoint ? [f.setpoint] : [],
      veces: 1,
      sospecha: calidad.length > 0,
      afecta: calidad,
      racional: f.analisis,
      referencias: "",
      fuenteSospecha: "protocolo",
      clasificacionAnterior: f.clasificacionAnterior,
      acopladoCon: f.acopladoCon,
      desempeno: desempeno.length > 0 ? true : null,
      desempenoMotivo: desempeno.length > 0 ? `El análisis de riesgo lo vincula a: ${desempeno.join(", ")}.` : "",
    };
  });

  return { atributos: catalogo, filas };
}

/**
 * La pregunta de desempeño, para las filas que el protocolo dejó sin
 * contestar.
 *
 * Se reusa la tarea de screening de la IA pero sólo se toma su respuesta de
 * desempeño: la sospecha y los atributos ya los dijo el protocolo y NO se
 * sobrescriben con lo que opine el modelo.
 */
async function contestarDesempeno(filas, { producto, forma, atributos, fetchImpl }) {
  const pendientes = filas.filter((f) => f.desempeno === null);
  if (pendientes.length === 0) return filas;

  const respuestas = new Map();
  for (const etapa of [...new Set(pendientes.map((f) => f.etapa))]) {
    const suyas = pendientes.filter((f) => f.etapa === etapa);
    for (let i = 0; i < suyas.length; i += LOTE_IA) {
      const lote = suyas.slice(i, i + LOTE_IA);
      const { filas: r = [] } = await pedir(fetchImpl, "/api/evaluar-criticidad", {
        tarea: "screening",
        producto,
        forma,
        etapa,
        atributos: atributos.map((a) => ({ nombre: a.nombre, severidad: a.severidad })),
        parametros: lote.map((p) => ({ id: p.id, magnitud: p.magnitud, seccion: p.seccion, criterios: p.criterios })),
      });
      for (const x of r) respuestas.set(String(x?.id || ""), x);
    }
  }

  return filas.map((f) => {
    if (f.desempeno !== null) return f;
    const r = respuestas.get(f.id);
    if (typeof r?.desempeno !== "boolean") return f;
    return { ...f, desempeno: r.desempeno, desempenoMotivo: r.desempenoMotivo || "", desempenoPorIA: true };
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
      modoFalla: f?.modoFalla || "",
      controles: f?.controles || "",
      accion: f?.accion || "",
      responsable: f?.responsable || "",
    };
  });
}

/**
 * Paso 5 — el requisito de muestreo que sale de la severidad de cada atributo.
 *
 * Agrupado por nivel de severidad, que es como lo trae la Tabla 9 del
 * procedimiento, y dentro de cada nivel separado por TIPO DE DATO (Tabla 8):
 * no es lo mismo el requisito para la valoración —un número, que se trata con
 * un intervalo de tolerancia— que para la ausencia de E. coli —un sí o un
 * no, que se trata con confianza-confiabilidad y cero defectos—. El n de la
 * tabla sólo vale para los segundos; decirlo para todos sería engañoso.
 */
export function pasoEstadistico(severidades, atributos = []) {
  const tipoDe = new Map(atributos.map((a) => [a.nombre, a.tipoDeDato]));
  const porNivel = new Map();
  for (const s of severidades) {
    const req = requisitoEstadistico(s.severidad);
    if (!req) continue;
    if (!porNivel.has(req.etiqueta)) {
      porNivel.set(req.etiqueta, {
        ...req,
        n: muestraPorAtributo(req.confianza, req.cobertura),
        atributos: [],
        continuos: [],
        deAtributo: [],
      });
    }
    const g = porNivel.get(req.etiqueta);
    g.atributos.push(s.atributo);
    // Sin tipo conocido se trata como pasa/no pasa: es la lectura prudente,
    // la que exige n cero defectos en vez de suponer que hay una medida.
    if (tipoDe.get(s.atributo) === "Continuo") g.continuos.push(s.atributo);
    else g.deAtributo.push(s.atributo);
  }
  return [...porNivel.values()];
}

/**
 * La corrida entera.
 *
 * Va etapa por etapa en el Paso 2 porque los atributos son de la etapa: la
 * hermeticidad es del blíster y se decide en envase, no en fabricación.
 */
export async function correr(
  documentos,
  { producto, forma, protocolo = null, atributosExtra = [], corroborar = true, onAvance, fetchImpl = fetch } = {}
) {
  const avisos = [];
  const aviso = (paso, err) => avisos.push(`Paso ${paso}: ${err.message}`);

  // Con el análisis de riesgo del protocolo, los pasos 0 y 2 salen de él.
  if (protocolo?.analisis?.length > 0) {
    return correrDesdeProtocolo(protocolo, { producto, forma, corroborar, onAvance, fetchImpl, avisos, aviso });
  }

  // Paso 0
  onAvance?.({ paso: 0, texto: "Identificando atributos de calidad…" });
  const { parametros, atributos } = separarLecturas(documentos);
  // Sin análisis de riesgo, la especificación del protocolo (si la hay) se
  // suma a los atributos leídos del registro.
  const deEspecificacion = protocolo?.especificaciones || [];
  const todosLosAtributos = [...deEspecificacion, ...atributos, ...atributosExtra];

  if (todosLosAtributos.length === 0) {
    return { atributos: [], severidades: [], filas: [], fmea: [], estadistico: [], resumen: null,
             avisos: ["No se reconoció ningún atributo de calidad en los documentos cargados."] };
  }

  // Paso 1
  onAvance?.({ paso: 1, texto: "Fijando la severidad de cada atributo…" });
  const { severidades, discrepancias, corroboracionSeveridad } = await severidadesDeLaCorrida(todosLosAtributos, {
    producto, forma, corroborar, onAvance, fetchImpl, aviso, avisos,
  });

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
      screening.push(
        ...(await pasoScreening(deLaEtapa, {
          producto, forma, etapa, atributos: suyos, corroborar, fetchImpl,
          onAvance: (texto) => onAvance?.({ paso: 2, texto }),
        }))
      );
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
  const estadistico = pasoEstadistico(severidades, conSeveridad);

  return {
    atributos: conSeveridad, severidades, discrepancias, corroboracionSeveridad, filas, fmea, estadistico, resumen, avisos,
    fuente: "registros", corroborada: corroborar,
  };
}

/** El Paso 1 dentro de una corrida: si falla, la corrida sigue con aviso. */
async function severidadesDeLaCorrida(atributos, { producto, forma, corroborar, onAvance, fetchImpl, aviso, avisos }) {
  try {
    const r = await pasoSeveridad(atributos, {
      producto, forma, corroborar, fetchImpl,
      onAvance: (texto) => onAvance?.({ paso: 1, texto }),
    });
    if (r.avisoRevision) avisos.push(`Paso 1: ${r.avisoRevision}`);
    return { severidades: r.filas, discrepancias: r.discrepancias, corroboracionSeveridad: r.corroboracion };
  } catch (err) {
    aviso(1, err);
    return { severidades: [], discrepancias: [], corroboracionSeveridad: {} };
  }
}

/**
 * La corrida cuando el protocolo trae su análisis de riesgo: los pasos 0 y 2
 * vienen escritos, y la IA se usa sólo para la severidad (Paso 1), la
 * pregunta de desempeño que el protocolo no contesta, y P y D de los Críticos.
 */
async function correrDesdeProtocolo(protocolo, { producto, forma, corroborar, onAvance, fetchImpl, avisos, aviso }) {
  onAvance?.({ paso: 0, texto: "Leyendo atributos y análisis de riesgo del protocolo…" });
  const { atributos, filas: screening } = desdeProtocolo(protocolo);

  onAvance?.({ paso: 1, texto: "Fijando la severidad de cada atributo…" });
  const { severidades, discrepancias, corroboracionSeveridad } = await severidadesDeLaCorrida(atributos, {
    producto, forma, corroborar, onAvance, fetchImpl, aviso, avisos,
  });
  const mapa = mapaDeSeveridades(severidades);
  const conSeveridad = atributos.map((a) => ({ ...a, severidad: mapa[a.nombre] ?? null }));

  onAvance?.({ paso: 2, texto: "Contestando la pregunta de desempeño que el protocolo no responde…" });
  let conDesempeno = screening;
  try {
    conDesempeno = await contestarDesempeno(screening, { producto, forma, atributos: conSeveridad, fetchImpl });
  } catch (err) {
    aviso(2, err);
  }

  // El análisis de riesgo del protocolo, revisado contra la bibliografía y
  // la IA. No cambia ningún vínculo: marca lo que falta o sobra para que
  // quien valida lo acepte o no.
  if (corroborar) {
    onAvance?.({ paso: 2, texto: "Corroborando el análisis de riesgo con Consulta PDF y la IA…" });
    try {
      conDesempeno = await revisarCausaEfecto(conDesempeno, {
        producto, forma, atributos: conSeveridad, fetchImpl,
        onAvance: (texto) => onAvance?.({ paso: 2, texto }),
      });
    } catch (err) {
      aviso(2, err);
    }
  }

  onAvance?.({ paso: 3, texto: "Clasificando…" });
  const { filas, paraFmea, resumen } = evaluar(conDesempeno, mapa);

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

  return {
    atributos: conSeveridad, severidades, discrepancias, corroboracionSeveridad, filas, fmea,
    estadistico: pasoEstadistico(severidades, conSeveridad), resumen, avisos, fuente: "protocolo",
    corroborada: corroborar,
  };
}
