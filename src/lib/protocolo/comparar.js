// Compara los setpoints escritos en un protocolo con lo que manda el
// registro de manufactura vigente.
//
// Un protocolo se escribe contra una edición concreta del registro. Cuando el
// registro cambia —y cambia: la edición 11 de EVACLEAN funde a 70 ºC donde la
// anterior fundía a 60— el protocolo se queda diciendo lo que ya no se hace.
// Encontrar eso a mano significa leer las dos cosas en paralelo, línea por
// línea.
//
// Aquí no se adivina nada: por cada setpoint del protocolo se busca en el
// registro la frase que fija ese mismo tipo de magnitud en el mismo paso, y
// se muestran las dos con la frase de origen para que la decisión la tome
// quien firma el protocolo.

// Palabras que aparecen en todas las frases y no distinguen un paso de otro.
const VACIAS = new Set([
  "de", "del", "la", "el", "los", "las", "en", "con", "por", "para", "y", "o", "a",
  "un", "una", "al", "se", "que", "su", "sus", "lo", "hasta", "sobre", "segun",
  "realizado", "vb", "nota", "verificar", "indicado", "aprox", "aproximadamente",
  "ver", "capitulo", "seccion", "acero", "inoxidable", "equipo", "paso", "ayuda",
]);

/** Sin tildes, en minúsculas y partido en palabras con contenido. */
export function palabras(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !VACIAS.has(w));
}

/** Raíz aproximada, para que "amasado" y "amasar" cuenten como la misma. */
function raiz(w) {
  return w.replace(/(?:ado|ada|ados|adas|ando|ar|er|ir|es|s)$/, "");
}

function solape(a, b) {
  const A = new Set(a.map(raiz));
  const B = new Set(b.map(raiz));
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n;
}

// Tipo de magnitud que declara un texto de setpoint del protocolo.
const TIPOS = [
  { tipo: "temperatura", re: /[ºo°]\s?C\b|temperatura/i },
  { tipo: "velocidad", re: /\b(?:rpm|cpm)\b/i },
  { tipo: "amperaje", re: /\b(?:A|ampere|amperes|amperaje)\b/i },
  { tipo: "presion", re: /\b(?:MPa|Mpa|bar|psi)\b/i },
  { tipo: "porcentaje", re: /%/ },
  { tipo: "tiempo", re: /\b(?:minutos?|min|horas?|segundos?|seg)\b/i },
  { tipo: "longitud", re: /\bmm\b/i },
  { tipo: "peso", re: /\b(?:kg|g)\b/ },
];

/**
 * Qué magnitud declara un setpoint del protocolo.
 *
 * Manda la unidad de la PRIMERA cifra, no el orden de la lista: "0.5 MPa –
 * 0.6 MPa (627.91 rpm – 648.02 rpm aprox.)" es una presión con la velocidad
 * equivalente entre paréntesis, y buscar por rpm llevaba al chopper.
 */
function tipoDeSetpoint(texto) {
  const m = String(texto || "").match(
    /\d+(?:[.,]\d+)?\s*(°C|ºC|oC|minutos?|min|horas?|segundos?|seg|rpm|cpm|amperes?|MPa|Mpa|bar|psi|%|mm|kg|g|A)\b/i
  );
  if (m) {
    for (const t of TIPOS) if (t.re.test(m[1])) return t.tipo;
  }
  // Sin cifra ("Temperatura ambiente", "Según lo observado") manda el nombre.
  for (const t of TIPOS) if (t.re.test(texto)) return t.tipo;
  return null;
}

/** Las cifras de un texto, para comparar valores y no cadenas. */
function valores(texto) {
  // "1 500 rpm" es mil quinientos, no un uno y un quinientos: el espacio como
  // separador de miles se quita antes de leer las cifras.
  const limpio = String(texto || "").replace(/(\d)\s+(\d{3}\b)/g, "$1$2");
  return [...limpio.matchAll(/(\d+(?:[.,]\d+)?)/g)]
    .map((m) => parseFloat(m[1].replace(",", ".")))
    .filter((n) => !Number.isNaN(n));
}

