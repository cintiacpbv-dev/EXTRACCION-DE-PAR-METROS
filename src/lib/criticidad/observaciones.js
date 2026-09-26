// Lo que el prompt de Validaciones pide revisar además de la clasificación:
//
//   · observaciones_rm: la coherencia de los registros de manufactura —lotes
//     distintos entre etapas, valores fuera de rango, valores en el límite,
//     campos en blanco, horas que no cuadran—.
//   · revision_protocolo: la tabla de cambios de clasificación (anterior →
//     nueva) y las observaciones al protocolo independientes de la
//     metodología, con su prioridad.
//   · datos_a_confirmar: lo que falta para cerrar la evaluación.
//
// Todo esto se calcula, no se le pregunta a la IA: son comparaciones que se
// pueden hacer exactas con lo que ya se leyó, y dejarlas a un modelo sólo
// añadiría la posibilidad de que se las invente.

import { evaluarValor, limitesDe } from "../rango.js";
import { referenciaDeRm } from "../atributos/modelo.js";
import { CLAVE, CRITICO, NO_CLAVE } from "./modelo.js";

const ES_CHECK = /^[üü✓√]$/i;
const HORA = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function aSegundos(texto) {
  const m = String(texto || "").trim().match(HORA);
  return m ? +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0) : null;
}

const conUnidad = (l) => {
  const v = String(l.value ?? "").trim();
  return l.unit && !v.toLowerCase().includes(String(l.unit).toLowerCase()) ? `${v} ${l.unit}` : v;
};

