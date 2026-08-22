// Genera el libro de Excel ya con el mismo formato que antes dejaba la macro
// VBA (Arial 8, cabecera gris, bordes finos, estadísticas en verde, vistos
// buenos en Wingdings): no hace falta ningún paso manual después de exportar.
import ExcelJS from "exceljs";
import { aggregatePersonnel, buildTable, listStages } from "./model.js";
import { formatPersonName } from "./personName.js";

const FUENTE = "Arial";
const TAM_DATOS = 8;
const TAM_CABECERA = 7.5;
const TAM_TITULO = 11;
const GRIS_CABECERA = "FFD9D9D9";
const GRIS_SECCION = "FFE7E6E6";
const VERDE_STATS = "FFCCFFCC";
const NEGRO = "FF000000";

const ANCHO_PARAMETRO = 46;
const ANCHO_SETPOINT = 26;
const ANCHO_LOTE = 12;
const ANCHO_ESTADIS = 12;

const COL_PARAM = 1;
const COL_SETPOINT = 2;
const COL_FIRST_LOTE = 3;
const HEADER_ROW = 3; // fila 1-based donde va la cabecera (fila 1 = título)

const BORDE = { style: "thin", color: { argb: NEGRO } };
const BORDES = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE };

function safeSheetName(name) {
  return (name || "Hoja")
    .replace(/[\\/?*[\]:]/g, " ")
    .trim()
    .slice(0, 31);
}

/** Letra de columna de Excel a partir de un índice 1-based (3 -> "C", 27 -> "AA"). */
function colLetter(n) {
  let s = "";
  let i = n;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/**
 * Construye la hoja de una etapa con el mismo esqueleto que la sábana de
 * validación, ya formateada:
 *
 *   fila 1     título "PARAMETROS DEL PROCESO DE <ETAPA>"
 *   fila 3-4   cabecera (Parámetros | Setpoint | lotes… | Mín | Máx | Prom | Desv)
 *   fila 5+    secciones y parámetros
 *
 * Las estadísticas se escriben como fórmulas de Excel (MIN/MAX/PROMEDIO/DESVEST)
 * y no como números fijos, para que la hoja recalcule si se edita un valor.
 */
function buildStageSheet(wb, table) {
  const { stage, lotes, sections } = table;
  const nLotes = lotes.length;
  const statFirst = COL_FIRST_LOTE + nLotes;
  const lastCol = statFirst + 3;

  const ws = wb.addWorksheet(safeSheetName(stage), {
    views: [{ state: "frozen", xSplit: COL_FIRST_LOTE - 1, ySplit: HEADER_ROW + 1 }],
  });

  // Título
  ws.getCell(1, COL_FIRST_LOTE).value = `PARAMETROS DEL PROCESO DE ${stage}`;
  const finLote = COL_FIRST_LOTE + nLotes - 1;
  if (finLote > COL_FIRST_LOTE) ws.mergeCells(1, COL_FIRST_LOTE, 1, finLote);

  // Cabecera (dos filas): nombres de lote + numeración correlativa debajo.
  ws.getCell(HEADER_ROW, COL_PARAM).value = "Parámetros";
  ws.getCell(HEADER_ROW, COL_SETPOINT).value = "Setpoint";
  lotes.forEach((lote, i) => {
    ws.getCell(HEADER_ROW, COL_FIRST_LOTE + i).value = String(lote);
    ws.getCell(HEADER_ROW + 1, COL_FIRST_LOTE + i).value = i + 1;
  });
  ["Mínimo", "Máximo", "Promedio", "Desviación estándar"].forEach((h, i) => {
    ws.getCell(HEADER_ROW, statFirst + i).value = h;
  });

  // Cuerpo: una fila por sección y una por parámetro, con las estadísticas
  // como fórmulas sobre el rango de columnas de lote de esa fila.
  const sectionRows = new Set();
  let row = HEADER_ROW + 2;
  for (const section of sections) {
    ws.getCell(row, COL_PARAM).value = section.title;
    sectionRows.add(row);
    row++;

    for (const dataRow of section.rows) {
      const label =
        dataRow.unit && !dataRow.label.includes(dataRow.unit) ? `${dataRow.label} (${dataRow.unit})` : dataRow.label;
      ws.getCell(row, COL_PARAM).value = label;
      ws.getCell(row, COL_SETPOINT).value = dataRow.setpoint || "Referencial";

      lotes.forEach((lote, i) => {
        const val = dataRow.values[lote];
        if (val === undefined || val === null || val === "") return;
        ws.getCell(row, COL_FIRST_LOTE + i).value = val;
      });

      if (dataRow.valueType === "number") {
        // IFERROR evita el #¡DIV/0! de DESVEST cuando todavía hay un solo
        // lote cargado, o el de PROMEDIO si ningún lote registró el dato.
        const rango = `${colLetter(COL_FIRST_LOTE)}${row}:${colLetter(COL_FIRST_LOTE + nLotes - 1)}${row}`;
        ws.getCell(row, statFirst).value = { formula: `IFERROR(MIN(${rango}),"---")` };
        ws.getCell(row, statFirst + 1).value = { formula: `IFERROR(MAX(${rango}),"---")` };
        ws.getCell(row, statFirst + 2).value = { formula: `IFERROR(AVERAGE(${rango}),"---")` };
        ws.getCell(row, statFirst + 3).value = { formula: `IFERROR(STDEV(${rango}),"---")` };
      } else {
        for (let i = 0; i < 4; i++) ws.getCell(row, statFirst + i).value = "---";
      }

      row++;
    }
  }
  const ultimaFila = row - 1;

  // --- Formato -------------------------------------------------------------

  // Base: toda la tabla.
  for (let f = HEADER_ROW; f <= ultimaFila; f++) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(f, c);
      cell.font = { name: FUENTE, size: TAM_DATOS, color: { argb: NEGRO } };
      cell.border = BORDES;
    }
  }

  // Título (fila 1)
  for (let c = 1; c <= lastCol; c++) {
    ws.getCell(1, c).font = { name: FUENTE, size: TAM_TITULO, bold: true, color: { argb: NEGRO } };
    ws.getCell(1, c).alignment = { horizontal: "center" };
  }

  // Cabecera (dos filas), con las columnas de estadística en verde.
  for (let f = HEADER_ROW; f <= HEADER_ROW + 1; f++) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(f, c);
      cell.font = { name: FUENTE, size: TAM_CABECERA, bold: true, color: { argb: NEGRO } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS_CABECERA } };
    }
    for (let c = statFirst; c <= statFirst + 3; c++) {
      ws.getCell(f, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_STATS } };
    }
  }
  ws.getRow(HEADER_ROW).height = 34;

  // Cuerpo: secciones y filas de datos.
  for (let f = HEADER_ROW + 2; f <= ultimaFila; f++) {
    if (sectionRows.has(f)) {
      for (let c = 1; c <= lastCol; c++) {
        const cell = ws.getCell(f, c);
        cell.font = { name: FUENTE, size: TAM_DATOS, bold: true, color: { argb: NEGRO } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS_SECCION } };
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
      continue;
    }

    ws.getCell(f, COL_PARAM).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    ws.getCell(f, COL_SETPOINT).alignment = { horizontal: "center", vertical: "middle", wrapText: true };

    for (let c = COL_FIRST_LOTE; c < statFirst; c++) {
      const cell = ws.getCell(f, c);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      // El visto bueno se escribe como "ü" y se muestra como check al
      // dibujarse en fuente Wingdings, igual que hacía la macro.
      if (cell.value === "ü") cell.font = { ...cell.font, name: "Wingdings" };
    }

    for (let c = statFirst; c < statFirst + 4; c++) {
      const cell = ws.getCell(f, c);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_STATS } };
      if (cell.value !== "---") cell.numFmt = "0.000";
    }

    ws.getRow(f).height = 20;
  }

  // Anchos de columna.
  ws.getColumn(COL_PARAM).width = ANCHO_PARAMETRO;
  ws.getColumn(COL_SETPOINT).width = ANCHO_SETPOINT;
  for (let c = COL_FIRST_LOTE; c < statFirst; c++) ws.getColumn(c).width = ANCHO_LOTE;
  for (let c = statFirst; c < statFirst + 4; c++) ws.getColumn(c).width = ANCHO_ESTADIS;

  return ws;
}