function mismosValores(a, b) {
  const va = valores(a);
  const vb = valores(b);
  if (vb.length === 0 || vb.length > va.length) return false;
  // Basta con que las cifras del registro sean las primeras del protocolo:
  // "0.5 MPa – 0.6 MPa (627.91 rpm – 648.02 rpm aprox.)" dice lo mismo que
  // "0.5 Mpa – 0.6 Mpa" y añade la velocidad equivalente entre paréntesis.
  return vb.every((n, i) => Math.abs(n - va[i]) < 0.001);
}

// Parejas de palabras que nombran cosas distintas dentro de un mismo paso.
// Un protocolo las usa para separar dos parámetros que si no se llamarían
// igual, y el registro las usa en la frase de cada uno.
const CONTRARIAS = [
  ["agitacion", "chopper"],
  ["horizontal", "vertical"],
  ["inicial", "final"],
  ["superior", "inferior"],
  ["carga", "descarga"],
];

/** Palabras que, si aparecen en una frase, la descartan para este parámetro. */
function contrariasDe(nombre) {
  const fuera = [];
  for (const [a, b] of CONTRARIAS) {
    if (nombre.includes(a) && !nombre.includes(b)) fuera.push(b);
    if (nombre.includes(b) && !nombre.includes(a)) fuera.push(a);
  }
  return fuera;
}

const MALLA_PROTOCOLO_RE = /malla/i;

// Cuántos puntos de coincidencia hacen falta para dar una frase por buena.
// Por debajo se prefiere no proponer nada: un cambio inventado en un
// protocolo de validación cuesta más de encontrar que uno que falta.
const UMBRAL = 7;

/**
 * Busca en el registro la frase que fija el mismo valor que una fila del
 * protocolo. Gana la que comparta más palabras con el nombre del parámetro y
 * con el paso en el que el protocolo lo sitúa.
 */
function mejorEvidencia(fila, setpoints) {
  const esMalla = MALLA_PROTOCOLO_RE.test(fila.parametro);
  const tipo = esMalla ? null : tipoDeSetpoint(fila.setpoint);
  if (!tipo && !esMalla) return null;

  const delNombre = palabras(fila.parametro);
  const delPaso = palabras(fila.contexto);

  // Palabras del nombre que lo oponen a otro parámetro del mismo paso.
  const opuestas = contrariasDe(delNombre);
  const buscaLaUltima = delNombre.includes("final");

  let mejor = null;
  for (const sp of setpoints) {
    if (esMalla) {
      if (!sp.malla) continue;
    } else if (!sp.cifras.some((c) => c.tipo === tipo)) {
      continue;
    }

    const propias = palabras(sp.texto);
    // La frase habla del parámetro contrario: la velocidad del chopper no es
    // la de agitación aunque estén en el mismo paso.
    if (opuestas.some((w) => propias.includes(w))) continue;

    const suyas = [...palabras(sp.contexto), ...propias];
    // El paso pesa más que el nombre del parámetro: "Temperatura" y
    // "Velocidad" se repiten en todo el registro, mientras que "Molino Cono
    // Húmedo FZS-700" o "Secadora de lecho fluido" señalan una sola
    // operación. Sin coincidir en el paso no se propone nada.
    const puntos = solape(delPaso, suyas) * 3 + solape(delNombre, suyas) * 2;
    if (puntos < UMBRAL) continue;

    // "Amperaje inicial" y "Amperaje final" se leen igual de bien en las dos
    // frases del paso ("...INDIQUE APROXIMADAMENTE 38 AMPERE" y "...INDIQUE
    // APROXIMADAMENTE 45 AMPERE"), y lo único que las separa es el orden en
    // que están escritas. A igualdad de puntos, el final se queda con la
    // última.
    const gana = puntos > mejor?.puntos || (buscaLaUltima && puntos === mejor?.puntos);
    if (!mejor || gana) {
      mejor = { puntos, sp, propuesta: esMalla ? `N° ${sp.malla}` : propuestaDe(sp, tipo) };
    }
  }

  return mejor;
}

