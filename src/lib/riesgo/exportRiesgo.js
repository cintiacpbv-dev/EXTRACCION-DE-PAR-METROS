// Exporta el Análisis de Modos de Fallo y Efectos (AMFE) con el mismo
// formato que la Matriz de Identificación y Evaluación de Riesgo de Calidad
// de Humanova: mismo título, mismas columnas combinadas, mismo pie con las
// escalas de S/O/D y la nota de significancia — y el IPR y el SRI como
// fórmulas de Excel, no como números fijos, para que la hoja recalcule sola
// si alguien ajusta un S/O/D a mano.
import ExcelJS from "exceljs";
import { ESCALA_DETECCION, ESCALA_OCURRENCIA, ESCALA_SEVERIDAD } from "./model.js";

const FUENTE = "Times New Roman";
const TAM = 10;
const TAM_TITULO = 12;

const GRIS_CABECERA = "FF969696"; // el mismo gris (150,150,150) del ejemplo
const NEGRO = "FF000000";
const BORDE = { style: "thin", color: { argb: NEGRO } };
const BORDES = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE };

// Columnas (1-based) del cuadro, en el mismo orden que el ejemplo.
const COL = {
  proceso: 1,
  actividad: 2,
  modoFallo: 3,
  efecto: 4,
  s: 5,
  causa: 6,
  o: 7,
  controles: 8,
  documentos: 9,
  d: 10,
  ipr: 11,
  sri: 12,
  acciones: 13,
  responsable: 14,
  plazo: 15,
  accionesImplantadas: 16,
  s2: 17,
  o2: 18,
  d2: 19,
  ipr2: 20,
  sri2: 21,
};
const N_COLS = 21;

const ANCHOS = {
  [COL.proceso]: 18,
  [COL.actividad]: 26,
  [COL.modoFallo]: 26,
  [COL.efecto]: 28,
  [COL.s]: 6,
  [COL.causa]: 30,
  [COL.o]: 6,
  [COL.controles]: 30,
  [COL.documentos]: 32,
  [COL.d]: 6,
  [COL.ipr]: 8,
  [COL.sri]: 8,
  [COL.acciones]: 30,
  [COL.responsable]: 16,
  [COL.plazo]: 12,
  [COL.accionesImplantadas]: 30,
  [COL.s2]: 6,
  [COL.o2]: 6,
  [COL.d2]: 6,
  [COL.ipr2]: 8,
  [COL.sri2]: 8,
};

function celda(ws, r, c, valor, { bold = false, fill, align = "left", wrap = true, size = TAM } = {}) {
  const cell = ws.getCell(r, c);
  cell.value = valor;
  cell.font = { name: FUENTE, size, bold };
  cell.alignment = { horizontal: align, vertical: "middle", wrapText: wrap };
  cell.border = BORDES;
  if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  return cell;
}

function tituloCabecera(ws, r, c1, c2, texto) {
  ws.mergeCells(r, c1, r, c2);
  celda(ws, r, c1, texto, { bold: true, fill: GRIS_CABECERA, align: "center" });
}

/**
 * Arma el encabezado de dos filas del cuadro (grupos + subcolumnas), igual
 * que el original: "FALLOS POTENCIALES" sobre 5 columnas, "ESTADO ACTUAL"
 * sobre 5, y así.
 */
