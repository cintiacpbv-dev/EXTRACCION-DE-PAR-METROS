// Lectura del cronograma de calificación de equipos (el Excel "( OQ y PQ )
// REGISTRO DE AREAS SISTEMAS EQUIPOS A CALIFICAR"), que es de donde sale el
// estado, el código y la fecha de calificación de cada máquina del Formato 3.
//
// Ese libro se actualiza cada cierto tiempo y sus columnas se mueven: sólo
// entre dos copias del mismo archivo ya cambian de sitio. Por eso aquí no hay
// ningún número de columna fijo — se busca la fila de cabecera y cada columna
// se localiza por su título. Si el día de mañana se añade una columna en
// medio, esto sigue funcionando.

import ExcelJS from "exceljs";

const HOJA = "Cronograma";
const FILAS_CABECERA = 40; // hasta dónde buscar la fila de títulos

/** Sin tildes, en mayúsculas y con los espacios colapsados. */
function norm(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// Cada columna que hace falta, reconocida por su título. El orden importa
// dentro de OQ y PQ: "(PQ) - REALIZADO POR:" es el nombre de quien calificó y
// "(PQ) - REALIZADO:" la fecha, así que la fecha se pide sin el "POR".
const COLUMNAS = [
  ["mif", /^CODIGO$/],
  ["sap", /^CODIGO SAP$/],
  ["descripcion", /^DESCRIPCION$/],
  ["estado", /^ESTADO$/],
  ["sucursal", /^SUCURSAL$/],
  ["seccion", /^SECCION$/],
  ["oqFecha", /^\(OQ\)\s*-?\s*FECHA REALIZADO:?$/],
  ["oqEstado", /^\(OQ\)\s*-?\s*ESTADO DE CALIFICACION:?$/],
  ["oqReporte", /^\(OQ\)\s*-?\s*NRO\. DE REPORTE:?$/],
  ["pqFecha", /^\(PQ\)\s*-?\s*REALIZADO:?$/],
  ["pqEstado", /^\(PQ\)\s*-?\s*ESTADO DE CALIFICACION:?$/],
  ["pqReporte", /^\(PQ\)\s*-?\s*NRO\. DE REPORTE:?$/],
  ["estadoGeneral", /^ESTADO GENERAL$/],
  ["observaciones", /^OBSERVACIONES$/],
];

/**
 * Los códigos MIF se escriben con distinto número de ceros según quién los
 * teclee: el registro de manufactura dice "SOL-E096" donde el cronograma dice
 * "SOL-E96", y "ACO-E03" donde el otro dice "ACO-E003". Quitar los ceros de
 * relleno a los dos lados los hace comparables.
 */
export function normalizarMif(codigo) {
  const limpio = norm(codigo).replace(/\s+/g, "");
  const m = limpio.match(/^(.*?[A-Z])0+(\d.*)$/);
  return m ? `${m[1]}${m[2]}` : limpio;
}

/** El código SAP, sólo sus dígitos (el Excel lo guarda a veces como número). */
export function normalizarSap(codigo) {
  const digitos = String(codigo ?? "").replace(/\D/g, "");
  return digitos || null;
}

/** "2025-09". Es como se escribe la fecha en el Formato 3: año y mes. */
function mesDe(valor) {
  if (valor == null || valor === "") return null;

  if (valor instanceof Date) {
    return `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, "0")}`;
  }

  // Fecha de Excel guardada como número de serie (días desde 1899-12-30).
  if (typeof valor === "number" && valor > 20000 && valor < 80000) {
    return mesDe(new Date(Date.UTC(1899, 11, 30) + valor * 86400000));
  }

  const texto = String(valor).trim();
  const m = texto.match(/^(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;

  const dmy = texto.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}`;

  // Lo que no es una fecha significa que no la hay. La casilla trae a veces
  // "NO APLICA", "COMPLETAR" o "PENDIENTE", y darlo por bueno hacía que un
  // equipo sin calificación de desempeño saliera con "NO APLICA" donde va la
  // fecha y sin el guion en CD que avisa de que esa calificación no existe.
  return null;
}

function texto(valor) {
  if (valor == null) return "";
  // ExcelJS devuelve objetos para fórmulas y texto enriquecido.
  if (typeof valor === "object") {
    if (valor.result != null) return String(valor.result).trim();
    if (Array.isArray(valor.richText)) return valor.richText.map((t) => t.text).join("").trim();
    if (valor.text != null) return String(valor.text).trim();
    return "";
  }
  return String(valor).trim();
}

/** Busca la fila de títulos y devuelve, para cada columna que interesa, su número. */
function localizarColumnas(hoja) {
  for (let fila = 1; fila <= Math.min(FILAS_CABECERA, hoja.rowCount); fila++) {
    const titulos = new Map();
    hoja.getRow(fila).eachCell({ includeEmpty: false }, (celda, col) => {
      titulos.set(col, norm(texto(celda.value)));
    });

    if (![...titulos.values()].includes("CODIGO SAP")) continue;

    const mapa = {};
    for (const [clave, patron] of COLUMNAS) {
      for (const [col, titulo] of titulos) {
        if (patron.test(titulo)) {
          mapa[clave] = col;
          break;
        }
      }
    }

    if (mapa.sap && mapa.descripcion) return { filaCabecera: fila, mapa };
  }

  return null;
}

/**
 * Lee el cronograma y devuelve una entrada por equipo, lista para consultar.
 *
 * Se queda con las filas que tengan código SAP o MIF: el libro trae también
 * áreas y sistemas sin código, que nunca van a coincidir con nada del
 * registro de manufactura.
 */
export async function leerCronograma(arrayBuffer, { fileName = "" } = {}) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(arrayBuffer);

  const hoja =
    libro.getWorksheet(HOJA) ||
    libro.worksheets.find((h) => norm(h.name).startsWith(norm(HOJA))) ||
    libro.worksheets[0];

  if (!hoja) return { ok: false, error: "El archivo no tiene ninguna hoja legible." };

  const encontrado = localizarColumnas(hoja);
  if (!encontrado) {
    return {
      ok: false,
      error: `No se encontró la cabecera del cronograma (una fila con "CÓDIGO SAP") en la hoja "${hoja.name}".`,
    };
  }

  const { filaCabecera, mapa } = encontrado;
  const filas = [];

  for (let n = filaCabecera + 1; n <= hoja.rowCount; n++) {
    const fila = hoja.getRow(n);
    const valor = (clave) => (mapa[clave] ? fila.getCell(mapa[clave]).value : null);

    const sap = normalizarSap(texto(valor("sap")));
    const mif = texto(valor("mif"));
    if (!sap && !mif) continue;

    filas.push({
      sap,
      mif,
      descripcion: texto(valor("descripcion")),
      estado: texto(valor("estado")),
      sucursal: texto(valor("sucursal")),
      seccion: texto(valor("seccion")),
      oqFecha: mesDe(valor("oqFecha")),
      oqEstado: texto(valor("oqEstado")),
      oqReporte: texto(valor("oqReporte")),
      pqFecha: mesDe(valor("pqFecha")),
      pqEstado: texto(valor("pqEstado")),
      pqReporte: texto(valor("pqReporte")),
      estadoGeneral: texto(valor("estadoGeneral")),
      observaciones: texto(valor("observaciones")),
    });
  }

  return {
    ok: true,
    cronograma: {
      fileName,
      hoja: hoja.name,
      cargado: new Date().toISOString(),
      filas,
    },
  };
}

/** Índices por código SAP y por código MIF normalizado. */
export function indexar(cronograma) {
  const porSap = new Map();
  const porMif = new Map();

  for (const fila of cronograma?.filas || []) {
    if (fila.sap && !porSap.has(fila.sap)) porSap.set(fila.sap, fila);
    const mif = normalizarMif(fila.mif);
    if (mif && !porMif.has(mif)) porMif.set(mif, fila);
  }

  return { porSap, porMif };
}

// "COMPLETAR" es lo que el cronograma escribe donde todavía falta el dato;
// vale tanto como una casilla vacía.
function dato(valor) {
  const t = (valor || "").trim();
  return !t || norm(t) === "COMPLETAR" ? "" : t;
}

/**
 * Lo que el Formato 3 necesita saber de un equipo.
 *
 * La fecha y el código de calificación se toman del desempeño (PQ) y, si el
 * equipo no lo tiene, de la operación (OQ) — que es el criterio que sigue el
 * formato en papel: en los equipos sin PQ la fila lleva la fecha de la OQ y
 * la casilla CD marcada con un guion.
 */
export function buscarCalificacion(indices, equipo) {
  const sap = normalizarSap(equipo?.codigoSap);
  const mif = normalizarMif(equipo?.codigoMif);

  const fila = (sap && indices.porSap.get(sap)) || (mif && indices.porMif.get(mif)) || null;
  if (!fila) return null;

  const tieneCd = Boolean(fila.pqFecha);
  const tieneCo = Boolean(fila.oqFecha);

  const fecha = fila.pqFecha || fila.oqFecha || "";
  const reportePreferido = tieneCd ? fila.pqReporte : fila.oqReporte;
  const codigoCalificacion = dato(reportePreferido) || dato(fila.pqReporte) || dato(fila.oqReporte);

  return {
    fila,
    codigoMif: fila.mif || equipo?.codigoMif || "",
    descripcion: fila.descripcion || equipo?.descripcion || "",
    estado: fila.estado,
    estadoGeneral: fila.estadoGeneral,
    seccion: fila.seccion,
    observaciones: fila.observaciones,
    fecha,
    codigoCalificacion,
    origenFecha: tieneCd ? "PQ" : tieneCo ? "OQ" : null,
    tieneCo,
    tieneCd,
  };
}

// --- memoria del cronograma cargado -----------------------------------------
//
// El libro se actualiza cada cierto tiempo y hay que volver a subirlo, pero no
// en cada recarga de la página: lo leído se guarda en este navegador para que
// el Formato 3 esté listo al abrir la aplicación. Si no cupiera, sólo
// significa volver a subirlo esta sesión.

const CLAVE_LOCAL = "deteccion-parametros:cronograma:v1";

export function guardarCronogramaLocal(cronograma) {
  try {
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(cronograma));
    return true;
  } catch {
    return false;
  }
}

export function cargarCronogramaLocal() {
  try {
    const raw = localStorage.getItem(CLAVE_LOCAL);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.filas) ? parsed : null;
  } catch {
    return null;
  }
}

export function olvidarCronogramaLocal() {
  try {
    localStorage.removeItem(CLAVE_LOCAL);
  } catch {
    // Nada que hacer: se queda hasta la próxima carga.
  }
}
