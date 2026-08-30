// Qué archivos ya se analizaron, para no volver a analizarlos.
//
// Analizar un RMD cuesta: se abre el PDF, se leen todas sus páginas y se
// reconstruyen las líneas por coordenadas. Hasta ahora eso se hacía siempre,
// incluso con un archivo idéntico a otro ya cargado, porque la huella con la
// que se detectaba el duplicado se calculaba sobre los parámetros — es decir,
// después de analizarlo.
//
// Aquí la huella es la del archivo en bruto, que se puede calcular sin
// abrirlo: unos milisegundos frente a varios segundos. Con ella el archivo ya
// visto se aparta antes de tocarlo, y sólo se analiza si se pide.
//
// El registro vive en este navegador. En otra computadora el mismo archivo se
// analiza una primera vez y a partir de ahí queda apuntado también allí: es
// una memoria de trabajo, no un dato del producto, y no tiene sentido
// guardarla con los lotes.

const CLAVE = "detparam.analizados.v1";

// Cuántos archivos se recuerdan. De sobra para varias validaciones seguidas,
// y con tope para que el registro no crezca sin fin.
const MAXIMO = 4000;

/** La huella de un archivo, calculada sobre sus bytes sin interpretarlos. */
export async function huellaDeArchivo(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function leer() {
  try {
    const raw = localStorage.getItem(CLAVE);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function guardar(mapa) {
  const claves = Object.keys(mapa);
  const podado =
    claves.length <= MAXIMO
      ? mapa
      : Object.fromEntries(
          claves
            .sort((a, b) => String(mapa[b].fecha).localeCompare(String(mapa[a].fecha)))
            .slice(0, MAXIMO)
            .map((k) => [k, mapa[k]])
        );

  try {
    localStorage.setItem(CLAVE, JSON.stringify(podado));
  } catch {
    // Sin sitio en el navegador se pierde la memoria, no el análisis.
  }
}

/** Lo que se sabe de un archivo ya analizado, o null si es la primera vez. */
export function analisisPrevio(huella) {
  return leer()[huella] || null;
}

/** Apunta que este archivo ya se analizó, y con qué resultado. */
export function recordarAnalisis(huella, { producto, lote, stage, fileName }) {
  const mapa = leer();
  mapa[huella] = {
    producto: producto || "",
    lote: lote || "",
    stage: stage || "",
    fileName: fileName || "",
    fecha: new Date().toISOString(),
  };
  guardar(mapa);
}

/** Borra la marca de un archivo: la próxima vez se analiza como nuevo. */
export function olvidarAnalisis(huellas) {
  const mapa = leer();
  for (const h of huellas) delete mapa[h];
  guardar(mapa);
}

/** Cuántos archivos hay apuntados. */
export function cuantosAnalizados() {
  return Object.keys(leer()).length;
}