function encabezado(ws, filaInicio, { producto, etapa, responsable, revisadoPor }) {
  let r = filaInicio;

  ws.mergeCells(r, 1, r, N_COLS);
  celda(ws, r, 1, "MATRIZ DE IDENTIFICACIÓN Y EVALUACIÓN DE RIESGO DE CALIDAD", {
    bold: true,
    align: "center",
    size: TAM_TITULO,
  });
  ws.getRow(r).height = 22;
  r++;

  ws.mergeCells(r, 1, r, 2);
  celda(ws, r, 1, "Nombre del Proceso:", { bold: true });
  ws.mergeCells(r, 3, r, 7);
  celda(ws, r, 3, producto || "", {});
  ws.mergeCells(r, 8, r, 11);
  celda(ws, r, 8, "Realizado por:", { bold: true });
  ws.mergeCells(r, 12, r, 15);
  celda(ws, r, 12, responsable || "", {});
  ws.mergeCells(r, 16, r, 18);
  celda(ws, r, 16, "Revisado por:", { bold: true });
  ws.mergeCells(r, 19, r, N_COLS);
  celda(ws, r, 19, revisadoPor || "", {});
  r++;

  ws.mergeCells(r, 1, r, 2);
  celda(ws, r, 1, "Etapa:", { bold: true });
  ws.mergeCells(r, 3, r, 7);
  celda(ws, r, 3, etapa || "", {});
  ws.mergeCells(r, 8, r, 11);
  celda(ws, r, 8, "Fecha:", { bold: true });
  ws.mergeCells(r, 12, r, 15);
  celda(ws, r, 12, "", {});
  ws.mergeCells(r, 16, r, 18);
  celda(ws, r, 16, "Fecha:", { bold: true });
  ws.mergeCells(r, 19, r, N_COLS);
  celda(ws, r, 19, "", {});
  r++;

  // Encabezado de columnas, en dos filas como el original.
  const cabeceraFila1 = r;
  const cabeceraFila2 = r + 1;

  ws.mergeCells(cabeceraFila1, COL.proceso, cabeceraFila2, COL.proceso);
  celda(ws, cabeceraFila1, COL.proceso, "Proceso / Subproceso", { bold: true, fill: GRIS_CABECERA, align: "center" });

  ws.mergeCells(cabeceraFila1, COL.actividad, cabeceraFila2, COL.actividad);
  celda(ws, cabeceraFila1, COL.actividad, "Actividad", { bold: true, fill: GRIS_CABECERA, align: "center" });

  tituloCabecera(ws, cabeceraFila1, COL.modoFallo, COL.o, "FALLOS POTENCIALES");
  tituloCabecera(ws, cabeceraFila1, COL.controles, COL.sri, "ESTADO ACTUAL");

  ws.mergeCells(cabeceraFila1, COL.acciones, cabeceraFila2, COL.acciones);
  celda(ws, cabeceraFila1, COL.acciones, "Acciones a Tomar\n(Medidas de control)", {
    bold: true,
    fill: GRIS_CABECERA,
    align: "center",
  });
  ws.mergeCells(cabeceraFila1, COL.responsable, cabeceraFila2, COL.responsable);
  celda(ws, cabeceraFila1, COL.responsable, "Responsable(s)", { bold: true, fill: GRIS_CABECERA, align: "center" });
  ws.mergeCells(cabeceraFila1, COL.plazo, cabeceraFila2, COL.plazo);
  celda(ws, cabeceraFila1, COL.plazo, "Plazo de Cumplimiento", { bold: true, fill: GRIS_CABECERA, align: "center" });

  tituloCabecera(ws, cabeceraFila1, COL.accionesImplantadas, COL.sri2, "SITUACIÓN DE MEJORA");

  const sub = [
    [COL.modoFallo, "Modos de Fallo\n(Riesgos)"],
    [COL.efecto, "Efectos (Impacto)"],
    [COL.s, "S"],
    [COL.causa, "Causa(s) del Modo de Fallo"],
    [COL.o, "O"],
    [COL.controles, "Controles Existentes"],
    [COL.documentos, "Documentos Relacionados"],
    [COL.d, "D"],
    [COL.ipr, "IPR"],
    [COL.sri, "SRI"],
    [COL.accionesImplantadas, "Acciones Implantadas"],
    [COL.s2, "S"],
    [COL.o2, "O"],
    [COL.d2, "D"],
    [COL.ipr2, "IPR"],
    [COL.sri2, "SRI"],
  ];
  for (const [c, texto] of sub) {
    celda(ws, cabeceraFila2, c, texto, { bold: true, fill: GRIS_CABECERA, align: "center" });
  }

  ws.getRow(cabeceraFila1).height = 18;
  ws.getRow(cabeceraFila2).height = 32;

  return cabeceraFila2 + 1;
}