/**
 * Cómo se escribe el valor del registro con la forma que usa el protocolo.
 * Un rango del registro ("135°C A 200°C") se escribe con guion; una
 * tolerancia ("70 ºC ± 5 ºC") se conserva tal cual.
 */
function propuestaDe(sp, tipo) {
  const propias = sp.cifras.filter((c) => c.tipo === tipo);
  if (propias.length === 0) return null;
  if (propias.length === 1) return propias[0].texto;

  const separador = /±/.test(sp.texto) ? " ± " : " – ";
  return propias.map((c) => c.texto).join(separador);
}

/**
 * Filas de una tabla del protocolo que declaran un setpoint.
 *
 * Las tablas de parámetros del protocolo tienen el nombre en la primera
 * columna y el valor en la segunda, y entre medias filas que abarcan el ancho
 * entero con el nombre del paso ("Amasado de la Molienda 2 – Mezclador...").
 * Esas filas de paso son el contexto de las que vienen debajo.
 */
// Dónde vive el valor según la tabla: el capítulo del análisis de riesgo lo
// llama "Setpoint" y el del diseño de la validación, "Rango de operación".
const COLUMNA_VALOR_RE = /^(setpoint|rango de operaci[óo]n|especificaci[óo]n)/i;

export function filasConSetpoint(tabla) {
  const cabecera = tabla.filas[0]?.celdas.map((c) => c.texto) || [];
  // Sin cabecera reconocible se usa la segunda columna, que es donde está en
  // las tablas de parámetros de proceso.
  const iValor = Math.max(
    1,
    cabecera.findIndex((t) => COLUMNA_VALOR_RE.test(t || ""))
  );

  const filas = [];
  let contexto = "";
  let ultimoNombre = "";

  for (const [i, fila] of tabla.filas.entries()) {
    if (i === 0) continue; // cabecera
    const celdas = fila.celdas;
    if (celdas.length <= iValor) {
      // Fila que abarca el ancho entero: es el nombre del paso al que
      // pertenecen las filas que vienen debajo.
      if (celdas.length === 1) contexto = celdas[0]?.texto || contexto;
      continue;
    }

    // Un parámetro que se subdivide ocupa dos columnas de nombre ("Temperatura
    // de sellado | Mordaza horizontal"), y esa fila trae una celda de más que
    // corre el valor a la derecha.
    const sobran = celdas.length - cabecera.length;
    const iAqui = iValor + Math.max(0, sobran);
    const nombre = celdas
      .slice(0, 1 + Math.max(0, sobran))
      .map((c) => c.texto)
      .filter(Boolean)
      .join(" ");

    // La continuación de un parámetro deja el nombre en blanco y sólo cambia
    // el subnombre ("| Mordaza vertical | | 135 °C – 180 °C").
    const parametro = nombre || ultimoNombre;
    if (nombre) ultimoNombre = nombre;

    const celdaValor = celdas[iAqui];
    if (!parametro || !celdaValor?.texto) continue;

    filas.push({ parametro, setpoint: celdaValor.texto, contexto, celda: celdaValor });
  }

  return filas;
}

/**
 * El informe de comparación: una entrada por setpoint del protocolo, con lo
 * que dice el registro y si coinciden.
 */
export function compararProtocolo(tablas, setpoints, { titulos = {} } = {}) {
  const entradas = [];

  for (const tabla of tablas) {
    const titulo = titulos[tabla.indice] || "";
    for (const fila of filasConSetpoint(tabla)) {
      const ev = mejorEvidencia(fila, setpoints);

      let estado = "sin-evidencia";
      if (ev?.propuesta) {
        estado = mismosValores(fila.setpoint, ev.propuesta) ? "igual" : "distinto";
      }

      entradas.push({
        tabla: tabla.indice,
        titulo,
        contexto: fila.contexto,
        parametro: fila.parametro,
        actual: fila.setpoint,
        propuesta: ev?.propuesta || null,
        evidencia: ev ? `${ev.sp.paso ? ev.sp.paso + " · " : ""}${ev.sp.texto}` : null,
        estado,
        celda: fila.celda,
      });
    }
  }

  return entradas;
}
