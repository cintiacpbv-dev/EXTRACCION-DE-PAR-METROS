// Los valores que el registro de manufactura manda cumplir.
//
// El detector genérico saca lo que el operario ANOTA (la temperatura que
// midió, el amperaje que leyó). Un protocolo de validación, en cambio, se
// escribe contra lo que el registro MANDA: "fundir a 70 ºC ± 5 ºC", "mezclar
// durante 10 minutos ± 1 minuto", "hasta que el amperaje indique
// aproximadamente 38 ampere". Eso vive dentro del texto de cada paso, no en
// una columna, así que se recoge aparte.
//
// Se guarda con el documento porque es lo que después se compara contra el
// protocolo anterior; el texto completo del PDF sería demasiado para llevarlo
// a cuestas en cada carga.

import { norm } from "./utils.js";

// Unidades que aparecen en estos registros. Los patrones van anclados y sin
// distinguir mayúsculas porque lo que se compara es la unidad suelta, ya
// recortada de la frase: el registro escribe "38 AMPERE" en mayúscula y el
// protocolo "24 A", y ambos son amperios.
const UNIDADES = [
  { tipo: "temperatura", re: /^[ºo°]\s?C$|^C[ºo°]$/i },
  { tipo: "tiempo", re: /^(?:minutos?|min|horas?|h|segundos?|seg|s)$/i },
  { tipo: "velocidad", re: /^(?:rpm|cpm)$/i },
  { tipo: "amperaje", re: /^(?:amperes?|A)$/i },
  { tipo: "presion", re: /^(?:MPa|bar|psi)$/i },
  { tipo: "porcentaje", re: /^%$/ },
  { tipo: "longitud", re: /^mm$/i },
  { tipo: "peso", re: /^(?:kg|KGP|g)$/i },
];

// Una cifra con su unidad: "70 ºC", "10 MINUTOS", "38 AMPERE", "1500 rpm",
// "0.5 Mpa", "100 %", "161 mm". La unidad puede ir pegada o separada.
const CIFRA_RE =
  /(\d+(?:[.,]\d+)?)\s*(°C|ºC|oC|C°|minutos?|min|horas?|segundos?|seg|rpm|cpm|amperes?|MPa|Mpa|bar|psi|%|mm|kg|KGP|g|A)\b/gi;

// Número de malla: no lleva unidad, va por su nombre. Las hay de un solo
// dígito con letra ("N° 2A"), así que no se puede exigir un mínimo de dos.
const MALLA_RE = /MALLA[^.]{0,60}?N?[°º]?\s*(\d{1,4}\s?[A-Z]?)(?:\s|\(|$)/i;

const PASO_RE = /^(\d+(?:\.\d+)+)\s*\.-\s*(.*)$/;

function tipoDe(unidad) {
  for (const u of UNIDADES) if (u.re.test(unidad)) return u.tipo;
  return "otro";
}

/**
 * Cifras con unidad que contiene una frase, ya normalizadas para comparar.
 * "70 ºC ± 5 ºC" da dos; "135°C A 200°C" da dos; "20 MINUTOS" da una.
 */
function cifras(texto) {
  const out = [];
  // La "A" suelta de amperaje choca con los números de malla ("N° 2A"), que
  // no son amperios; en una frase que habla de mallas no se cuenta.
  const hayMalla = /MALLA/i.test(texto);

  for (const m of texto.matchAll(CIFRA_RE)) {
    if (hayMalla && /^A$/i.test(m[2])) continue;
    out.push({
      valor: parseFloat(m[1].replace(",", ".")),
      unidad: m[2],
      tipo: tipoDe(m[2]),
      texto: `${m[1]} ${m[2]}`.replace(/\s+/g, " "),
    });
  }
  return out;
}

// Frases que no mandan nada: avisos, referencias a otros documentos y las
// líneas del encabezado que se repiten en cada página.
const RUIDO_RE =
  /^(NOTA|VERIFICAR EL|SEGUN LO INDICADO|REGISTRO DE MANUFACTURA|P[áa]gina|Emitido|Orden N|Lote:|Expira|Te[óo]rico|C[óo]digo\b|Estado \/|Autorizado)/i;

/**
 * Recorre el registro y devuelve las frases que fijan un valor, cada una con
 * el número de paso en el que está y el texto de ese paso, que es lo que
 * permite reconocer de qué operación habla ("MOLER POR MOLINO FITZ MILL...").
 */
export function detectSetpoints(pages) {
  const salida = [];
  const textoPorPaso = new Map();
  let paso = "";

  for (const page of pages) {
    for (const linea of page.lines) {
      const texto = norm(linea.text).trim();
      if (!texto || RUIDO_RE.test(texto)) continue;

      const mp = texto.match(PASO_RE);
      if (mp) paso = mp[1];

      // El texto entero del paso se acumula aparte. Una instrucción ocupa
      // varios renglones y el valor suele estar en uno distinto del que
      // nombra la operación: "AMASAR, ACTIVANDO EL MODO AGITACION..." y
      // "...INDIQUE APROXIMADAMENTE 38 AMPERE" son renglones separados del
      // mismo paso, y hace falta leerlos juntos para saber de qué habla.
      textoPorPaso.set(paso, `${textoPorPaso.get(paso) || ""} ${texto}`.slice(0, 1200));

      const encontradas = cifras(texto);
      const mallas = [...texto.matchAll(new RegExp(MALLA_RE.source, "gi"))];
      if (encontradas.length === 0 && mallas.length === 0) continue;

      salida.push({
        paso,
        texto,
        cifras: encontradas,
        // Una frase que enumera varias mallas está preparando el material,
        // no fijando la de un paso ("PREPARAR LAS MALLAS ... N° 000, N° 050,
        // N° 2A"): no sirve como setpoint de ninguna.
        malla: mallas.length === 1 ? mallas[0][1].trim() : null,
      });
    }
  }

  for (const entrada of salida) entrada.contexto = (textoPorPaso.get(entrada.paso) || "").trim();
  return salida;
}
