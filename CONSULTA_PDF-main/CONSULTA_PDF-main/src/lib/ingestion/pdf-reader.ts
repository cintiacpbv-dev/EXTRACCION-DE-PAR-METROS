import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

// Resuelto contra la raíz del proyecto (process.cwd()) en vez de
// require.resolve: este módulo se ejecuta tanto dentro del bundler de
// Next.js como en el script de worker standalone (tsx), y process.cwd()
// es estable en ambos casos.
const PDFJS_ROOT = path.join(process.cwd(), 'node_modules', 'pdfjs-dist');
const STANDARD_FONT_DATA_URL = pathToFileURL(
  path.join(PDFJS_ROOT, 'standard_fonts') + path.sep,
).href;
const CMAP_URL = pathToFileURL(path.join(PDFJS_ROOT, 'cmaps') + path.sep).href;

// Bajo el bundler de Next.js (Turbopack/webpack) pdfjs-dist no logra
// resolver su propio worker por ruta relativa al chunk empaquetado
// ("Setting up fake worker failed"). Se le apunta explícitamente al
// archivo real en node_modules.
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(PDFJS_ROOT, 'legacy', 'build', 'pdf.worker.mjs'),
).href;

/** Umbral mínimo de caracteres para considerar que una página tiene texto nativo útil. */
const MIN_NATIVE_TEXT_CHARS = 30;

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdfjs-dist puede tomar posesión (transferir) el ArrayBuffer subyacente,
  // dejando `bytes` inutilizable para el resto del pipeline (p.ej. para
  // partir el PDF en pdf-split.ts). Se le pasa siempre una copia.
  const loadingTask = getDocument({
    data: bytes.slice(),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    useSystemFonts: true,
  });
  return loadingTask.promise;
}

/**
 * Extrae el texto de una página preservando saltos de línea (usando el
 * flag `hasEOL` de pdfjs). Esto es necesario para que el chunking pueda
 * detectar párrafos y encabezados — un `join(' ')` plano los destruiría.
 */
export async function extractPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
    else if (item.str && !item.str.endsWith(' ')) text += ' ';
  }
  page.cleanup();
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function hasSufficientNativeText(text: string): boolean {
  return text.replace(/\s+/g, '').length >= MIN_NATIVE_TEXT_CHARS;
}
