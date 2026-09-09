// Pone el resultado del registro de manufactura al lado del parámetro que el
// protocolo manda verificar.
//
// Son dos documentos que hablan de lo mismo con nombres distintos: el
// protocolo dice "Temperatura … 60 °C ± 5 °C" bajo el título "Enfriamiento
// (1) de la solución de hidróxido de potasio"; el registro dice "TEMPERATURA
// (4.4.5 ENFRIAR): 60". No hay una clave común, así que el emparejado se
// hace por lo único que los dos escriben igual: la magnitud que se mide y el
// rango que se exige.
//
// La regla es deliberadamente estricta. Un Formato 02 con un resultado
// puesto en la fila equivocada es peor que uno con la casilla en blanco: la
// casilla vacía se llena a mano al ejecutar el lote, el dato mal colocado se
// firma. Por eso, cuando la evidencia no alcanza, no se rellena nada.

import { limitesDe } from "../rango.js";
import { SECCION_SIN_TIEMPO_RE } from "../parsers/tiempos.js";

// Qué magnitud mide un parámetro, por cómo se llama. Es el primer filtro:
// una temperatura no puede emparejarse con una velocidad aunque los dos
// rangos coincidan por casualidad.
const MAGNITUDES = [
  { tipo: "temperatura", re: /TEMPERATURA/i },
  { tipo: "humedad", re: /HUMEDAD/i },
  { tipo: "presion", re: /PRESI[OÓ]N|VAC[IÍ]O/i },
  { tipo: "velocidad", re: /VELOCIDAD|AGITACI[OÓ]N|RPM/i },
  { tipo: "tiempo", re: /TIEMPO|DURACI[OÓ]N/i },
  { tipo: "peso", re: /PESO|CANTIDAD|LLENADO/i },
  { tipo: "espesor", re: /ESPESOR|PARED/i },
  { tipo: "ph", re: /\bpH\b/i },
  { tipo: "dureza", re: /DUREZA/i },
  { tipo: "rendimiento", re: /RENDIMIENTO|MERMA/i },
];

export function magnitudDe(nombre) {
  for (const m of MAGNITUDES) if (m.re.test(nombre || "")) return m.tipo;
  return null;
}

/** Los límites de un criterio, en forma comparable ("60±5" y "55-65" son lo mismo). */
function huella(criterio) {
  const l = limitesDe(criterio);
  if (!l) return null;
  const cifra = (n) => (n === null ? "*" : String(Math.round(n * 1000) / 1000));
  return `${cifra(l.min)}..${cifra(l.max)}`;
}

/**
 * A qué parte del registro corresponde cada etapa del protocolo.
 *
 * El protocolo separa en etapas lo que el registro de una cápsula blanda
 * guarda dentro de un solo documento de FABRICACION: encapsulado, secado e
 * inspección son secciones suyas. Por eso una etapa del protocolo se resuelve
 * primero contra las etapas del registro y, si no hay ninguna que se le
 * parezca, contra las secciones.
 */
function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

const SINONIMOS = [
  // Un "tiempo de espera" no es una operación: no tiene sala, ni turno, ni
  // lecturas propias en el registro. Va primero y sin equivalencia para que
  // no se lo lleve la etapa cuyo nombre menciona ("tiempo de espera de
  // inspección…" contiene "inspección"): con las lecturas de la inspección
  // dentro, el cuadro daba por medidas del almacén las de la sala de
  // inspección, que es un dato distinto de otro sitio.
  { etapa: /TIEMPO DE ESPERA/, seccion: null },
  { etapa: /DISPENSACION/, seccion: /DISPENSACION|PREPARACION DEL MATERIAL/ },
  { etapa: /FABRICACION/, seccion: /FABRICACION|PREPARACION DEL BULK|PREPARACION DE LA GELATINA/ },
  { etapa: /ENCAPSULADO|PRESECADO|PRE-SECADO/, seccion: /ENCAPSULADO|PRE\s*-?\s*SECADO/ },
  { etapa: /^SECADO/, seccion: /^SECADO/ },
  { etapa: /INSPECCION|LUSTRADO|SELLADO DE CAPSULAS/, seccion: /INSPECCION/ },
  { etapa: /ENVASE|BLISTEADO/, seccion: /ENVASE|BLISTER/ },
  { etapa: /ACONDICIONADO/, seccion: /ACONDICIONADO|IMPRESION DE CAJAS/ },
];

function reglaDe(etapaProtocolo) {
  const nombre = normalizar(etapaProtocolo);
  const regla = SINONIMOS.find((s) => s.etapa.test(nombre)) || null;
  return regla?.seccion ? regla : null;
}