function pieDeEscalas(ws, filaInicio) {
  let r = filaInicio + 1;

  ws.mergeCells(r, 1, r, N_COLS);
  celda(ws, r, 1, "* Método empleado para la Gestión de Riesgos de Calidad: Análisis de Modos de Fallo y Efectos (AMFE)", {
    wrap: false,
  });
  r++;
  ws.mergeCells(r, 1, r, N_COLS);
  celda(
    ws,
    r,
    1,
    "** Determinación del Índice de Prioridad de Riesgo (IPR): IPR = S×O×D, donde: Severidad (S), Probabilidad de ocurrencia (O), Nivel de detección (D)",
    { wrap: false }
  );
  r++;
  ws.mergeCells(r, 1, r, N_COLS);
  celda(
    ws,
    r,
    1,
    "*** Significancia del riesgo (SRI): Riesgo Significativo (RS, IPR 64–125) · Riesgo Medianamente Significativo (MS, IPR 16–63) · Riesgo No Significativo (NS, IPR 1–15)",
    { wrap: false }
  );
  r += 2;

  const bloques = [
    { titulo: "SEVERIDAD (S)", col: "NIVEL DEL IMPACTO", escala: ESCALA_SEVERIDAD },
    { titulo: "PROBABILIDAD (O)", col: "FRECUENCIA", escala: ESCALA_OCURRENCIA },
    { titulo: "DETECTABILIDAD (D)", col: "CRITERIO", escala: ESCALA_DETECCION },
  ];
  const anchoBloque = Math.floor(N_COLS / 3);
  bloques.forEach((bloque, i) => {
    const c1 = 1 + i * anchoBloque;
    const c2 = i === bloques.length - 1 ? N_COLS : c1 + anchoBloque - 1;
    const cValor = c2;
    const cNombre = c1;

    ws.mergeCells(r, c1, r, c2);
    celda(ws, r, c1, bloque.titulo, { bold: true, fill: GRIS_CABECERA, align: "center" });

    celda(ws, r + 1, cNombre, bloque.col, { bold: true, align: "center" });
    celda(ws, r + 1, cValor, "VALOR", { bold: true, align: "center" });

    bloque.escala.forEach((nivel, j) => {
      celda(ws, r + 2 + j, cNombre, nivel.nivel, { align: "left" });
      celda(ws, r + 2 + j, cValor, nivel.valor, { align: "center" });
    });
  });

  return r + 2 + ESCALA_SEVERIDAD.length;
}

/**
 * Construye el libro de la matriz de riesgo. `filas` es una lista de
 * objetos con la forma de `filaVacia()` (ver riesgo/model.js), ya sea
 * llenados a mano, por el borrador de la IA, o mezcla de ambos.
 */
