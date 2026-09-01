import { Type } from '@google/genai';
import { withGemini, aiConfig } from '@/lib/ai/gemini';
import { extractPagesAsPdf } from './pdf-split';
import type { ChunkContentType } from '@/types/database';

export interface VisionPageResult {
  pageNumber: number;
  contentType: ChunkContentType;
  text: string;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          page_number: { type: Type.INTEGER },
          content_type: {
            type: Type.STRING,
            enum: ['text', 'table', 'image', 'formula', 'mixed'],
          },
          text: { type: Type.STRING },
        },
        required: ['page_number', 'content_type', 'text'],
      },
    },
  },
  required: ['pages'],
};

const PROMPT = `Eres un motor de OCR/transcripción de documentos. Se te da un PDF de varias
páginas (posiblemente escaneadas o con contenido visual: tablas, gráficos, diagramas,
fórmulas). Para cada página, en el orden en que aparece en este PDF (empezando en 1),
transcribe TODO el contenido textual relevante:
- Texto normal: transcríbelo tal cual.
- Tablas: represéntalas en Markdown, conservando filas y columnas.
- Gráficos/diagramas: describe qué muestran y transcribe cualquier texto/etiqueta visible.
- Fórmulas: transcribe en notación textual/LaTeX simple.
No agregues comentarios, opiniones ni texto que no esté en la página. Si una página
está en blanco, devuelve text vacío. Devuelve "page_number" como el número de página
DENTRO DE ESTE PDF (1 = primera página de este PDF, no del documento original).`;

/**
 * Envía un sub-PDF (ya recortado a solo las páginas que necesitan visión)
 * a Gemini y devuelve la transcripción estructurada de cada página.
 * `pageNumberMap[i]` traduce la página i+1 del sub-PDF al número de
 * página real dentro del documento original.
 */
export async function transcribePagesWithVision(
  subPdfBytes: Uint8Array,
  pageNumberMap: number[],
): Promise<VisionPageResult[]> {
  const base64 = Buffer.from(subPdfBytes).toString('base64');

  const result = await withGemini((ai) =>
    ai.models.generateContent({
      model: aiConfig.models.flash,
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType: 'application/pdf', data: base64 } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  );

  const raw = result.text;
  if (!raw) {
    const candidate = result.candidates?.[0];
    const details = {
      finishReason: candidate?.finishReason,
      promptFeedback: result.promptFeedback,
      safetyRatings: candidate?.safetyRatings,
    };
    throw new Error(
      `Gemini no devolvió contenido para la transcripción de páginas: ${JSON.stringify(details)}`,
    );
  }

  const parsed = JSON.parse(raw) as {
    pages: { page_number: number; content_type: ChunkContentType; text: string }[];
  };

  return parsed.pages.map((p) => ({
    pageNumber: pageNumberMap[p.page_number - 1] ?? p.page_number,
    contentType: p.content_type,
    text: p.text,
  }));
}

/**
 * Igual que transcribePagesWithVision, pero resiliente: si el lote falla
 * (p.ej. Gemini corta la respuesta con finishReason "RECITATION" -- pasa
 * con textos legales/normativos que coinciden demasiado con material de
 * entrenamiento), lo reintenta dividido en mitades más chicas en vez de
 * bloquear el documento entero. Si una sola página sigue fallando, se
 * marca como no transcribible y se sigue adelante -- nunca deja el
 * documento atascado para siempre por una página problemática.
 */
export async function transcribePagesRobust(
  originalPdfBytes: Uint8Array,
  pageNumbers: number[],
): Promise<VisionPageResult[]> {
  const subPdf = await extractPagesAsPdf(originalPdfBytes, pageNumbers);

  try {
    return await transcribePagesWithVision(subPdf, pageNumbers);
  } catch (err) {
    if (pageNumbers.length === 1) {
      const message = err instanceof Error ? err.message : String(err);
      return [
        {
          pageNumber: pageNumbers[0],
          contentType: 'text',
          text: `[No se pudo transcribir esta página automáticamente: ${message}]`,
        },
      ];
    }

    const mid = Math.ceil(pageNumbers.length / 2);
    const firstHalf = await transcribePagesRobust(originalPdfBytes, pageNumbers.slice(0, mid));
    const secondHalf = await transcribePagesRobust(originalPdfBytes, pageNumbers.slice(mid));
    return [...firstHalf, ...secondHalf];
  }
}