/**
 * Los parámetros del registro que pueden corresponder a una etapa del
 * protocolo: los del documento de esa etapa, y si no, los de las secciones
 * que llevan su nombre dentro de cualquier documento.
 */
export function ambitoDe(documentos, etapaProtocolo) {
  const regla = reglaDe(etapaProtocolo);
  if (!regla) return [];

  // Las secciones que pertenecen a OTRA etapa del protocolo. En una cápsula
  // blanda el registro de FABRICACION contiene además el encapsulado, el
  // secado y la inspección, que el protocolo trata como etapas aparte: sin
  // apartarlas, la etapa de Fabricación se llevaba lecturas del encapsulado
  // por el simple hecho de estar en el mismo documento.
  const ajenas = SINONIMOS.filter((otra) => otra !== regla && otra.seccion).map((otra) => otra.seccion);
  const deOtraEtapa = (seccion) =>
    !regla.seccion.test(seccion) && ajenas.some((re) => re.test(seccion));

  const params = [];
  for (const doc of documentos) {
    const esSuEtapa = regla.etapa.test(normalizar(doc.stage));
    for (const p of doc.params || []) {
      const seccion = normalizar(p.section);
      const esSuSeccion = regla.seccion.test(seccion);
      // Dentro del documento de la etapa cuentan sus parámetros, salvo los de
      // una sección que otra etapa reclama; en otro documento, sólo los de
      // una sección con su nombre.
      const dentro = esSuEtapa ? !deOtraEtapa(seccion) : esSuSeccion;
      if (dentro) params.push({ ...p, lote: doc.lote, stage: doc.stage, esSuSeccion });
    }
  }
  return params;
}

/**
 * Empareja las filas de una etapa del protocolo con los parámetros del
 * registro, en el orden en que unas y otros aparecen.
 *
 * Devuelve, por cada fila, el parámetro del registro que le corresponde o
 * null. Un parámetro del registro se usa una sola vez: si dos filas del
 * protocolo compiten por él, se lo queda la primera, que es la que va antes
 * en la secuencia.
 */
export function emparejarEtapa(filasProtocolo, paramsRegistro) {
  const usados = new Set();
  const salida = [];

  for (const fila of filasProtocolo) {
    if (fila.tipo !== "parametro") {
      salida.push({ fila, param: null });
      continue;
    }

    const nombre = [fila.grupo, fila.detalle].filter(Boolean).join(" ");
    const tipo = magnitudDe(nombre);
    const marca = huella(fila.rango);

    // Sin magnitud reconocible o sin rango numérico no hay con qué decidir, y
    // adivinar por el orden a secas colocaría resultados en filas ajenas.
    if (!tipo || !marca) {
      salida.push({ fila, param: null });
      continue;
    }

    const i = paramsRegistro.findIndex(
      (p, k) =>
        !usados.has(k) &&
        magnitudDe(p.baseLabel || p.label) === tipo &&
        huella(p.setpoint) === marca
    );

    if (i === -1) {
      salida.push({ fila, param: null });
      continue;
    }

    usados.add(i);
    salida.push({ fila, param: paramsRegistro[i] });
  }

  return salida;
}

/**
 * La cabecera de una etapa en el Formato 02: sala, personal, condiciones
 * ambientales y las horas de inicio y final.
 *
 * Sólo se rellena lo que el registro dice con todas las letras. Lo que no
 * conste se queda en blanco, que es como el formato se lleva a planta.
 */
