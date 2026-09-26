// El protocolo y el registro de manufactura, fila por fila.
//
// El análisis de riesgo del protocolo nombra cada parámetro por su operación
// ("Dispersión de ibuprofeno — Temperatura 55 °C ± 5 °C"); el RMD, por su paso
// ("4.4.8 TEMPERATURA 55 °C ± 5 °C · reg. 55 °C"). El prompt de Validaciones
// pide las dos cosas juntas: cada parámetro con su paso del RM y su valor
// registrado, y además los pasos del RM que el protocolo no evalúa
// (enjuagues, condiciones ambientales, inspección…), marcados «No incluido».
//
// Se casan en el orden del proceso —el protocolo y el RMD van los dos en ese
// orden—, así que las cinco "Temperatura chaqueta 70 °C a 85 °C" de la
// gelatina van cada una a su paso y no todas al primero que se parece. La
// comparación mira el tipo de magnitud (temperatura con temperatura, tiempo
// con tiempo), las cifras del rango y las palabras.

import { limitesDe } from "../rango.js";
import { referenciaDeRm, separarLecturas, valoresRegistrados } from "../atributos/modelo.js";
import { idDe } from "../atributos/pregunta.js";
import { compararPasos } from "./orden.js";

const FAMILIAS = [
  ["PRESION", /PRESI[OÓ]N|VAC[IÍ]O|\bMPA\b|\bPSI\b|\bKGF\b/i],
  ["TEMPERATURA", /TEMPERATURA|CHILLER/i],
  ["VELOCIDAD", /VELOCIDAD|\bRPM\b|\bCPM\b/i],
  ["TIEMPO", /\bTIEMPO\b|DURACI[OÓ]N|MINUTOS?\b|\bHORAS?\b/i],
  ["HUMEDAD", /HUMEDAD/i],
  ["BRIX", /BRIX/i],
  ["ESPESOR", /ESPESOR/i],
  ["PISTON", /PIST[OÓ]N/i],
  ["FORMATO", /FORMATO/i],
  ["MALLA", /MALLA/i],
  ["DOSIFICACION", /DOSIFICACI[OÓ]N|PESO DE LLENADO/i],
  ["PESO", /\bPESO\b|PESAJE|PESAR/i],
  ["PH", /\bPH\b/i],
];

function familia(texto) {
  const t = String(texto || "");
  // "Tiempo de vacío" es un tiempo, no una presión.
  if (/^\s*TIEMPO\b/i.test(t)) return "TIEMPO";
  return FAMILIAS.find(([, re]) => re.test(t))?.[0] || null;
}

