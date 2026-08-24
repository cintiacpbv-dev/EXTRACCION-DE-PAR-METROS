// Cuánto duró cada operación del registro.
//
// El registro anota la hora de inicio y la de final de cada trabajo, pero no
// lo que tardó: eso hay que restarlo. Y las horas viven como trazabilidad, de
// modo que no llegaban al cuadro de verificación de parámetros.
//
// Las parejas se arman en el orden en que aparecen en el documento, no por
// sección: el registro intercala pasos cuyo texto el detector toma por título
// ("UBICAR EL DISPENSADOR DE CINTA..."), y eso deja el inicio y el final de un
// mismo trabajo en secciones distintas. En el papel, en cambio, cada "FECHA /
// HORA FINAL" cierra siempre el "FECHA / HORA INICIO" que viene antes.

const INICIO_RE = /^FECHA\s*\/\s*HORA\s+INICI(?:O|AL)\b/i;
const FINAL_RE = /^FECHA\s*\/\s*HORA\s+FINAL\b/i;
const FECHA_HORA_RE = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/;

// Lo que rodea al proceso pero no es el proceso: papeleo, alistar el material
// y las máquinas, y el desmontaje de después. Duran minutos y no dicen nada
// de cuánto se tarda en fabricar, envasar o acondicionar un lote, así que no
// llevan tiempo ni cuentan para el total de la etapa.
const SECCION_SIN_TIEMPO_RE =
  /^(DOCUMENTACION|DOCUMENTACIÓN|PREPARACION|PREPARACIÓN|SET\s*UP\s*\(\s*POST)/i;

export const SECCION_TOTAL = "TIEMPO TOTAL DE LA ETAPA";

/** Instante de un valor "2026-08-02 01:56", en minutos, o null. */
function instante(valor) {
  const m = String(valor ?? "").match(FECHA_HORA_RE);
  if (!m) return null;
  const [, a, mes, d, h, min] = m;
  const t = Date.UTC(+a, +mes - 1, +d, h ? +h : 0, min ? +min : 0);
  return Number.isNaN(t) ? null : Math.round(t / 60000);
}

/**
 * Duración en horas y minutos. Se expresa siempre en horas, sin pasar a días:
 * un envase que cruza la medianoche se lee mejor como "30 h 58 min" que como
 * "1 d 6 h 58 min" cuando se compara con el de otro lote.
 */
export function formatoDuracion(minutos) {
  if (minutos === null || minutos < 0) return null;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h === 0 ? `${m} min` : `${h} h ${m} min`;
}

function fila({ section, label, value, orden }) {
  return {
    id: `tiempo__${orden}__${label.toLowerCase().replace(/[^a-z]+/g, "_")}`,
    section,
    label,
    baseLabel: label,
    occurrence: 1,
    counterKey: `${section}|${label}`,
    setpoint: "",
    unit: "",
    valueType: "text",
    value,
    // Se marca como crítico para que llegue al cuadro de verificación de
    // parámetros: como trazabilidad se quedaría fuera, que es donde estaba.
    category: "critico",
    page: 0,
  };
}

/**
 * Añade a los parámetros detectados, por cada trabajo con inicio y final, la
 * hora de una y otra y lo que tardó; y al final, el total de la etapa.
 *
 * Las filas nuevas se intercalan justo detrás del "FECHA / HORA FINAL" que
 * cierra cada trabajo, para que en el cuadro salgan dentro de su sección y en
 * el orden en que ocurren.
 */
export function conTiempos(params) {
  const salida = [];
  let abierto = null;
  let bloques = 0;
  let primero = null;
  let ultimo = null;

  for (const p of params) {
    salida.push(p);

    if (INICIO_RE.test(p.baseLabel || p.label)) {
      const t = instante(p.value);
      if (t !== null) abierto = { seccion: p.section, valor: p.value, t };
      continue;
    }

    if (!FINAL_RE.test(p.baseLabel || p.label) || !abierto) continue;

    const t = instante(p.value);
    if (t === null) continue;

    const duracion = formatoDuracion(t - abierto.t);
    if (duracion === null || SECCION_SIN_TIEMPO_RE.test(abierto.seccion)) {
      abierto = null;
      continue;
    }

    bloques += 1;
    if (primero === null || abierto.t < primero.t) primero = { t: abierto.t, valor: abierto.valor };
    if (ultimo === null || t > ultimo.t) ultimo = { t, valor: p.value };

    // La sección es la del inicio: es donde empieza el trabajo, y el final
    // puede haber caído en otra por un paso intermedio tomado por título.
    const section = abierto.seccion;
    salida.push(fila({ section, label: "HORA INICIO", value: abierto.valor, orden: bloques }));
    salida.push(fila({ section, label: "HORA FINAL", value: p.value, orden: bloques }));
    salida.push(fila({ section, label: "TIEMPO TRANSCURRIDO", value: duracion, orden: bloques }));

    abierto = null;
  }

  // Total de la etapa: del primer inicio al último final. Con varios bloques
  // separados por días —Fabricación granula, espera y luego mezcla— este total
  // incluye la espera, así que acompaña a los tiempos de cada bloque en vez de
  // sustituirlos.
  if (bloques > 1 && primero && ultimo) {
    const total = formatoDuracion(ultimo.t - primero.t);
    if (total !== null) {
      salida.push(fila({ section: SECCION_TOTAL, label: "HORA INICIO", value: primero.valor, orden: 0 }));
      salida.push(fila({ section: SECCION_TOTAL, label: "HORA FINAL", value: ultimo.valor, orden: 0 }));
      salida.push(fila({ section: SECCION_TOTAL, label: "TIEMPO TRANSCURRIDO", value: total, orden: 0 }));
    }
  }

  return salida;
}
