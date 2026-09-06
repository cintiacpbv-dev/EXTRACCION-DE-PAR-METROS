// ¿El valor que anotó el operario cumple el criterio de aceptación?
//
// El criterio se escribe de muchas maneras distintas según el registro y la
// forma farmacéutica —"70 ºC ± 2 ºC", "15 °C - 30 °C", "POR NO MENOS DE 10
// MIN", "ENTRE 20 A 25 MINUTOS", "5.5 - 6.5", "NIVEL 3"—, así que aquí se
// interpretan todas y se responde una sola cosa: dentro, fuera, o no se sabe.
//
// "No se sabe" es una respuesta de primera clase, no un fallo. Un criterio
// que esta lectura no entienda —o uno que no es numérico, como "Única" o
// "Conforme"— no debe pintarse como incumplimiento: en un expediente de
// validación, marcar en rojo un valor que en realidad cumple es peor que no
// marcar nada.

/** Un número escrito como lo escribe el registro ("70", "5.5", "12,5"). */
function aNumero(texto) {
  if (typeof texto === "number") return Number.isFinite(texto) ? texto : null;
  const n = parseFloat(String(texto ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Las unidades pegadas a las cifras del criterio. Se reconocen para poder
// saltárselas al leer los números, no para comprobarlas: comparar unidades
// exigiría normalizar minutos con horas y grados con grados, y el registro ya
// escribe cada casilla en la unidad de su criterio.
const UNIDAD = "(?:\\s*(?:°|º|o)?\\s*[CF]\\b|\\s*%|\\s*(?:MIN|MINUTOS?|HORAS?|H|SEG|SEGUNDOS?|KG|G|L|ML|RPM|GPM|KP|MM|CM|BAR|PSI|MPA)\\b)?";
const CIFRA = "(-?\\d+(?:[.,]\\d+)?)";

const PATRONES = [
  // "70 ºC ± 2 ºC", "40°C ± 2°C", "250 kg ± 5"
  {
    re: new RegExp(`${CIFRA}${UNIDAD}\\s*(?:±|\\+\\/-|\\+-)\\s*${CIFRA}`, "i"),
    lee: (m) => {
      const centro = aNumero(m[1]);
      const tolerancia = aNumero(m[2]);
      if (centro === null || tolerancia === null) return null;
      return { min: centro - tolerancia, max: centro + tolerancia };
    },
  },
  // "ENTRE 20 A 25 MINUTOS"
  {
    re: new RegExp(`ENTRE\\s+${CIFRA}${UNIDAD}\\s*(?:A|-|–|Y)\\s*${CIFRA}`, "i"),
    lee: (m) => rango(aNumero(m[1]), aNumero(m[2])),
  },
  // "MAYOR O IGUAL A 65 °C", "NO MENOS DE 10 MIN", "NO MENOR DE 5 MIN",
  // "MÍNIMO 3 MINUTOS", "≥ 65"
  {
    re: new RegExp(
      `(?:≥|MAYOR\\s+O\\s+IGUAL(?:\\s+A)?|NO\\s+\\w{4,7}\\s+DE|M[IÍ]NIMO(?:\\s+DE)?|AL\\s+MENOS)\\s*${CIFRA}`,
      "i"
    ),
    lee: (m) => {
      const min = aNumero(m[1]);
      return min === null ? null : { min, max: null };
    },
  },
  // "MENOR O IGUAL A 4 L", "NO MÁS DE 1 %", "MÁXIMO 30 MIN", "≤ 4"
  {
    re: new RegExp(
      `(?:≤|MENOR\\s+O\\s+IGUAL(?:\\s+A)?|NO\\s+M[AÁ]S\\s+DE|M[AÁ]XIMO(?:\\s+DE)?|HASTA)\\s*${CIFRA}`,
      "i"
    ),
    lee: (m) => {
      const max = aNumero(m[1]);
      return max === null ? null : { min: null, max };
    },
  },
  // "15 °C - 30 °C", "5.5 - 6.5", "90% - 100%", "4 a 10"
  {
    re: new RegExp(`${CIFRA}${UNIDAD}\\s*(?:-|–|—|A)\\s*${CIFRA}`, "i"),
    lee: (m) => rango(aNumero(m[1]), aNumero(m[2])),
  },
  // "NIVEL 3": no es un rango sino un valor exacto, y así se comprueba.
  {
    re: /NIVEL\s*(\d+)/i,
    lee: (m) => {
      const n = aNumero(m[1]);
      return n === null ? null : { min: n, max: n };
    },
  },
];

function rango(a, b) {
  if (a === null || b === null) return null;
  // "10 - 4" no existe en estos registros, pero si el orden viniera al revés
  // conviene entenderlo igual que del derecho.
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

// Criterios que no acotan nada: no hay número contra el que comparar, así que
// la casilla nunca se marca. "Referencial" es el caso más común —la humedad
// relativa se anota para dejar constancia, no para cumplir un rango—.
const SIN_RANGO_RE = /^\s*(?:REFERENCIAL|[UÚ]NICA|CONFORME|N\/?A|MANUAL|SEG[UÚ]N|-+)?\s*$|REFERENCIAL/i;

/**
 * Interpreta un criterio de aceptación y devuelve sus límites.
 *
 * `null` cuando el criterio no fija ninguno, sea porque no es numérico
 * ("Única", "Conforme") o porque está escrito de una forma que aquí no se
 * reconoce. Quien llama debe tratar los dos casos igual: no se sabe.
 */
export function limitesDe(setpoint) {
  const texto = String(setpoint ?? "").trim();
  if (!texto || SIN_RANGO_RE.test(texto)) return null;

  for (const patron of PATRONES) {
    const m = texto.match(patron.re);
    if (!m) continue;
    const limites = patron.lee(m);
    if (limites && (limites.min !== null || limites.max !== null)) return limites;
  }
  return null;
}

// Al comparar decimales hay que dejar holgura: el registro anota "72.0" contra
// un criterio de "70 ± 2" y la resta en coma flotante puede dar 72.00000000001,
// que marcaría como fuera de rango un valor que está justo en el límite. El
// límite pertenece al rango: así lo lee quien firma el expediente.
const HOLGURA = 1e-9;

/**
 * Compara un valor con su criterio.
 *
 * Devuelve "dentro", "fuera", o null cuando no hay forma de saberlo —criterio
 * no numérico, valor de texto, o casilla vacía—. Ante la duda, null: una
 * marca en rojo sobre un valor que sí cumple confunde más que la ausencia de
 * marca.
 */
export function evaluarValor(valor, setpoint) {
  const limites = limitesDe(setpoint);
  if (!limites) return null;

  const n = aNumero(valor);
  if (n === null) return null;

  if (limites.min !== null && n < limites.min - HOLGURA) return "fuera";
  if (limites.max !== null && n > limites.max + HOLGURA) return "fuera";
  return "dentro";
}

/** Cómo se lee el criterio ya interpretado, para explicarlo en un tooltip. */
export function textoDeLimites(limites) {
  if (!limites) return "";
  if (limites.min !== null && limites.max !== null) {
    return limites.min === limites.max ? `debe ser ${limites.min}` : `entre ${limites.min} y ${limites.max}`;
  }
  if (limites.min !== null) return `no menos de ${limites.min}`;
  return `no más de ${limites.max}`;
}