const VACIAS = new Set(["PARA", "CON", "DEL", "LOS", "LAS", "UNA", "POR", "QUE", "SEGUN", "DESDE", "HASTA", "ENTRE", "TANQUE", "APROX"]);
function palabras(texto) {
  return new Set(
    String(texto || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .map((w) => SINONIMOS[w] || w)
      .filter((w) => w.length >= 4 && !VACIAS.has(w) && !/^\d+$/.test(w))
  );
}

// El protocolo y el RMD no siempre usan la misma palabra para lo mismo.
const SINONIMOS = { INTERNA: "INTERIOR", INTERNO: "INTERIOR" };

// La capacidad del equipo ("tanque de 1000 L") no es una lectura: se quita
// para que no se confunda con los valores del parámetro.
function cifras(texto) {
  const limpio = String(texto || "").replace(/\d+(?:[.,]\d+)?\s*L\b/gi, " ");
  return new Set((limpio.match(/-?\d+(?:[.,]\d+)?/g) || []).map((n) => String(parseFloat(n.replace(",", ".")))));
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return comunes / (a.size + b.size - comunes);
}

/** El grupo de RMD de una etapa: fabricación, envase o acondicionado. */
export function grupoDeEtapa(etapa) {
  const t = String(etapa || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/ACONDICION/.test(t)) return "ACONDICIONADO";
  if (/ENVAS|BLIST/.test(t)) return "ENVASE";
  return "FABRICACION";
}

const NO_ES_PARAMETRO = /^(SECCION|LINEA|CODIGO|CANTIDAD (TEORICA|MUESTREADA|ENTREGADA|OBTENIDA)|MERMA|CALCULO DE RENDIMIENTO|PESO OBTENIDO BANDEJA)/i;

/** Las lecturas de proceso de los RMD, en el orden en que se leen. */
export function lecturasDelRmd(documentos) {
  const salida = [];
  for (const doc of documentos || []) {
    if (doc?.kind === "orden") continue;
    const { parametros } = separarLecturas([doc]);
    const deParametro = new Map();
    for (const p of parametros) for (const l of p.lecturas) deParametro.set(l, p);
    (doc.params || []).forEach((l, orden) => {
      const p = deParametro.get(l);
      if (!p || !l.paso || NO_ES_PARAMETRO.test(String(l.label || "").trim())) return;
      salida.push({
        grupo: grupoDeEtapa(doc.stage || doc.meta?.stage),
        etapaRm: doc.stage || doc.meta?.stage || "",
        lote: doc.lote || doc.meta?.lote || "",
        orden,
        paso: l.paso,
        seccion: l.section || p.seccion,
        magnitud: p.magnitud,
        etiqueta: l.label,
        setpoint: l.setpoint || "",
        lectura: l,
      });
    });
  }
  return salida;
}

// Dónde se mide: la temperatura de la chaqueta no es la del interior del
// tanque, aunque el rango del protocolo cubra las dos lecturas.
const EXCLUYENTES = [["CHAQUETA", "INTERIOR"], ["ENTRADA", "SALIDA"], ["SUPERIOR", "INFERIOR"]];

function seExcluyen(a, b) {
  const pa = palabras(a);
  const pb = palabras(b);
  return EXCLUYENTES.some(([x, y]) => (pa.has(x) && !pa.has(y) && pb.has(y) && !pb.has(x)) || (pa.has(y) && !pa.has(x) && pb.has(x) && !pb.has(y)));
}

// "12 – 24 horas" no es una lectura de "153 min": sin cifras en común, la
// unidad es lo único que dice que no son lo mismo.
function unidadDeTiempo(texto) {
  const t = String(texto || "");
  if (/\bh(oras?|rs?)?\b/i.test(t)) return "h";
  if (/\bmin(utos?)?\b/i.test(t)) return "min";
  return null;
}

function mismaUnidadDeTiempo(a, b) {
  const ua = unidadDeTiempo(a);
  const ub = unidadDeTiempo(b);
  return !ua || !ub || ua === ub;
}

/** Qué tan bien casa una fila del protocolo con una lectura del RMD (0 = nada). */
export function parecido(fila, lec) {
  const fp = familia(fila.magnitud) || familia(fila.criterios?.join(" "));
  const fl = familia(lec.etiqueta) || familia(lec.magnitud);
  if (fp && fl && fp !== fl) return 0;
  if (seExcluyen(fila.magnitud, lec.etiqueta)) return 0;
  const cp = cifras(fila.criterios?.join(" "));
  const cl = cifras(lec.setpoint);
  const lp = limitesDe(fila.criterios?.join(" "));
  const ll = limitesDe(lec.setpoint);
  const mismoRango = lp && ll && lp.min === ll.min && lp.max === ll.max;
  const pp = palabras(`${fila.magnitud} ${fila.seccion}`);
  const pl = palabras(`${lec.etiqueta} ${lec.seccion}`);
  // La etapa del protocolo suele nombrar la sección del RMD ("Encapsulado y
  // Presecado" ↔ "ENCAPSULADO", "Secado" ↔ "SECADO N° 1").
  const mismaSeccion = jaccard(palabras(fila.etapa), palabras(lec.seccion)) > 0 ? 0.8 : 0;
  // "Referencial" en el protocolo y "% Referencial" en el RMD: los dos dicen
  // que no hay rango, y eso también es coincidir.
  const sinRango = /REFERENCIAL|INFORMATIVO/i;
  const ambosSinRango = sinRango.test(fila.criterios?.join(" ") || "") && sinRango.test(lec.setpoint || "") ? 1 : 0;
  const base = (fp && fl ? 1 : 0) + 2.5 * jaccard(cp, cl) + (mismoRango ? 1.5 : 0) + 2 * jaccard(pp, pl) + ambosSinRango;
  // Hace falta algo más que el tipo de magnitud: una cifra o una palabra en
  // común. Sin eso, una "Temperatura" cualquiera casaría con la primera. La
  // sección sólo desempata: no basta por sí sola.
  return base >= 1.6 ? base + mismaSeccion : 0;
}

/**
 * Casa, en orden, las filas del protocolo con las lecturas de un mismo RMD.
 * Devuelve, por índice de fila, la lectura asignada (o null).
 *
 * El orden se exige por PASO, no por lectura: dentro de un paso el RMD anota
 * las lecturas en el orden de su formulario (velocidad, temperatura,
 * tiempo) y el protocolo en el suyo (temperatura, tiempo, velocidad).
 *
 * Programación dinámica sobre los pasos: M[i][k] es lo mejor que se logra con
 * las primeras i filas usando pasos hasta el k-1. Varias filas pueden caer
 * en el mismo paso, pero nunca una fila posterior en un paso anterior.
 * Después, dentro de cada paso, cada fila se queda con su lectura, sin
 * repetir mientras haya otra.
 */
function alinearEnOrden(filas, lecturas) {
  const pasos = [];
  const porPaso = new Map();
  for (const l of lecturas) {
    if (!porPaso.has(l.paso)) {
      porPaso.set(l.paso, []);
      pasos.push(l.paso);
    }
    porPaso.get(l.paso).push(l);
  }
  const R = filas.length;
  const K = pasos.length;
  const puntajes = filas.map((f) => pasos.map((p) => porPaso.get(p).map((l) => parecido(f, l))));
  const s = puntajes.map((fila) => fila.map((lista) => Math.max(0, ...lista)));

  const M = Array.from({ length: R + 1 }, () => new Float64Array(K + 1));
  for (let i = 0; i < R; i++) {
    for (let k = 1; k <= K; k++) {
      const con = s[i][k - 1] > 0 ? M[i][k] + s[i][k - 1] : -Infinity;
      M[i + 1][k] = Math.max(M[i + 1][k - 1], M[i][k], con);
    }
  }
  const pasoDe = new Array(R).fill(-1);
  let k = K;
  for (let i = R; i > 0; i--) {
    while (k > 0 && M[i][k] === M[i][k - 1]) k--;
    if (k === 0) break;
    const sc = s[i - 1][k - 1];
    if (sc > 0 && Math.abs(M[i][k] - (M[i - 1][k] + sc)) < 1e-9) pasoDe[i - 1] = k - 1;
  }

  // Dentro de cada paso, lectura por fila: primero los emparejamientos más
  // claros; a igual puntaje, en orden (la primera fila con la primera
  // lectura). Una lectura no se reparte: la fila que se queda sin ninguna
  // libre queda sin casar, que es mejor que casarla con la de otro.
  const asignado = new Array(R).fill(null);
  const tomadas = new Set();
  for (let g = 0; g < K; g++) {
    const suyas = pasoDe.map((pk, i) => (pk === g ? i : -1)).filter((i) => i >= 0);
    if (suyas.length === 0) continue;
    const candidatos = [];
    for (const i of suyas) puntajes[i][g].forEach((sc, n) => sc > 0 && candidatos.push({ i, n, sc }));
    // Puntajes casi iguales (±0.3) son un empate de verdad —dos "Presión de
    // vacío" con el mismo rango en el mismo paso—: se decide por el orden.
    const lecturasDelPaso = porPaso.get(pasos[g]);
    for (;;) {
      const libres = candidatos.filter((c) => !asignado[c.i] && !tomadas.has(lecturasDelPaso[c.n]));
      if (libres.length === 0) break;
      const tope = Math.max(...libres.map((c) => c.sc));
      const c = libres.filter((x) => x.sc >= tope - 0.3).sort((a, b) => a.n - b.n || a.i - b.i)[0];
      asignado[c.i] = lecturasDelPaso[c.n];
      tomadas.add(lecturasDelPaso[c.n]);
    }
  }

  // Huecos: una fila sin lectura entre dos que sí casaron ("TIEMPO" del
  // protocolo con "Homogeneización (2) NLT 15 min" del RMD, sin palabras ni
  // cifras en común). Se busca, entre los pasos de sus vecinas, una lectura
  // libre del mismo tipo de magnitud; si hay varias, la de más palabras en
  // común y, a igualdad, la primera. En el borde (la primera fila de la
  // etapa) sólo se mira el paso de la única vecina.
  const familiaDe = (f) => familia(f.magnitud) || familia(f.criterios?.join(" "));
  const hueco = (i, libre = (l) => !tomadas.has(l)) => {
    const fp = familiaDe(filas[i]);
    if (!fp) return [];
    let antes = null;
    for (let j = i - 1; j >= 0 && !antes; j--) if (asignado[j]) antes = asignado[j].paso;
    let despues = null;
    for (let j = i + 1; j < R && !despues; j++) if (asignado[j]) despues = asignado[j].paso;
    if (!antes && !despues) return [];
    antes = antes || despues;
    despues = despues || antes;
    const pp = palabras(`${filas[i].magnitud} ${filas[i].seccion}`);
    return lecturas
      .filter(
        (l) =>
          libre(l) &&
          (familia(l.etiqueta) || familia(l.magnitud)) === fp &&
          !seExcluyen(filas[i].magnitud, l.etiqueta) &&
          mismaUnidadDeTiempo(filas[i].criterios?.join(" "), `${l.setpoint} ${valoresRegistrados([l.lectura])}`) &&
          compararPasos(l.paso, antes) >= 0 &&
          compararPasos(l.paso, despues) <= 0
      )
      .map((l) => ({ l, sc: jaccard(pp, palabras(`${l.etiqueta} ${l.seccion}`)) }))
      .sort((a, b) => b.sc - a.sc || a.l.orden - b.l.orden);
  };

  // Corrimiento: una fila que casó con una lectura por la que empata con
  // otra, libre y más adelante (antes de su siguiente vecina), cede la suya
  // si una fila anterior sin lectura la necesita. Es el "Tiempo NLT 5 min"
  // del ajuste de °Brix: empata en 4.4.25 y en 4.4.27, y el 4.4.25 es el
  // tiempo de vacío de la fila de antes.
  for (let i = R - 1; i >= 0; i--) {
    const actual = asignado[i];
    if (!actual) continue;
    const necesitada = filas.some((_, u) => u < i && !asignado[u] && hueco(u, (l) => l === actual).length > 0);
    if (!necesitada) continue;
    const sc = parecido(filas[i], actual);
    let despues = null;
    for (let j = i + 1; j < R && !despues; j++) if (asignado[j]) despues = asignado[j].paso;
    const otra = lecturas.find(
      (l) =>
        !tomadas.has(l) &&
        compararPasos(l.paso, actual.paso) > 0 &&
        (!despues || compararPasos(l.paso, despues) <= 0) &&
        parecido(filas[i], l) >= sc - 1e-9
    );
    if (!otra) continue;
    asignado[i] = otra;
    tomadas.add(otra);
    tomadas.delete(actual);
  }

  for (let i = 0; i < R; i++) {
    if (asignado[i]) continue;
    const libres = hueco(i);
    if (libres.length > 0) {
      asignado[i] = libres[0].l;
      tomadas.add(libres[0].l);
    }
  }

  // Lo que el orden no deja casar pero es inequívoco: una fila sin lectura
  // cuyo rango coincide exacto con UNA sola lectura libre (la presión interior
  // del tanque de gelatina, 0.03–0.06 MPa, que el protocolo lista antes que
  // el RMD).
  for (let i = 0; i < R; i++) {
    if (asignado[i]) continue;
    const fuertes = lecturas.filter((l) => !tomadas.has(l) && parecido(filas[i], l) >= 4);
    if (fuertes.length === 1) {
      asignado[i] = fuertes[0];
      tomadas.add(fuertes[0]);
    }
  }
  return asignado;
}

/**
 * La etapa del protocolo que nombra la sección del RMD: la que contiene más
 * palabras de la sección. Las etapas de tiempos de espera ("Tiempo de reposo
 * de gelatina entre la fabricación y el encapsulado") no cuentan: nombran dos
 * etapas a la vez y se lo llevarían todo.
 */
function etapaPorNombre(etapas, lec) {
  const deSeccion = palabras(lec.seccion);
  if (deSeccion.size === 0) return null;
  let mejor = null;
  let tope = 0;
  for (const e of etapas) {
    if (grupoDeEtapa(e) !== lec.grupo || /TIEMPO DE (ESPERA|REPOSO)|ESPERA/i.test(e)) continue;
    const pe = palabras(e);
    let comunes = 0;
    for (const w of deSeccion) if (pe.has(w)) comunes++;
    const cobertura = comunes / deSeccion.size;
    if (cobertura > tope) {
      tope = cobertura;
      mejor = e;
    }
  }
  return tope >= 0.3 ? mejor : null;
}

/**
 * Enriquece las filas del protocolo con su paso y su valor del RMD, y arma
 * las filas «No incluido» con lo que el RMD controla y el protocolo no.
 *
 * Devuelve { filas, noIncluidas }: las del protocolo, con `pasos`,
 * `referenciaRm`, `valorRegistrado` y `setpointRm` cuando casaron; y las
 * nuevas, listas para pasar por el screening.
 */
export function alinearConRmd(filasProtocolo, documentos) {
  const lecturas = lecturasDelRmd(documentos);
  if (lecturas.length === 0) return { filas: filasProtocolo, noIncluidas: [] };

  const usadas = new Set();
  const filas = filasProtocolo.map((f) => ({ ...f }));
  for (const grupo of [...new Set(lecturas.map((l) => l.grupo))]) {
    const suyas = lecturas.filter((l) => l.grupo === grupo).sort((a, b) => a.orden - b.orden);
    const idx = filas.map((f, i) => ({ f, i })).filter(({ f }) => grupoDeEtapa(f.etapa) === grupo);
    const asignado = alinearEnOrden(idx.map((x) => x.f), suyas);
    asignado.forEach((lec, n) => {
      if (!lec) return;
      usadas.add(lec);
      const f = filas[idx[n].i];
      f.pasos = [lec.paso];
      f.referenciaRm = referenciaDeRm(lec.etapaRm, [lec.paso]);
      f.valorRegistrado = valoresRegistrados([lec.lectura]);
      f.setpointRm = lec.setpoint;
    });
  }

  // El extractor da a veces el mismo set-point a dos lecturas de un paso
  // ("POR NO MENOS DE 5 MINUTOS" para el tiempo de agitación y para el de
  // vacío del 4.4.25, que en el RMD es "NO MENOR A 25 MINUTOS"). Si esas
  // lecturas casaron con filas de rango distinto, el set-point no vale para
  // la que no coincide: se deja vacío antes que atribuirle al RMD un rango
  // que no dice.
  const porSetpoint = new Map();
  for (const f of filas) {
    if (!f.setpointRm || !f.pasos?.length) continue;
    const clave = `${f.pasos[0]}|${f.setpointRm}`;
    if (!porSetpoint.has(clave)) porSetpoint.set(clave, []);
    porSetpoint.get(clave).push(f);
  }
  const mismos = (a, b) => a && b && a.min === b.min && a.max === b.max;
  for (const grupoFilas of porSetpoint.values()) {
    if (grupoFilas.length < 2) continue;
    const delRm = limitesDe(grupoFilas[0].setpointRm);
    const coinciden = grupoFilas.filter((f) => mismos(limitesDe(f.criterios?.join(" ")), delRm));
    if (coinciden.length === 0 || coinciden.length === grupoFilas.length) continue;
    for (const f of grupoFilas) if (!coinciden.includes(f)) f.setpointRm = "";
  }

  // Lo que el RMD controla y ningún parámetro del protocolo recoge: un
  // parámetro «No incluido» por paso y magnitud.
  const porClave = new Map();
  for (const lec of lecturas) {
    if (usadas.has(lec)) continue;
    const clave = `${lec.grupo}|${lec.paso}|${lec.magnitud}`;
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(lec);
  }
  const conPaso = filas.filter((f) => f.pasos?.length);
  const etapasDelProtocolo = [...new Set(filas.map((f) => f.etapa))];
  const noIncluidas = [...porClave.values()].map((grupoLecturas) => {
    const lec = grupoLecturas[0];
    // La etapa del protocolo donde cae ese paso: la de la última fila casada
    // con un paso anterior o igual, dentro del mismo RMD.
    // Primero, la etapa cuyo nombre coincide con la sección del RMD
    // ("ENCAPSULADO" → "Encapsulado y Presecado"); si no, la de la última
    // fila casada con un paso anterior o igual.
    const porNombre = etapaPorNombre(etapasDelProtocolo, lec);
    const anteriores = conPaso.filter((f) => grupoDeEtapa(f.etapa) === lec.grupo && compararPasos(f.pasos[0], lec.paso) <= 0);
    const etapa = porNombre || (anteriores.length ? anteriores[anteriores.length - 1].etapa : lec.etapaRm);
    const seccion = `${lec.paso} ${lec.seccion}`.trim();
    return {
      id: `${idDe({ etapa, seccion, magnitud: lec.magnitud })}-ni`,
      etapa,
      seccion,
      magnitud: lec.magnitud,
      ejemplo: lec.etiqueta,
      criterios: [...new Set(grupoLecturas.map((l) => l.setpoint).filter(Boolean))],
      veces: grupoLecturas.length,
      pasos: [lec.paso],
      referenciaRm: referenciaDeRm(lec.etapaRm, [lec.paso]),
      valorRegistrado: valoresRegistrados(grupoLecturas.map((l) => l.lectura)),
      setpointRm: lec.setpoint,
      clasificacionAnterior: "No incluido",
      noIncluido: true,
    };
  });
  return { filas, noIncluidas };
}