export function cabeceraDeEtapa(documentos, etapaProtocolo) {
  const regla = reglaDe(etapaProtocolo);
  if (!regla) return {};

  const docs = (documentos || []).filter((d) => regla.etapa.test(normalizar(d.stage)));
  // Una etapa del protocolo que no tiene documento propio (encapsulado,
  // secado, inspección de una cápsula blanda) vive dentro de otro: su gente y
  // sus horas salen de la sección con ese nombre.
  const porSeccion = [];
  for (const doc of documentos || []) {
    for (const [seccion, suyos] of Object.entries(doc.personnel?.porSeccion || {})) {
      if (regla.seccion.test(normalizar(seccion))) porSeccion.push(suyos);
    }
  }

  // Con documento propio manda su lista completa; una etapa que vive dentro
  // de otro documento (el encapsulado de una cápsula blanda) sólo tiene la
  // gente de su sección.
  const nombres = (rol) => {
    const vistos = new Set();
    if (docs.length > 0) {
      for (const d of docs) for (const p of d.personnel?.[rol] || []) vistos.add(p.name);
    } else {
      for (const s of porSeccion) for (const p of s[rol] || []) vistos.add(p.name);
    }
    return [...vistos].sort();
  };

  const params = ambitoDe(documentos, etapaProtocolo);
  const valores = (re) =>
    params.filter((x) => re.test(normalizar(x.baseLabel || x.label)) && x.value != null).map((x) => String(x.value).trim());
  const primero = (re) => valores(re)[0] || "";

  // Sólo la temperatura y la humedad DE SALA: la etiqueta es la magnitud a
  // secas, con el paso entre paréntesis como mucho. "TEMPERATURA DE MOLDEO"
  // es la de la blistera —135 °C— y no tiene nada que hacer en la casilla de
  // condiciones ambientales.
  const ambiental = (re) => {
    const p = params.find((x) => re.test(normalizar(x.baseLabel || x.label)) && x.value != null);
    return p ? String(p.value).trim() : "";
  };

  // Del primer inicio al último final, no del primero de cada clase: una
  // etapa con varias operaciones nombradas cerraba en cuanto acababa la
  // primera.
  //
  // El papeleo y el set up quedan fuera, igual que quedan fuera del tiempo de
  // proceso en el resto de la aplicación: el último "set up" del lote 2081266
  // termina a las 16:00 del día 20 —limpiando la sala— y hacía que la etapa
  // de fabricación pareciera durar cuatro días más de lo que duró.
  const deProceso = (re) =>
    params
      .filter((x) => re.test(normalizar(x.baseLabel || x.label)) && x.value != null && !SECCION_SIN_TIEMPO_RE.test(x.section || ""))
      .map((x) => String(x.value).trim())
      .sort();

  const finales = deProceso(/^FECHA\s*\/\s*HORA\s+FINAL\s+DE/);
  const inicios = deProceso(/^FECHA\s*\/\s*HORA\s+INICIO\s+DE/);

  const operarios = nombres("operarios");
  const supervisores = nombres("supervisores");

  return {
    sala: primero(/^(LINEA\s*\/\s*SALA|SALA|SECCION)$/),
    personal: [...operarios, ...supervisores].join(", "),
    temperatura: ambiental(/^TEMPERATURA\s*(\(|$)/),
    humedad: ambiental(/^HUMEDAD RELATIVA\s*(\(|$)/),
    inicio: inicios[0] || "",
    final: finales[finales.length - 1] || "",
  };
}

/**
 * El cuadro armado sólo con los registros, cuando no hay protocolo a mano.
 *
 * Sale más pobre y lo dice: la secuencia es la del registro —sus secciones y
 * el orden en que las escribe—, no la de operaciones con nombre del
 * protocolo, y la columna "Modo de verificación" va vacía porque el registro
 * no dice con qué instrumento se mide cada cosa. A cambio, cada fila lleva su
 * resultado sin emparejar nada: el parámetro y su valor vienen juntos del
 * mismo sitio, así que aquí no hay nada que pueda caer en la fila equivocada.
 *
 * Devuelve la misma forma que `emparejarEtapa`, para que el documento se arme
 * igual venga de donde venga.
 */
export function etapasDesdeRegistros(documentos) {
  const porEtapa = new Map();

  for (const doc of documentos || []) {
    const etapa = doc.stage || "SIN ETAPA";
    if (!porEtapa.has(etapa)) porEtapa.set(etapa, []);
    const emparejado = porEtapa.get(etapa);
    let seccion = null;

    for (const p of doc.params || []) {
      // Las bandas del cuadro son las secciones del propio registro.
      if (p.section && p.section !== seccion) {
        seccion = p.section;
        emparejado.push({ fila: { tipo: "banda", titulo: seccion }, param: null });
      }
      // Lo que el registro marca como banda ya es un rótulo, no un parámetro.
      if (p.banda) {
        emparejado.push({ fila: { tipo: "banda", titulo: p.label }, param: null });
        continue;
      }
      emparejado.push({
        fila: {
          tipo: "parametro",
          grupo: p.label || "",
          detalle: p.unit && !String(p.label).includes(p.unit) ? p.unit : "",
          modo: "",
          rango: p.setpoint || "",
        },
        param: p,
      });
    }
  }

  return [...porEtapa.entries()].map(([etapa, emparejado]) => ({ etapa, emparejado }));
}

/** Cuántas filas quedaron con resultado, para poder decirlo en pantalla. */
export function resumenDeCobertura(emparejado) {
  const parametros = emparejado.filter((e) => e.fila.tipo === "parametro");
  return { total: parametros.length, conResultado: parametros.filter((e) => e.param).length };
}