/**
 * Hoja "Participantes": una fila por persona y etapa, con su rol (Operario,
 * bajo "Realizado / Por", o Supervisor, bajo "VB") y cuántas veces aparece
 * firmando en los lotes cargados.
 */
function buildPersonnelSheet(wb, documents, producto, stages) {
  const filas = [];
  for (const stage of stages) {
    const { operarios, supervisores } = aggregatePersonnel(documents, producto, stage);
    for (const p of operarios) filas.push([stage, "Operario (Realizado / Por)", formatPersonName(p.name), p.count]);
    for (const p of supervisores) filas.push([stage, "Supervisor (VB)", formatPersonName(p.name), p.count]);
  }
  if (filas.length === 0) return null;

  const ws = wb.addWorksheet("Participantes");
  ws.addRow(["Etapa", "Rol", "Nombre", "Intervenciones"]);
  filas.forEach((f) => ws.addRow(f));

  [18, 26, 20, 15].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  ws.getRow(1).eachCell((cell) => {
    cell.font = { name: FUENTE, size: TAM_CABECERA, bold: true, color: { argb: NEGRO } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRIS_CABECERA } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BORDES;
  });

  for (let f = 2; f <= filas.length + 1; f++) {
    for (let c = 1; c <= 4; c++) {
      const cell = ws.getCell(f, c);
      cell.font = { name: FUENTE, size: TAM_DATOS, color: { argb: NEGRO } };
      cell.border = BORDES;
      cell.alignment = { horizontal: c === 3 ? "left" : "center", vertical: "middle" };
    }
  }

  return ws;
}

/** Construye el libro completo: una hoja por etapa del producto, más participantes. */
export function buildWorkbook(documents, producto, options) {
  const wb = new ExcelJS.Workbook();
  const stages = listStages(documents, producto);

  for (const stage of stages) {
    const table = buildTable(documents, producto, stage, options);
    if (table.lotes.length === 0 || table.rowCount === 0) continue;
    buildStageSheet(wb, table);
  }

  buildPersonnelSheet(wb, documents, producto, stages);

  return wb;
}

/**
 * Exporta un libro con una hoja por etapa del producto seleccionado, ya
 * formateado: no requiere ejecutar ninguna macro después.
 */
export async function exportProductToExcel(documents, producto, options) {
  const wb = buildWorkbook(documents, producto, options);
  if (wb.worksheets.length === 0) return false;

  const buffer = await wb.xlsx.writeBuffer();
  const safeName = producto.replace(/[^\w.-]+/g, "_").slice(0, 60);

  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}_parametros.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