const etiquetaLimpia = (l) => String(l.label || "").replace(/\s*\([^)]*\d+\.\d+[^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();

/**
 * Las observaciones a los registros de manufactura.
 * Cada una: { referencia, observacion, accion }.
 */
export function observacionesDelRmd(documentos = []) {
  const docs = (documentos || []).filter((d) => d && d.kind !== "orden");
  const salida = [];

  // Lotes distintos entre etapas.
  const lotePorEtapa = new Map();
  for (const d of docs) {
    const etapa = d.stage || d.meta?.stage;
    const lote = d.lote || d.meta?.lote;
    if (etapa && lote && !lotePorEtapa.has(etapa)) lotePorEtapa.set(etapa, lote);
  }
  if (new Set(lotePorEtapa.values()).size > 1) {
    salida.push({
      referencia: "Lotes de referencia",
      observacion: `Los registros son de lotes distintos: ${[...lotePorEtapa].map(([e, l]) => `${e.toLowerCase()} lote ${l}`).join(", ")}.`,
      accion: "Se usaron como referencia del mismo proceso; no son el mismo lote.",
    });
  }

  const enLimite = [];
  for (const d of docs) {
    const etapa = d.stage || d.meta?.stage || "";
    const params = d.params || [];
    for (const l of params) {
      if (!l.paso) continue;
      const ref = referenciaDeRm(etapa, [l.paso]);
      const valor = String(l.value ?? "").trim();
      const limites = limitesDe(l.setpoint);

      // Campo en blanco: tiene criterio y no tiene nada (una casilla marcada
      // es una verificación hecha, no un blanco).
      if (l.setpoint && !valor) {
        salida.push({ referencia: ref, observacion: `${etiquetaLimpia(l)}: campo en blanco (criterio ${l.setpoint}).`, accion: "Completar el registro." });
        continue;
      }
      if (!limites || !valor || ES_CHECK.test(valor)) continue;

      const estado = evaluarValor(valor, l.setpoint);
      const n = parseFloat(valor.replace(",", "."));
      if (estado === "fuera") {
        const signoCambiado =
          Number.isFinite(n) && limites.min !== null && limites.max !== null && limites.max < 0 && n > 0;
        salida.push({
          referencia: ref,
          observacion: signoCambiado
            ? `${etiquetaLimpia(l)} registrada ${conUnidad(l)} frente al rango ${l.setpoint}: el signo o la unidad no corresponden.`
            : `${etiquetaLimpia(l)} registrado ${conUnidad(l)}, fuera del rango ${l.setpoint}.`,
          accion: signoCambiado ? "Revisar la coherencia del dato (ALCOA+)." : "Evaluar si corresponde registrar una desviación.",
        });
      } else if (estado === "dentro" && Number.isFinite(n) && limites.min !== limites.max) {
        if ((limites.min !== null && Math.abs(n - limites.min) < 1e-9) || (limites.max !== null && Math.abs(n - limites.max) < 1e-9)) {
          enLimite.push(`${etiquetaLimpia(l).toLowerCase()} ${conUnidad(l)} (${l.setpoint}; ${ref.replace(/^RM \w+\. /, "")})`);
        }
      }
    }

    // Horas: una final anterior a la inicial, o un inicio sin final.
    const porPaso = new Map();
    for (const l of params) {
      if (!l.paso || !/HORA\s+(INICI|FINAL|FIN\b)/i.test(l.label || "")) continue;
      if (!porPaso.has(l.paso)) porPaso.set(l.paso, []);
      porPaso.get(l.paso).push(l);
    }
    for (const [paso, lecturas] of porPaso) {
      const ref = referenciaDeRm(etapa, [paso]);
      const inicios = lecturas.filter((l) => /INICI/i.test(l.label));
      const finales = lecturas.filter((l) => /FINAL|FIN\b/i.test(l.label));
      inicios.forEach((ini, k) => {
        const fin = finales[k];
        const si = aSegundos(ini.value);
        if (si === null) return;
        const sf = aSegundos(fin?.value);
        if (!fin || sf === null) {
          if (fin && !String(fin.value ?? "").trim()) {
            salida.push({ referencia: ref, observacion: `Hora de inicio ${ini.value} sin hora final registrada.`, accion: "Completar el registro." });
          }
          return;
        }
        // Una final "anterior" por pocas horas es un error; por muchas, un
        // cruce de medianoche.
        if (sf < si && si - sf < 12 * 3600) {
          salida.push({ referencia: ref, observacion: `Hora final ${fin.value} anterior a la hora de inicio ${ini.value}.`, accion: "Revisar la coherencia de los datos (ALCOA+)." });
        }
      });
    }
  }

  if (enLimite.length > 0) {
    salida.push({
      referencia: "Valores en el límite",
      observacion: `Valores registrados justo en el límite del rango: ${enLimite.slice(0, 12).join("; ")}${enLimite.length > 12 ? "…" : ""}.`,
      accion: "No son desviaciones. Considerar set-points en zona central o confirmar los rangos en el protocolo.",
    });
  }
  return salida;
}

// --- revisión del protocolo -----------------------------------------------

const EQUIVALENTE = { "CRÍTICO": CRITICO, CRITICO: CRITICO, CLAVE: CLAVE, "NO CLAVE": NO_CLAVE };
const PALABRA = { [CRITICO]: "PCP", [CLAVE]: "Clave", [NO_CLAVE]: "No clave" };

function normal(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

/**
 * La tabla de cambios de clasificación: el esquema anterior del protocolo
 * (Crítico / Potencial / Clave) frente al nuevo (PCP / Clave / No clave). No
 * es un error del protocolo: es la migración. «Potencial» siempre cambia,
 * porque en el esquema nuevo no existe.
 */
export function cambiosDeClasificacion(filas, numeros = new Map()) {
  return filas
    .filter((f) => f.clasificacionAnterior && !/NO INCLUIDO|SIN PROTOCOLO|NOTA/i.test(f.clasificacionAnterior) && f.clasificacion)
    .filter((f) => EQUIVALENTE[normal(f.clasificacionAnterior).replace("CRITICO", "CRÍTICO")] !== f.clasificacion && EQUIVALENTE[normal(f.clasificacionAnterior)] !== f.clasificacion)
    .map((f) => ({
      n: numeros.get(f.id),
      parametro: f.magnitud,
      etapa: f.etapa,
      anterior: f.clasificacionAnterior,
      nueva: PALABRA[f.clasificacion] || f.clasificacion,
      motivo:
        f.clasificacion === CRITICO
          ? `Vinculado a ${f.afecta?.join(", ") || "un ACC"} (S ${f.severidad}).`
          : f.sospecha
            ? `Su atributo tiene severidad ${f.severidad ?? "—"} (< 4); ${f.desempeno ? "afecta al desempeño" : "no afecta al desempeño"}.`
            : `Sin sospecha de impacto; ${f.desempeno ? "afecta al desempeño" : "no afecta al desempeño"}.`,
    }));
}

const SIN_RANGO = /SEG[UÚ]N LO OBSERVADO|REFERENCIAL|INFORMATIVO/i;

/**
 * Las observaciones al protocolo independientes de la metodología.
 * Cada una: { prioridad, seccion, dice, observacion, propuesta }.
 */
// "Nivel 5 – Nivel 8 (Aprox. 2 – 3 seg.)": el rango es el de los niveles; lo
// que va entre paréntesis es su equivalencia aproximada.
function rangoPrincipal(texto) {
  return String(texto || "")
    .replace(/\((?:aprox|equivale)[^)]*\)/gi, " ")
    .replace(/\bnivel\s+(\d+(?:[.,]\d+)?)\s*([–-]|a)\s*nivel\s+/gi, "Nivel $1 $2 ");
}

export function observacionesDelProtocolo(filas, { atributos = [], numeros = new Map() } = {}) {
  const salida = [];
  const n = (f) => (numeros.get(f.id) ? ` (${numeros.get(f.id)})` : "");

  const noIncluidos = filas.filter((f) => f.noIncluido || /NO INCLUIDO/i.test(f.clasificacionAnterior || ""));
  if (noIncluidos.length > 0) {
    const pcp = noIncluidos.filter((f) => f.clasificacion === CRITICO);
    salida.push({
      prioridad: pcp.length ? "Alta" : "Media",
      seccion: "Análisis de riesgo",
      dice: "—",
      observacion: `${noIncluidos.length} parámetro(s) del RM no están en el análisis de riesgo del protocolo${pcp.length ? `, ${pcp.length} de ellos PCP (${pcp.map((f) => `${f.magnitud}${n(f)}`).slice(0, 6).join("; ")})` : ""}.`,
      propuesta: "Incorporarlos al análisis de riesgo (ver «No incluido» en la clasificación anterior).",
    });
  }

  for (const f of filas) {
    if (f.noIncluido) continue;
    const dice = f.criterios?.join(" ; ") || "";
    const rangoRm = limitesDe(f.setpointRm);
    const rangoP = limitesDe(rangoPrincipal(dice));
    // Un tiempo de espera sin máximo es su propia observación (el prompt la
    // nombra aparte): va antes que la genérica de "sin rango".
    if (/TIEMPO DE (ESPERA|REPOSO)|ESPERA/i.test(`${f.etapa} ${f.seccion}`) && /TIEMPO/i.test(f.magnitud) && !(rangoP && rangoP.max !== null)) {
      salida.push({
        prioridad: "Media",
        seccion: `${f.etapa} · ${f.magnitud}${n(f)}`,
        dice: dice || "—",
        observacion: "Tiempo de espera sin máximo definido.",
        propuesta: "Definir el tiempo máximo con un estudio de tiempos de espera.",
      });
      continue;
    }
    if (dice && SIN_RANGO.test(dice)) {
      salida.push(
        rangoRm
          ? { prioridad: "Alta", seccion: `${f.etapa} · ${f.magnitud}${n(f)}`, dice, observacion: `El RM define un rango (${f.setpointRm}, ${f.referenciaRm}).`, propuesta: `Declarar el rango del RM en el protocolo.` }
          : { prioridad: "Media", seccion: `${f.etapa} · ${f.magnitud}${n(f)}`, dice, observacion: "Sin rango definido en el protocolo ni en el RM.", propuesta: "Definir el rango de operación o justificar que es informativo." }
      );
      continue;
    }
    if (rangoP && rangoRm && (rangoP.min !== rangoRm.min || rangoP.max !== rangoRm.max)) {
      salida.push({
        prioridad: "Alta",
        seccion: `${f.etapa} · ${f.magnitud}${n(f)}`,
        dice,
        observacion: `El RM dice ${f.setpointRm} (${f.referenciaRm}).`,
        propuesta: "Unificar el rango del protocolo con el del registro vigente.",
      });
    }
  }

  const vinculados = new Set(filas.flatMap((f) => f.afecta || []));
  for (const a of atributos.filter((x) => x.origen === "especificación" && !vinculados.has(x.nombre))) {
    salida.push({
      prioridad: "Media",
      seccion: "Especificación de producto terminado",
      dice: a.nombre,
      observacion: "Atributo de la especificación sin ningún parámetro vinculado en el análisis de riesgo.",
      propuesta: "Revisar qué parámetros lo afectan (o justificar que se asegura por diseño) y registrarlo.",
    });
  }

  const orden = { Alta: 0, Media: 1, Baja: 2 };
  return salida.sort((a, b) => orden[a.prioridad] - orden[b.prioridad]);
}

/**
 * Lo que falta para cerrar la evaluación. Cada uno: { dato, porQue, evidencia }.
 */
export function datosAConfirmar({ filas = [], atributos = [], fmea = [], observacionesRm = [] } = {}) {
  const salida = [];
  if (fmea.length > 0 && fmea.some((f) => f.oCriterio !== "historial")) {
    salida.push({
      dato: "Ocurrencia de los PCP",
      porQue: "Asignada de forma provisional por la capacidad de control, sin historial de desviaciones.",
      evidencia: "Historial de desviaciones y no conformidades del producto y de la línea del último año.",
    });
  }
  const sinEspecificacion = atributos.filter((a) => a.origen === "especificación" && !a.especificacion && !a.criterios?.length);
  if (sinEspecificacion.length) {
    salida.push({
      dato: `Especificación de ${sinEspecificacion.map((a) => a.nombre).join(", ")}`,
      porQue: "No figura en los documentos cargados.",
      evidencia: "CoA y especificaciones de producto terminado vigentes.",
    });
  }
  const sinRango = filas.filter((f) => !f.criterios?.length || f.criterios.every((c) => SIN_RANGO.test(c)));
  if (sinRango.length) {
    salida.push({
      dato: `Rango de operación de ${sinRango.length} parámetro(s)`,
      porQue: "Sin rango en el protocolo ni en el RM (\"Por confirmar\"), o sólo informativo.",
      evidencia: "Rango de operación documentado o justificación de que es informativo.",
    });
  }
  const sinValor = filas.filter((f) => !f.noIncluido && f.clasificacion === CRITICO && !f.valorRegistrado);
  if (sinValor.length) {
    salida.push({
      dato: `Valor registrado de ${sinValor.length} PCP`,
      porQue: "El parámetro del protocolo no se encontró en el RM cargado (o no está en este lote).",
      evidencia: "El paso del RM donde se controla y su valor registrado.",
    });
  }
  if (observacionesRm.some((o) => o.referencia === "Lotes de referencia")) {
    salida.push({
      dato: "Lotes de los registros",
      porQue: "Los RM de las distintas etapas son de lotes diferentes.",
      evidencia: "Registros del mismo lote, si se requiere trazabilidad completa.",
    });
  }
  return salida;
}
