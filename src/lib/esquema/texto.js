// Cómo se escribe el texto dentro de las cajas del Formato 01.
//
// El registro está escrito todo en mayúsculas —"OLLA DE ACERO INOXIDABLE DE 30
// L", "AGUA PURIFICADA"— porque es un formulario para rellenar a mano. El
// esquema no: escribe en minúsculas con la inicial en mayúscula, y sólo deja
// en alto lo que de verdad va en alto, que son las unidades ("L", "kg", "rpm"),
// los identificadores ("N°1", "250 L", "TF60") y las marcas.
//
// Las marcas son lo único que no se puede deducir de la forma de la palabra:
// "FITZ MILL" y "MEZCLADOR" se escriben igual en el registro y en el esquema
// van distinto. Por eso la lista está aquí a la vista, como la de nombres.js,
// y no escondida en el código que dibuja.

// Palabras que el esquema deja en minúscula aunque abran una palabra larga.
const CONECTORES = new Set([
  "DE", "DEL", "LA", "EL", "LOS", "LAS", "UN", "UNA", "Y", "O", "U",
  "CON", "SIN", "EN", "POR", "PARA", "A", "AL", "SEGUN", "SEGÚN", "NO", "SI",
]);

// Marcas y modelos: se escriben como los escribe el fabricante, no como los
// escribe el formulario. Salen de los Formato 01 de DOLORAL, FLUIBRONCOL,
// PYRIDIUM, SOLUNA y BUMEJORAL.
const MARCAS = new Map(
  [
    "Fitz", "Mill", "Glatt", "Hobart", "Miyako", "Jubao", "Hapa", "Imaje",
    "Marken", "Bosch", "Uhlmann", "Argentécnica", "Chopper",
    "Chiller", "Chekweigher", "Piab", "Chamunda", "Sejong", "Kikusui",
    "Manesty", "Chekmaster", "Chek", "Chekpoint",
  ].map((m) => [m.toUpperCase(), m])
);

// Unidades y siglas que van en alto aunque no sean palabras cortas: son las
// que el registro y el esquema escriben igual.
const SIGLAS = new Set([
  "L", "ML", "MLL", "KG", "KGP", "G", "GPA", "MG", "MM", "CM", "M", "UM",
  "AG", "PH", "UI", "RPM", "MPA", "PSI", "BX", "HR",
  "MCT", "BR", "PEG", "BLOMM", "NF", "POE", "CJA", "ROL", "PVC", "PVDC",
  "ADH", "ACRIL", "USP", "BP", "EP", "FCC", "BLOOM",
]);

/**
 * Un trozo de texto del registro, escrito como lo escribe el esquema.
 *
 * Se trata como una frase cada tramo separado por "+" o por ":", porque el
 * formato arranca con mayúscula cada equipo y cada valor ("Tanque de 250 L (B)
 * + Mezclador 250 L AG", "V de agitación: Nivel 10"). Lo que lleva un dígito o
 * un símbolo se queda tal cual: son medidas y códigos ("250", "N°1", "M/C",
 * "FD&C", "TF60").
 */
export function comoElEsquema(texto) {
  return String(texto ?? "")
    .split(/\s*\+\s*/)
    .map((tramo) => tramo.split(":").map(frase).join(":"))
    .join(" + ");
}

function frase(tramo) {
  let inicial = true;

  return tramo
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token) || !token) return token;

      const palabra = palabraSuelta(token, inicial);
      inicial = false;
      return palabra;
    })
    .join("");
}

function palabraSuelta(token, inicial) {
  // Lo que lleva un dígito es una medida o un código —"250", "N°1", "TF60",
  // "9040"— y se queda exactamente como está.
  if (/\d/.test(token)) return token;

  // Se reescribe cada tramo de letras por separado y se deja intacto lo que
  // hay entre medias: la puntuación pegada a la palabra ("purificada:",
  // "(bulk)") y las barras que unen dos ("caprilico/caprico").
  let primero = inicial;
  return token.replace(/\p{L}+/gu, (nucleo) => {
    const abre = primero;
    primero = false;
    return trozo(nucleo, abre);
  });
}

function trozo(nucleo, inicial) {
  const alto = nucleo.toUpperCase();

  if (SIGLAS.has(alto)) return nucleo;
  if (MARCAS.has(alto)) return MARCAS.get(alto);
  if (CONECTORES.has(alto)) return inicial ? capitalizar(alto.toLowerCase()) : alto.toLowerCase();
  if (alto.length <= 2) return nucleo;

  const bajo = alto.toLowerCase();
  return inicial ? capitalizar(bajo) : bajo;
}

function capitalizar(palabra) {
  return palabra.charAt(0).toUpperCase() + palabra.slice(1);
}
