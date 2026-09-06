// El criterio de aceptación que está escrito DENTRO de la instrucción.
//
// En los registros de sólidos el criterio viene en una columna al lado de la
// casilla, y el detector genérico lo recoge sin ayuda. En los de semisólidos
// (cremas, geles, ungüentos) no: la instrucción lo dice en prosa y la casilla
// de al lado sólo trae el número que anotó el operario.
//
//   4.4.4.- ... ENFRIAR Y MANTENER A TEMPERATURA DE 70 ºC ± 2 ºC ...
//           TEMPERATURA (°C): 72.0          ← el detector veía sólo esto
//
// Sin el "70 ºC ± 2 ºC" el cuadro comparativo no puede decir si el lote
// cumplió, que es justo para lo que se usa. Aquí se recupera ese criterio.
//
// La regla es "la instrucción más cercana por encima, dentro del mismo paso":
// un paso puede fijar dos temperaturas distintas (4.4.7 funde a 72 ºC y luego
// manda mantener 70 ºC), y la que vale para una casilla es la que la precede,
// no la primera del paso. Cuando por encima no hay ninguna instrucción de esa
// magnitud, la casilla se queda sin criterio: es preferible a inventarle uno.

import { norm } from "./utils.js";

// Qué magnitud mide una etiqueta. Sólo se buscan criterios para lo que el
// protocolo de validación de un semisólido pide seguir; el resto del cuadro
// (pesos, códigos, cantidades) ya se lee bien como está.
const MAGNITUD = [
  { tipo: "temperatura", re: /TEMPERATURA/i },
  { tipo: "velocidad", re: /VELOCIDAD/i },
  { tipo: "ph", re: /^pH\b|\bpH\b/i },
];

// Cómo se escribe el criterio de cada magnitud en la instrucción.
//
// Se captura la frase tal como está en el documento, sin reescribirla: es lo
// que después se compara contra el protocolo, y una reescritura "más limpia"
// dejaría de coincidir con el papel que alguien tiene delante. Por eso los
// patrones toleran las variantes reales del registro —"70 ºC ± 2 ºC",
// "70° C ± 2 °C", "40°C ± 2°C"— e incluso sus erratas.
const PATRONES = {
  // "70 ºC ± 2 ºC" y también "72 ºC ± 2 ºC" o "40°C ± 2°C".
  temperatura: [
    /(\d+(?:[.,]\d+)?\s*[°ºo]\s*C\s*±\s*\d+(?:[.,]\d+)?\s*[°ºo]?\s*C?)/i,
    // "MAYOR O IGUAL A 65°C", "NO MENOS DE 60 ºC"
    /((?:MAYOR|MENOR|NO MENOS|NO MAS|NO MÁS)[^.]{0,20}?\d+(?:[.,]\d+)?\s*[°ºo]\s*C)/i,
    // Un rango explícito: "15 °C - 30 °C"
    /(\d+(?:[.,]\d+)?\s*[°ºo]\s*C\s*[-–a]\s*\d+(?:[.,]\d+)?\s*[°ºo]\s*C)/i,
  ],
  // "VELOCIDAD NIVEL 3", "A VELOCIDAD NIVEL 2", "(UNICA)"
  velocidad: [
    /(NIVEL\s*\d+)/i,
    /\b([UÚ]NICA)\b/i,
    /(\d+(?:[.,]\d+)?\s*(?:-|–|a)\s*\d+(?:[.,]\d+)?\s*(?:rpm|gpm))/i,
    /(\d+(?:[.,]\d+)?\s*(?:rpm|gpm))/i,
  ],
  // "RANGO DE pH :5.5 - 6.5". El rango tiene que venir acompañado de la
  // palabra "pH": un patrón de dos cifras separadas por guión, suelto, se
  // traga cualquier cosa con esa forma —una fecha del encabezado, "2026-07"—
  // y le pondría a la casilla un criterio que nadie escribió.
  ph: [/pH\s*[^:\d]{0,20}:?\s*(\d+(?:[.,]\d+)?\s*[-–a]\s*\d+(?:[.,]\d+)?)/i],
  // "POR NO MENOS DE 10 MIN", "ENTRE 20 A 25 MINUTOS", "POR NO NENOS DE 30
  // MINUTOS" (la errata es del registro, y aun así hay que entenderlo).
  //
  // Todos exigen la palabra que anuncia una duración —"por", "durante", "no
  // menos de", "entre… a…"—. Un patrón de "cifra + unidad" a secas parece
  // bastar y no basta: en estas páginas convive con "AGUA PURIFICADA … 10 L
  // 10.000" y con "HORA INICIO", y de ahí salían criterios inventados como
  // "10.000 HORA" o "048 HORA" pegados a una fila de tiempo.
  tiempo: [
    /((?:POR|DURANTE)?\s*(?:UN\s+TIEMPO\s+)?NO\s+\w{4,7}\s+DE\s+\d+(?:[.,]\d+)?\s*(?:MINUTOS?|MIN)\b)/i,
    /(ENTRE\s+\d+\s*(?:A|-|–)\s*\d+\s*(?:MINUTOS?|MIN|HORAS?)\b)/i,
    /((?:POR|DURANTE)\s+\d+(?:[.,]\d+)?\s*(?:MINUTOS?|MIN|HORAS?)\b)/i,
    // "MENOS DE 5 MIN" sin su "NO" delante: el renglón se parte justo ahí
    // ("...POR NO" / "MENOS DE 5 MIN...") y, encima, la columna "Realizado
    // Por" mete su palabra en medio, así que las dos mitades no se dejan
    // volver a pegar. La frase sigue siendo inequívoca por sí sola.
    /((?:M[EÁA]S|MENOS)\s+DE\s+\d+(?:[.,]\d+)?\s*(?:MINUTOS?|MIN)\b)/i,
    /(\d+\s*(?:A|-|–)\s*\d+\s*(?:MINUTOS?|MIN)\b)/i,
  ],
};

