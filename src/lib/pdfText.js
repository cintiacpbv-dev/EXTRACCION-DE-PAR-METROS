import * as pdfjsLib from "pdfjs-dist";
import { casillasDePagina } from "./casillas.js";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const Y_TOLERANCE = 2.5;

/**
 * Agrupa los fragmentos de texto de una página en líneas visuales.
 * Conserva la coordenada X de cada fragmento, que el detector genérico usa
 * para saber en qué columna empieza el valor de un parámetro y así reconocer
 * las líneas de continuación (valores que el PDF parte en dos renglones).
 */
function buildLines(textContent) {
  const lines = [];

  for (const item of textContent.items) {
    if (item.str === undefined || item.str === "") continue;
    const x = item.transform[4];
    const y = item.transform[5];

    let line = lines.find((l) => Math.abs(l.y - y) <= Y_TOLERANCE);
    if (!line) {
      line = { y, segments: [] };
      lines.push(line);
    }
    // El ancho de cada fragmento permite medir el hueco que lo separa del
    // siguiente: en estos formularios el valor siempre está en una columna
    // aparte, y ese hueco es lo que distingue un dato de una frase corrida.
    line.segments.push({ str: item.str, x, width: item.width || 0 });
  }

  lines.sort((a, b) => b.y - a.y);

  return lines
    .map((line) => {
      line.segments.sort((a, b) => a.x - b.x);
      const text = line.segments
        .map((s) => s.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        y: line.y,
        x0: line.segments[0].x,
        text,
        segments: line.segments,
      };
    })
    .filter((l) => l.text !== "");
}

/**
 * Extrae el contenido de un PDF (File/Blob) en tres representaciones:
 *  - pages:    líneas y casillas de verificación por página (con coordenadas)
 *  - rawText:  texto con saltos de línea (depuración)
 *  - flatText: todo en una línea, espacios colapsados → metadatos de cabecera
 */
export async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    pages.push({
      index: i,
      lines: buildLines(textContent),
      // Las casillas de verificación del formulario no son texto: son
      // imágenes pequeñas. Sin ellas no hay forma de saber cuál de las
      // opciones de un "OPCION ELEGIDA" marcó el operario.
      casillas: await casillasDePagina(pdfjsLib, page),
    });
  }

  const rawText = pages.map((p) => p.lines.map((l) => l.text).join("\n")).join("\n\n");
  const flatText = rawText.replace(/\s+/g, " ").trim();

  return { pages, rawText, flatText, numPages: pdf.numPages };
}
