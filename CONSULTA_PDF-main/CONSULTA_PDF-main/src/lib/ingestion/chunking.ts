import { createHash } from 'node:crypto';
import type { ChunkContentType } from '@/types/database';

export interface PageForChunking {
  pageNumber: number;
  text: string;
  /** Tipo de contenido detectado por visión, si la página se procesó así. */
  contentTypeHint?: ChunkContentType;
}

export interface ChunkDraft {
  pageStart: number;
  pageEnd: number;
  chapter: string | null;
  section: string | null;
  contentType: ChunkContentType;
  position: number;
  content: string;
  contentHash: string;
  tokenCount: number;
}

const CHAPTER_RE = /^(cap[ií]tulo|chapter|parte|part)\s+([0-9]+|[ivxlcdm]+)\b.*/i;
const SECTION_RE = /^(secci[oó]n|section)\s+([0-9]+(\.[0-9]+)*)\b.*/i;

const TARGET_TOKENS = 600;
const MAX_TOKENS = 900;
/**
 * Un chunk por debajo de esto casi siempre es solo un título suelto: no
 * sirve para responder y contamina la búsqueda. Se fusiona con el
 * siguiente en vez de indexarse por separado.
 */
const MIN_CHUNK_CHARS = 200;

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (CHAPTER_RE.test(trimmed) || SECTION_RE.test(trimmed)) return true;
  const letters = trimmed.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase();
}

interface Block {
  pageNumber: number;
  contentTypeHint?: ChunkContentType;
  kind: 'heading' | 'paragraph';
  text: string;
  chapter: string | null;
  section: string | null;
}

function splitIntoBlocks(pages: PageForChunking[]): Block[] {
  const blocks: Block[] = [];
  let currentChapter: string | null = null;
  let currentSection: string | null = null;
  let paragraphBuffer: string[] = [];

  const flushParagraph = (pageNumber: number, contentTypeHint?: ChunkContentType) => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').replace(/\s+/g, ' ').trim();
    paragraphBuffer = [];
    if (!text) return;
    blocks.push({
      pageNumber,
      contentTypeHint,
      kind: 'paragraph',
      text,
      chapter: currentChapter,
      section: currentSection,
    });
  };

  for (const page of pages) {
    const lines = page.text.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flushParagraph(page.pageNumber, page.contentTypeHint);
        continue;
      }
      if (looksLikeHeading(line)) {
        flushParagraph(page.pageNumber, page.contentTypeHint);
        if (CHAPTER_RE.test(line)) {
          currentChapter = line;
          currentSection = null;
        } else if (SECTION_RE.test(line)) {
          currentSection = line;
        } else {
          currentSection = line;
        }
        blocks.push({
          pageNumber: page.pageNumber,
          contentTypeHint: page.contentTypeHint,
          kind: 'heading',
          text: line,
          chapter: currentChapter,
          section: currentSection,
        });
        continue;
      }
      paragraphBuffer.push(line);
    }
    flushParagraph(page.pageNumber, page.contentTypeHint);
  }

  return blocks;
}

function resolveContentType(blocks: Block[]): ChunkContentType {
  // La ausencia de pista (páginas con texto nativo) cuenta como 'text',
  // no se descarta -- si no, un chunk con 9 bloques de texto normal y 1
  // bloque de una página-imagen quedaría mal etiquetado como 'image'.
  const types = new Set(blocks.map((b) => b.contentTypeHint ?? 'text'));
  if (types.size === 1) return [...types][0];
  return 'mixed';
}

/**
 * Agrupa bloques (párrafos/encabezados) en chunks semánticos: nunca corta
 * un párrafo a la mitad, y abre un chunk nuevo al cambiar de
 * capítulo/sección -- pero solo si lo acumulado ya tiene contenido real.
 *
 * Los documentos reales (manuales, normativas) tienen muchas líneas en
 * MAYÚSCULAS seguidas: portadas, índices, encabezados de sección. Cada
 * una se detecta como encabezado y cambia la "sección" actual, así que
 * sin el mínimo de abajo cada título terminaba en su propio chunk
 * diminuto ("VALIDACION", "PROCESS VALIDATION"). Esos chunks son basura
 * para responder pero ganaban la búsqueda vectorial -- un chunk de dos
 * palabras idénticas a la pregunta tiene similitud altísima -- y
 * desplazaban al contenido real. Verificado en producción: el 5% de los
 * chunks tenía menos de 60 caracteres y copaban los primeros puestos.
 */