export function buildRiesgoWorkbook(filas, { producto, etapa, responsable, revisadoPor } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Matriz de Riesgo", {
    views: [{ state: "frozen", ySplit: 6 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  for (const [c, ancho] of Object.entries(ANCHOS)) {
    ws.getColumn(Number(c)).width = ancho;
  }

  const primeraFilaDatos = encabezado(ws, 1, { producto, etapa, responsable, revisadoPor });

  // El Proceso/Subproceso se combina a lo largo de todas las filas que
  // comparten el mismo texto, igual que en el ejemplo: la etapa se escribe
  // una sola vez por bloque, no repetida en cada línea.
  let r = primeraFilaDatos;
  let bloqueInicio = r;
  let procesoActual = filas[0]?.proceso ?? "";

  const cerrarBloque = (finalExclusivo) => {
    if (finalExclusivo > bloqueInicio) {
      if (finalExclusivo - 1 > bloqueInicio) ws.mergeCells(bloqueInicio, COL.proceso, finalExclusivo - 1, COL.proceso);
      celda(ws, bloqueInicio, COL.proceso, procesoActual, { bold: true, align: "center" });
    }
  };

  filas.forEach((fila, i) => {
    if (fila.proceso !== procesoActual) {
      cerrarBloque(r);
      procesoActual = fila.proceso;
      bloqueInicio = r;
    }

    celda(ws, r, COL.actividad, fila.actividad, { align: "left" });
    celda(ws, r, COL.modoFallo, fila.modoFallo, { align: "left" });
    celda(ws, r, COL.efecto, fila.efecto, { align: "left" });
    celda(ws, r, COL.s, fila.severidad === "" ? "" : Number(fila.severidad), { align: "center" });
    celda(ws, r, COL.causa, fila.causa, { align: "left" });
    celda(ws, r, COL.o, fila.ocurrencia === "" ? "" : Number(fila.ocurrencia), { align: "center" });
    celda(ws, r, COL.controles, fila.controles, { align: "left" });
    celda(ws, r, COL.documentos, fila.documentos, { align: "left" });
    celda(ws, r, COL.d, fila.deteccion === "" ? "" : Number(fila.deteccion), { align: "center" });

    const rS = `${colLetter(COL.s)}${r}`;
    const rO = `${colLetter(COL.o)}${r}`;
    const rD = `${colLetter(COL.d)}${r}`;
    celda(ws, r, COL.ipr, { formula: `=IF(OR(${rS}="",${rO}="",${rD}=""),"",${rS}*${rO}*${rD})` }, { align: "center", bold: true });
    const rIpr = `${colLetter(COL.ipr)}${r}`;
    celda(
      ws,
      r,
      COL.sri,
      { formula: `=IF(${rIpr}="","",IF(${rIpr}<=15,"NS",IF(${rIpr}<=63,"MS","RS")))` },
      { align: "center", bold: true }
    );

    celda(ws, r, COL.acciones, fila.accionesATomar, { align: "left" });
    celda(ws, r, COL.responsable, fila.responsable, { align: "left" });
    celda(ws, r, COL.plazo, fila.plazo, { align: "left" });
    celda(ws, r, COL.accionesImplantadas, fila.accionesImplantadas, { align: "left" });
    celda(ws, r, COL.s2, fila.severidad2 === "" ? "" : Number(fila.severidad2), { align: "center" });
    celda(ws, r, COL.o2, fila.ocurrencia2 === "" ? "" : Number(fila.ocurrencia2), { align: "center" });
    celda(ws, r, COL.d2, fila.deteccion2 === "" ? "" : Number(fila.deteccion2), { align: "center" });

    const rS2 = `${colLetter(COL.s2)}${r}`;
    const rO2 = `${colLetter(COL.o2)}${r}`;
    const rD2 = `${colLetter(COL.d2)}${r}`;
    celda(ws, r, COL.ipr2, { formula: `=IF(OR(${rS2}="",${rO2}="",${rD2}=""),"",${rS2}*${rO2}*${rD2})` }, { align: "center", bold: true });
    const rIpr2 = `${colLetter(COL.ipr2)}${r}`;
    celda(
      ws,
      r,
      COL.sri2,
      { formula: `=IF(${rIpr2}="","",IF(${rIpr2}<=15,"NS",IF(${rIpr2}<=63,"MS","RS")))` },
      { align: "center", bold: true }
    );

    if (i === filas.length - 1) cerrarBloque(r + 1);
    r++;
  });

  pieDeEscalas(ws, r);

  return wb;
}

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

export async function exportRiesgoToExcel(filas, opciones) {
  if (!filas || filas.length === 0) return false;
  const wb = buildRiesgoWorkbook(filas, opciones);
  const buffer = await wb.xlsx.writeBuffer();

  const safeName = (opciones?.producto || "matriz_riesgo").replace(/[^\w.-]+/g, "_").slice(0, 60);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}_analisis_riesgo.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
