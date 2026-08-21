import * as XLSX from "xlsx";
import { buildTable, listStages } from "./model.js";

const COL_PARAM = 0;
const COL_SETPOINT = 1;
const COL_FIRST_LOTE = 2;

const HEADER_ROW = 3; // fila 1-based donde va la cabecera (fila 1 = título)

function colLetter(index) {
  let n = index;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function safeSheetName(name) {
  return (name || "Hoja")
    .replace(/[\\/?*[\]:]/g, " ")
    .trim()
    .slice(0, 31);
}

/**
 * Construye una hoja con el mismo esqueleto que la sábana de validación:
 *
 *   fila 1     título "PARAMETROS DEL PROCESO DE <ETAPA>"
 *   fila 3     cabecera (Parámetros | Setpoint | lotes… | Mín | Máx | Prom | Desv)
 *   fila 4     numeración correlativa de los lotes
 *   fila 5+    secciones y parámetros
 *
 * Las estadísticas se escriben como fórmulas de Excel (MIN/MAX/PROMEDIO/DESVEST)
 * y no como números fijos, para que la hoja recalcule si se edita un valor.
 */
function buildStageSheet(table) {
  const { stage, lotes, sections } = table;
  const nLotes = lotes.length;

  const statFirst = COL_FIRST_LOTE + nLotes;
  const firstLoteLetter = colLetter(COL_FIRST_LOTE);
  const lastLoteLetter = colLetter(COL_FIRST_LOTE + nLotes - 1);

  const ws = {};
  const meta = { sectionRows: [], dataRows: [], checkCells: [] };
  let r = 0; // índice 0-based

  const setCell = (row, col, cell) => {
    ws[XLSX.utils.encode_cell({ r: row, c: col })] = cell;
  };

  // Título
  setCell(0, COL_FIRST_LOTE, { t: "s", v: `PARAMETROS DEL PROCESO DE ${stage}` });

  // Cabecera
  r = HEADER_ROW - 1;
  setCell(r, COL_PARAM, { t: "s", v: "Parámetros" });
  setCell(r, COL_SETPOINT, { t: "s", v: "Setpoint" });
  lotes.forEach((lote, i) => {
    setCell(r, COL_FIRST_LOTE + i, { t: "s", v: String(lote) });
    setCell(r + 1, COL_FIRST_LOTE + i, { t: "n", v: i + 1 });
  });
  ["Mínimo", "Máximo", "Promedio", "Desviación estándar"].forEach((h, i) => {
    setCell(r, statFirst + i, { t: "s", v: h });
  });

  let row = HEADER_ROW + 1; // primera fila de datos (0-based tras cabecera doble)

  for (const section of sections) {
    setCell(row, COL_PARAM, { t: "s", v: section.title });
    meta.sectionRows.push(row + 1);
    row++;

    for (const dataRow of section.rows) {
      const excelRow = row + 1; // 1-based para las fórmulas
      const label = dataRow.unit && !dataRow.label.includes(dataRow.unit)
        ? `${dataRow.label} (${dataRow.unit})`
        : dataRow.label;

      setCell(row, COL_PARAM, { t: "s", v: label });
      setCell(row, COL_SETPOINT, { t: "s", v: dataRow.setpoint || "Referencial" });

      lotes.forEach((lote, i) => {
        const val = dataRow.values[lote];
        if (val === undefined || val === null || val === "") return;
        if (typeof val === "number") {
          setCell(row, COL_FIRST_LOTE + i, { t: "n", v: val });
        } else {
          setCell(row, COL_FIRST_LOTE + i, { t: "s", v: String(val) });
          if (val === "ü") meta.checkCells.push(XLSX.utils.encode_cell({ r: row, c: COL_FIRST_LOTE + i }));
        }
      });

      const range = `${firstLoteLetter}${excelRow}:${lastLoteLetter}${excelRow}`;
      if (dataRow.valueType === "number") {
        // IFERROR evita el #¡DIV/0! de DESVEST cuando todavía hay un solo lote
        // cargado, o el de PROMEDIO si ningún lote registró el parámetro.
        setCell(row, statFirst + 0, { t: "n", f: `IFERROR(MIN(${range}),"---")` });
        setCell(row, statFirst + 1, { t: "n", f: `IFERROR(MAX(${range}),"---")` });
        setCell(row, statFirst + 2, { t: "n", f: `IFERROR(AVERAGE(${range}),"---")` });
        setCell(row, statFirst + 3, { t: "n", f: `IFERROR(STDEV(${range}),"---")` });
      } else {
        [0, 1, 2, 3].forEach((i) => setCell(row, statFirst + i, { t: "s", v: "---" }));
      }

      meta.dataRows.push(excelRow);
      row++;
    }
  }

  const lastCol = statFirst + 3;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: row, c: lastCol } });
  ws["!merges"] = [{ s: { r: 0, c: COL_FIRST_LOTE }, e: { r: 0, c: Math.max(COL_FIRST_LOTE + nLotes - 1, COL_FIRST_LOTE) } }];
  ws["!cols"] = [
    { wch: 46 },
    { wch: 26 },
    ...lotes.map(() => ({ wch: 12 })),
    { wch: 11 },
    { wch: 11 },
    { wch: 11 },
    { wch: 13 },
  ];

  return ws;
}

/** Construye el libro completo: una hoja por etapa del producto. */
export function buildWorkbook(documents, producto, options) {
  const wb = XLSX.utils.book_new();

  for (const stage of listStages(documents, producto)) {
    const table = buildTable(documents, producto, stage, options);
    if (table.lotes.length === 0 || table.rowCount === 0) continue;
    XLSX.utils.book_append_sheet(wb, buildStageSheet(table), safeSheetName(stage));
  }

  return wb;
}

/**
 * Exporta un libro con una hoja por etapa del producto seleccionado.
 */
export function exportProductToExcel(documents, producto, options) {
  const wb = buildWorkbook(documents, producto, options);
  if (wb.SheetNames.length === 0) return false;

  const safeName = producto.replace(/[^\w.-]+/g, "_").slice(0, 60);
  XLSX.writeFile(wb, `${safeName}_parametros.xlsx`);
  return true;
}

/** Texto TSV de una etapa, para pegar directamente en Excel. */
export function tableToClipboardText(table) {
  const lines = [];
  const header = ["Parámetros", "Setpoint", ...table.lotes.map(String), "Mínimo", "Máximo", "Promedio", "Desviación estándar"];
  lines.push(header.join("\t"));

  const fmt = (n) => (n === null || n === undefined ? "" : Math.round(n * 1000) / 1000);

  for (const section of table.sections) {
    lines.push(section.title);
    for (const row of section.rows) {
      const cells = [row.label, row.setpoint || "Referencial"];
      for (const lote of table.lotes) {
        const v = row.values[lote];
        cells.push(v === undefined || v === null ? "" : String(v));
      }
      if (row.stats) {
        cells.push(fmt(row.stats.min), fmt(row.stats.max), fmt(row.stats.avg), fmt(row.stats.stdev));
      } else {
        cells.push("---", "---", "---", "---");
      }
      lines.push(cells.join("\t"));
    }
  }

  return lines.join("\n");
}