export function chunkPages(pages: PageForChunking[]): ChunkDraft[] {
  const blocks = splitIntoBlocks(pages).filter((b) => b.kind === 'paragraph' || b.text.length > 0);
  const chunks: ChunkDraft[] = [];

  let current: Block[] = [];
  let currentTokens = 0;
  let position = 0;

  const flush = () => {
    if (current.length === 0) return;
    const content = current.map((b) => b.text).join('\n\n');
    const pageNumbers = current.map((b) => b.pageNumber);
    chunks.push({
      pageStart: Math.min(...pageNumbers),
      pageEnd: Math.max(...pageNumbers),
      chapter: current[current.length - 1].chapter,
      section: current[current.length - 1].section,
      contentType: resolveContentType(current),
      position: position++,
      content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      tokenCount: estimateTokens(content),
    });
    current = [];
    currentTokens = 0;
  };

  let lastChapter: string | null = null;
  let lastSection: string | null = null;

  for (const block of blocks) {
    const currentChars = current.reduce((sum, b) => sum + b.text.length, 0);
    // Un cambio de sección solo corta si lo acumulado ya es un chunk
    // útil; si no, el encabezado se queda junto al contenido que le sigue.
    const boundaryChanged =
      current.length > 0 &&
      currentChars >= MIN_CHUNK_CHARS &&
      (block.chapter !== lastChapter || block.section !== lastSection);
    const blockTokens = estimateTokens(block.text);

    if (boundaryChanged || (currentTokens + blockTokens > MAX_TOKENS && current.length > 0)) {
      flush();
    }

    current.push(block);
    currentTokens += blockTokens;
    lastChapter = block.chapter;
    lastSection = block.section;

    if (currentTokens >= TARGET_TOKENS) {
      flush();
      lastChapter = null;
      lastSection = null;
    }
  }
  flush();

  return mergeTinyChunks(chunks);
}

/**
 * Red de seguridad: fusiona cualquier chunk que quedó por debajo del
 * mínimo con el siguiente (o con el anterior, si era el último). Así se
 * garantiza que ningún título suelto llegue al índice, sin importar cómo
 * venga estructurado el documento.
 */
function mergeTinyChunks(chunks: ChunkDraft[]): ChunkDraft[] {
  if (chunks.length <= 1) return chunks;

  const merged: ChunkDraft[] = [];
  let pending: ChunkDraft | null = null;

  for (const chunk of chunks) {
    const combined: ChunkDraft = pending ? joinChunks(pending, chunk) : chunk;
    if (combined.content.trim().length < MIN_CHUNK_CHARS) {
      pending = combined;
      continue;
    }
    merged.push(combined);
    pending = null;
  }

  // Sobró un chunk diminuto al final: se pega al último ya emitido.
  if (pending) {
    if (merged.length > 0) {
      merged[merged.length - 1] = joinChunks(merged[merged.length - 1], pending);
    } else {
      merged.push(pending);
    }
  }

  return merged.map((c, i) => ({ ...c, position: i }));
}

function joinChunks(a: ChunkDraft, b: ChunkDraft): ChunkDraft {
  const content = `${a.content}\n\n${b.content}`;
  return {
    pageStart: Math.min(a.pageStart, b.pageStart),
    pageEnd: Math.max(a.pageEnd, b.pageEnd),
    // Se conserva la ubicación del bloque con contenido real (el segundo).
    chapter: b.chapter ?? a.chapter,
    section: b.section ?? a.section,
    contentType: a.contentType === b.contentType ? a.contentType : 'mixed',
    position: a.position,
    content,
    contentHash: createHash('sha256').update(content).digest('hex'),
    tokenCount: a.tokenCount + b.tokenCount,
  };
}