/** La primera de las formas de escribir el criterio que aparezca en la frase. */
function criterioEn(texto, tipo) {
  for (const re of PATRONES[tipo] || []) {
    const m = texto.match(re);
    if (m) return m[1].replace(/\s+/g, " ").trim();
  }
  return "";
}

function magnitudDe(label) {
  for (const m of MAGNITUD) if (m.re.test(label)) return m.tipo;
  return null;
}

// Una instrucción, no una casilla: las líneas que ya son "ETIQUETA: valor" son
// lo que el operario llenó, no lo que el registro manda. Sin esto, la casilla
// "TEMPERATURA (°C): 70.0" se tomaría a sí misma por criterio.
function esCasilla(texto) {
  return /:\s*\d+(?:[.,]\d+)?\s*$/.test(texto);
}

/**
 * Índice, por página, de las líneas con el paso al que pertenece cada una.
 *
 * Se recorre igual que el detector genérico para que los números de paso
 * coincidan; lo que aquí interesa de cada línea es su texto y su posición
 * vertical, que es como se localiza después cada lectura.
 */
function indexarPasos(pages) {
  const porPagina = new Map();
  // El paso NO se reinicia en cada página: una instrucción abre al pie de una
  // página y sus casillas caen en la siguiente, y el detector genérico las
  // cuenta como del mismo paso. Reiniciarlo aquí dejaba esas casillas sin
  // instrucción a la que mirar, que es como se perdían los criterios de los
  // pasos que cruzan de página.
  let paso = "";

  for (const page of pages) {
    const lineas = page.lines.map((l) => ({ y: l.y, texto: norm(l.text).trim() }));
    for (const linea of lineas) {
      const m = linea.texto.match(/^\s*(\d+(?:\.\d+)*)\s*\.-/);
      if (m) paso = m[1];
      linea.paso = paso;
    }
    porPagina.set(page.index, lineas);
  }

  return porPagina;
}

/**
 * Todas las líneas de un paso, en orden, aunque el paso cruce de una página a
 * la siguiente — cosa que pasa a menudo: la instrucción abre al pie de una
 * página y sus casillas caen en la siguiente.
 */
