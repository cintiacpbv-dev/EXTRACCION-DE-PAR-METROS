import { PDFDocument } from 'pdf-lib';

/**
 * Extrae un subconjunto de páginas (1-indexadas, en el orden dado) del PDF
 * original como un PDF nuevo e independiente. Se usa para enviar a Gemini
 * solo las páginas que necesitan visión, nunca el documento completo.
 */
export async function extractPagesAsPdf(
  sourceBytes: Uint8Array,
  pageNumbers: number[],
): Promise<Uint8Array> {
  const source = await PDFDocument.load(sourceBytes);
  const output = await PDFDocument.create();
  const indices = pageNumbers.map((n) => n - 1);
  const copied = await output.copyPages(source, indices);
  copied.forEach((page) => output.addPage(page));
  return output.save();
}
