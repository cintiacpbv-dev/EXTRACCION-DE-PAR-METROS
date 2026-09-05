// Importar datos pegados o subidos a la hoja de trabajo del Análisis
// Estadístico: parseo de CSV, detección de tipo por columna y lectura de
// Excel (reutilizando exceljs, que ya usa el resto de la aplicación).
import ExcelJS from "exceljs";

/** Parser de CSV con comillas (campos con comas o saltos de línea dentro). */
export function parseCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = "";
  let dentroComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') {
      dentroComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  // Descarta líneas totalmente vacías (habitual al final del archivo).
  return filas.filter((f) => !(f.length === 1 && f[0].trim() === ""));
}

function pareceNumero(texto) {
  const t = String(texto).trim();
  return t !== "" && !Number.isNaN(Number(t.replace(",", ".")));
}

function pareceFecha(texto) {
  const t = String(texto).trim();
  return t !== "" && !pareceNumero(t) && !Number.isNaN(Date.parse(t));
}

export function detectarTipo(valores) {
  const noVacios = valores.filter((v) => v != null && String(v).trim() !== "");
  if (noVacios.length === 0) return "text";
  if (noVacios.every(pareceNumero)) return "numeric";
  if (noVacios.every(pareceFecha)) return "date";
  return "text";
}

/**
 * De una matriz de filas de texto a columnas tipadas para la hoja.
 * La primera fila se toma como encabezado sólo si no parece datos
 * numéricos — así una hoja pegada sin encabezado no pierde su primera fila.
 */
export function filasATablero(filas) {
  if (filas.length === 0) return [];
  const primeraEsEncabezado = filas[0].every((v) => v.trim() !== "" && !pareceNumero(v));
  const encabezados = primeraEsEncabezado ? filas[0] : null;
  const datos = primeraEsEncabezado ? filas.slice(1) : filas;
  const numColumnas = Math.max(...filas.map((f) => f.length));

  const columnas = [];
  for (let c = 0; c < numColumnas; c++) {
    const valoresTexto = datos.map((f) => (f[c] ?? "").trim());
    const tipo = detectarTipo(valoresTexto);
    columnas.push({
      name: encabezados?.[c]?.trim() || `C${c + 1}`,
      type: tipo,
      values: valoresTexto.map((v) => (v === "" ? null : v)),
    });
  }
  return columnas;
}

/** Lee la primera hoja de un archivo .xlsx y la vuelca al mismo formato que un CSV. */
export async function leerExcel(arrayBuffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(arrayBuffer);
  const hoja = libro.worksheets[0];
  if (!hoja) return [];

  const filas = [];
  hoja.eachRow({ includeEmpty: false }, (fila) => {
    const valores = [];
    fila.eachCell({ includeEmpty: true }, (celda) => {
      const v = celda.value;
      if (v == null) valores.push("");
      else if (v instanceof Date) valores.push(v.toISOString().slice(0, 10));
      else if (typeof v === "object" && "text" in v) valores.push(String(v.text));
      else if (typeof v === "object" && "result" in v) valores.push(String(v.result ?? ""));
      else valores.push(String(v));
    });
    filas.push(valores);
  });
  return filasATablero(filas);
}
