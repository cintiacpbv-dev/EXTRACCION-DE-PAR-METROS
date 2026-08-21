import { extractPdfText } from "../pdfText.js";
import { extractMeta } from "./meta.js";
import { detectParameters } from "./genericParser.js";
import { detectPersonnel } from "./personnel.js";

/**
 * Procesa un PDF de Registro de Manufactura de cualquier producto y etapa.
 * Devuelve la cabecera y la lista de parámetros descubiertos en el documento.
 */
export async function processPdfFile(file) {
  const { pages, flatText, numPages } = await extractPdfText(file);
  const meta = extractMeta(flatText);
  const params = detectParameters(pages);
  const personnel = detectPersonnel(pages);

  if (params.length === 0) {
    throw new Error(
      `No se detectó ningún parámetro en "${file.name}". Verifica que el PDF contenga texto seleccionable (no una imagen escaneada).`
    );
  }

  return {
    stage: meta.stage,
    meta,
    params,
    personnel,
    fileName: file.name,
    numPages,
    parsedAt: new Date().toISOString(),
  };
}