function lineasDelPaso(indice, paso) {
  const todas = [];
  for (const [pagina, lineas] of indice) {
    for (const linea of lineas) {
      if (linea.paso === paso) todas.push({ ...linea, pagina });
    }
  }
  return todas;
}

/**
 * Rellena el criterio de aceptación de las lecturas que no lo traían, leyendo
 * la instrucción del paso en el que están.
 *
 * Sólo AÑADE: una lectura que ya tenía criterio (porque venía en su columna,
 * como en los registros de sólidos) se queda con el suyo, que está más cerca
 * del dato y es más fiable.
 */
export function conCriteriosDelPaso(params, pages) {
  const indice = indexarPasos(pages);
  const cache = new Map();

  for (const p of params) {
    if (p.setpoint || !p.paso || p.y === undefined) continue;

    const tipo = magnitudDe(p.baseLabel || p.label || "");
    if (!tipo) continue;

    if (!cache.has(p.paso)) cache.set(p.paso, lineasDelPaso(indice, p.paso));
    const lineas = cache.get(p.paso);

    // Hacia arriba desde la casilla: la instrucción que la manda es la más
    // cercana por encima, no la primera del paso.
    const posicion = lineas.findIndex((l) => l.pagina === p.page && Math.abs(l.y - p.y) < 0.5);
    if (posicion < 0) continue;

    for (let i = posicion - 1; i >= 0; i--) {
      const linea = lineas[i];
      if (esCasilla(linea.texto)) continue;
      // Con el renglón siguiente pegado: el PDF parte las instrucciones donde
      // se acaba el ancho de la caja, y un criterio puede quedar cortado por
      // la mitad ("...A 70 º C ± 2" / "ºC."). Leído renglón a renglón se
      // capturaba el criterio incompleto, sin su unidad.
      const conSiguiente = [linea.texto, lineas[i + 1]?.texto].filter(Boolean).join(" ");
      const criterio = criterioEn(conSiguiente, tipo);
      if (criterio) {
        p.setpoint = criterio;
        // Deja constancia de que el criterio se leyó de la instrucción y no
        // de una columna: si algún día hay que revisar uno, se sabe dónde
        // mirar en el PDF.
        p.criterioDeInstruccion = true;
        break;
      }
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// Cómo se llama cada lectura
// ---------------------------------------------------------------------------

// Las operaciones de un semisólido. El registro las escribe como verbo dentro
// de la instrucción ("...FUNDIR A 72 ºC..."), y es lo que permite distinguir
// en el cuadro la temperatura del fundido de la de la emulsión.
const OPERACIONES =
  /\b(FUNDIR|HOMOGENEIZAR|HOMOGENIZAR|DISOLVER|EMULSIONAR|AGITAR|ENFRIAR|CALENTAR|HERVIR|FILTRAR|TRASVASAR|ADICIONAR|AGREGAR|MEZCLAR|SEPARAR|PESAR|RECOLECTAR|VERIFICAR|MOLER|TAMIZAR|SECAR|GRANULAR|COMPRIMIR|LLENAR|ENVASAR)\b/i;

/** El verbo que nombra la operación de un paso, si su instrucción lo dice. */
function operacionDe(tituloDelPaso) {
  const m = tituloDelPaso.match(OPERACIONES);
  return m ? m[1].toUpperCase() : "";
}

/**
 * Cómo se distingue una lectura de otra igual del mismo cuadro.
 *
 * "TEMPERATURA — Lectura 3" no dice nada: hay que ir al PDF a contar casillas
 * para saber de qué paso habla, y si un lote trae un paso de más, la Lectura 3
 * de un lote y la de otro ya no son la misma operación —y el cuadro compara
 * cosas distintas en la misma fila—. El número de paso sí es estable entre
 * lotes del mismo producto, y con el verbo al lado se lee sin abrir el
 * registro: "TEMPERATURA (4.4.7 FUNDIR)".
 */
function renombrarPorPaso(params, titulos) {
  for (const p of params) {
    if (!p.paso || !/— Lectura \d+$/.test(p.label || "")) continue;
    const operacion = operacionDe(titulos.get(p.paso) || "");
    p.label = `${p.baseLabel} (${p.paso}${operacion ? ` ${operacion}` : ""})`;
  }
  return params;
}

// ---------------------------------------------------------------------------
// Cuánto duró cada paso
// ---------------------------------------------------------------------------

const HORA_INICIO_RE = /^HORA\s+INICIO\b/i;
const HORA_FINAL_RE = /^HORA\s+FINAL\b/i;
const HORA_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Minutos desde medianoche de una hora "08:44:05", o null. */
function minutosDe(valor) {
  const m = String(valor ?? "").trim().match(HORA_RE);
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}

/**
 * Añade, por cada paso que anota hora de inicio y de final, cuánto duró y el
 * tiempo que la instrucción manda.
 *
 * Es el parámetro que más pide un protocolo de semisólidos ("Tiempo: no menos
 * de 5 minutos" en casi cada operación) y el registro no lo trae hecho: anota
 * las dos horas y deja la resta a quien revisa. Las horas viven además como
 * trazabilidad, así que ni siquiera llegaban al cuadro.
 *
 * Sólo cuenta las parejas dentro de un mismo paso: son las de una operación
 * concreta. El tiempo total de la etapa lo calcula aparte tiempos.js, a partir
 * de las "FECHA / HORA" de las subsecciones.
 */
function conTiempoDeCadaPaso(params, indice, titulos) {
  const salida = [];
  let abierto = null;
  // Un mismo paso puede cronometrar dos operaciones (4.4.7 funde y luego
  // agita, cada una con su par de horas). Sin numerarlas, las dos filas se
  // llamarían igual y en el cuadro se pisarían entre ellas.
  const vecesPorPaso = new Map();

  for (const p of params) {
    salida.push(p);

    const etiqueta = p.baseLabel || p.label || "";
    if (!p.paso) continue;

    if (HORA_INICIO_RE.test(etiqueta)) {
      const t = minutosDe(p.value);
      if (t !== null) abierto = { paso: p.paso, t, section: p.section, y: p.y, page: p.page };
      continue;
    }

    if (!HORA_FINAL_RE.test(etiqueta) || !abierto || abierto.paso !== p.paso) continue;

    const fin = minutosDe(p.value);
    if (fin === null) {
      abierto = null;
      continue;
    }

    // Una operación que cruza la medianoche cuenta las horas del día
    // siguiente; sin esto daría una duración negativa.
    const minutos = fin >= abierto.t ? fin - abierto.t : fin + 24 * 60 - abierto.t;
    // El verbo se busca primero en la instrucción que hay justo encima del
    // cronómetro y sólo después en el título del paso: un paso titulado
    // "PESAR EN LA BALANZA" cronometra más abajo un hervido, y llamar a esa
    // fila "TIEMPO DE PESAR" señalaría la operación equivocada.
    const operacion =
      operacionCerca(indice, p.paso, abierto.page, abierto.y) || operacionDe(titulos.get(p.paso) || "");

    // El orden dentro del paso es estable entre lotes —la primera agitación
    // del 4.4.7 es siempre la primera—, así que sirve para distinguirlas sin
    // que el cuadro compare operaciones distintas en la misma fila.
    const vez = (vecesPorPaso.get(p.paso) || 0) + 1;
    vecesPorPaso.set(p.paso, vez);
    const nombre = `TIEMPO${operacion ? ` DE ${operacion}` : ""} (${p.paso}${vez > 1 ? ` · ${vez}` : ""})`;

    salida.push({
      id: `paso_tiempo__${p.paso}__${vez}`,
      section: abierto.section,
      label: nombre,
      baseLabel: nombre,
      occurrence: 1,
      counterKey: `${abierto.section}|${nombre}`,
      setpoint: criterioDeTiempoDelPaso(indice, p.paso, abierto.page, abierto.y),
      unit: "min",
      valueType: "number",
      value: minutos,
      // Crítico para que llegue al cuadro: como trazabilidad se quedaría
      // fuera, que es donde estaban las horas sueltas.
      category: "critico",
      page: p.page,
      paso: p.paso,
    });

    abierto = null;
  }

  return salida;
}

/**
 * El tiempo que manda la instrucción del paso ("POR NO MENOS DE 10 MIN").
 *
 * Se busca por encima de la hora de inicio: es donde está la instrucción que
 * la ordena. Si el paso no dice ningún tiempo, la fila sale con la duración
 * medida y sin criterio, que sigue siendo más de lo que había antes.
 */
/**
 * El verbo de la instrucción inmediatamente anterior al cronómetro.
 *
 * Se mira sólo unos pocos renglones hacia arriba: más lejos ya se está en otra
 * operación del mismo paso, y el nombre de la fila señalaría la equivocada.
 */
function operacionCerca(indice, paso, page, y) {
  const lineas = lineasDelPaso(indice, paso);
  const posicion = lineas.findIndex((l) => l.pagina === page && Math.abs(l.y - y) < 0.5);
  if (posicion < 0) return "";

  for (let i = posicion - 1; i >= Math.max(0, posicion - 6); i--) {
    const operacion = operacionDe(lineas[i].texto);
    if (operacion) return operacion;
  }
  return "";
}

function criterioDeTiempoDelPaso(indice, paso, page, y) {
  const lineas = lineasDelPaso(indice, paso);
  const posicion = lineas.findIndex((l) => l.pagina === page && Math.abs(l.y - y) < 0.5);
  const desde = posicion < 0 ? lineas.length - 1 : posicion - 1;

  for (let i = desde; i >= 0; i--) {
    if (esCasilla(lineas[i].texto)) continue;
    const conSiguiente = [lineas[i].texto, lineas[i + 1]?.texto].filter(Boolean).join(" ");
    const criterio = criterioEn(conSiguiente, "tiempo");
    if (criterio) return criterio;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Las velocidades que no se anotan
// ---------------------------------------------------------------------------

// "VELOCIDAD AGITADOR DELCROSA (UNICA)": el equipo tiene una sola velocidad,
// así que el operario no escribe nada al lado y el detector genérico —que
// busca un valor— no la ve. El protocolo sí la pide como parámetro de
// proceso, con su rango ("Única, aprox. 1783 rpm").
const VELOCIDAD_SIN_VALOR_RE = /^(VELOCIDAD[^:]{0,60}?)\s*\((UNICA|ÚNICA)\)\s*$/i;

function conVelocidadesUnicas(params, indice, titulos) {
  const yaEsta = new Set(params.map((p) => `${p.paso}|${(p.baseLabel || p.label || "").toUpperCase()}`));

  // Cada velocidad se agrupa por el paso en el que aparece, para poder
  // colocarla junto a las demás lecturas de ese paso: al final de la lista
  // saldría en el cuadro descolgada de la operación de la que habla.
  const porPaso = new Map();

  for (const [pagina, lineas] of indice) {
    for (const linea of lineas) {
      const m = linea.texto.match(VELOCIDAD_SIN_VALOR_RE);
      if (!m) continue;

      const etiqueta = m[1].replace(/\s+/g, " ").trim().toUpperCase();
      const clave = `${linea.paso}|${etiqueta}`;
      if (yaEsta.has(clave)) continue;
      yaEsta.add(clave);

      const operacion = operacionDe(titulos.get(linea.paso) || "");
      if (!porPaso.has(linea.paso)) porPaso.set(linea.paso, []);
      porPaso.get(linea.paso).push({
        id: `velocidad_unica__${linea.paso}__${etiqueta.replace(/[^A-Z]+/g, "_")}`,
        label: `${etiqueta} (${linea.paso}${operacion ? ` ${operacion}` : ""})`,
        baseLabel: etiqueta,
        occurrence: 1,
        setpoint: "Única",
        unit: "",
        valueType: "text",
        // Sin valor anotado: el equipo no tiene más que una velocidad. La
        // fila existe para que el parámetro conste con su rango, como en la
        // tabla de parámetros de control del protocolo.
        value: "",
        category: "critico",
        page: pagina,
        paso: linea.paso,
        sinValorEnRegistro: true,
      });
    }
  }

  if (porPaso.size === 0) return params;

  // Se intercalan detrás de la última lectura de su paso, heredando su
  // sección: es donde las espera quien lee el cuadro de arriba abajo.
  const salida = [];
  for (let i = 0; i < params.length; i++) {
    salida.push(params[i]);
    const paso = params[i].paso;
    const ultimaDelPaso = !paso || params[i + 1]?.paso !== paso;
    if (!ultimaDelPaso || !porPaso.has(paso)) continue;

    for (const velocidad of porPaso.get(paso)) {
      salida.push({
        ...velocidad,
        section: params[i].section,
        counterKey: `${params[i].section}|${velocidad.baseLabel}`,
      });
    }
    porPaso.delete(paso);
  }

  // Las de un paso que no dejó ninguna otra lectura no tienen dónde
  // intercalarse; van al final, con su propia sección.
  for (const [, velocidades] of porPaso) {
    for (const velocidad of velocidades) {
      salida.push({ ...velocidad, section: "PARAMETROS DE PROCESO", counterKey: `|${velocidad.baseLabel}` });
    }
  }

  return salida;
}

// ---------------------------------------------------------------------------
// El rango de aceptación del rendimiento
// ---------------------------------------------------------------------------

// "4.5.7.- RANGO DE ACEPTACION (90% - 100%)". Va en una línea suelta DESPUÉS
// del cálculo, no junto a él, así que la regla de "la instrucción de arriba"
// no lo alcanza: es el único criterio del registro que se escribe detrás de
// su casilla.
const RANGO_RENDIMIENTO_RE = /RANGO\s+DE\s+ACEPTACION[^(]*\(\s*([^)]*\d[^)]*)\s*\)/i;
const ES_RENDIMIENTO_RE = /RENDIMIENTO/i;

function conRangoDeRendimiento(params, indice) {
  let rango = "";
  for (const [, lineas] of indice) {
    for (const linea of lineas) {
      const m = linea.texto.match(RANGO_RENDIMIENTO_RE);
      if (m) {
        rango = m[1].replace(/\s+/g, " ").trim();
        break;
      }
    }
    if (rango) break;
  }
  if (!rango) return params;

  for (const p of params) {
    if (!p.setpoint && ES_RENDIMIENTO_RE.test(p.baseLabel || p.label || "")) {
      p.setpoint = rango;
      p.criterioDeInstruccion = true;
    }
  }
  return params;
}

/** Título (texto) de cada paso, para poder nombrar sus lecturas. */
function titulosDePasos(indice) {
  const titulos = new Map();
  for (const [, lineas] of indice) {
    for (const linea of lineas) {
      const m = linea.texto.match(/^\s*(\d+(?:\.\d+)*)\s*\.-\s*(.*)$/);
      if (m && !titulos.has(m[1])) titulos.set(m[1], m[2]);
    }
  }
  return titulos;
}

/**
 * Todo lo que se puede saber leyendo la instrucción de cada paso: su criterio
 * de aceptación, cuánto duró, cómo se llama la operación, y las velocidades
 * que el registro nombra sin pedir que se anote nada.
 */
export function conPasos(params, pages) {
  const indice = indexarPasos(pages);
  const titulos = titulosDePasos(indice);

  const conCriterios = conRangoDeRendimiento(conCriteriosDelPaso(params, pages), indice);
  const conTiempo = conTiempoDeCadaPaso(conCriterios, indice, titulos);
  const conVelocidades = conVelocidadesUnicas(conTiempo, indice, titulos);
  const salida = renombrarPorPaso(conVelocidades, titulos);

  // La coordenada sólo servía para localizar cada lectura en la página
  // mientras se buscaba su instrucción; guardarla con el documento sería
  // llevarse a cuestas un dato que ya no dice nada.
  for (const p of salida) delete p.y;
  return salida;
}

export const _paraPruebas = { criterioEn, magnitudDe, esCasilla, operacionDe, minutosDe };
