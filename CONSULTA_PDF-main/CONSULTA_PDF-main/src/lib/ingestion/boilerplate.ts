import type { PageForChunking } from './chunking';

const LINE_THRESHOLD_RATIO = 0.35;
const LINE_THRESHOLD_MIN = 3;
const PREFIX_WORD_COUNT = 5;
const MIN_PREFIX_CHARS = 12;

/**
 * Detecta y elimina texto repetitivo (marcas de agua, licencias,
 * encabezados/pies de página) que aparece en una fracción alta de las
 * páginas del documento. Esto no aporta información -- solo ensucia los
 * chunks y desperdicia contexto/tokens en cada consulta.
 *
 * Dos pasadas, porque en la práctica (verificado con un PDF real
 * "watermarked") la marca de agua no siempre es una línea completa
 * repetida: a veces queda pegada como PREFIJO de una línea que termina
 * en contenido real distinto, porque pdfjs agrupa el texto del watermark
 * y el texto del cuerpo en la misma "línea" cuando coinciden en altura.
 *
 * 1) Líneas completas idénticas (o casi, tolerando que un número de
 *    página al final/inicio cambie) que aparecen en muchas páginas.
 * 2) Prefijos de línea (primeras N palabras) que se repiten en muchas
 *    páginas aunque el resto de la línea varíe -- se recorta solo el
 *    prefijo, conservando el contenido real que le sigue.
 */
export function stripBoilerplate(pages: PageForChunking[]): PageForChunking[] {
  if (pages.length < 3) return pages;

  const threshold = Math.max(LINE_THRESHOLD_MIN, Math.ceil(pages.length * LINE_THRESHOLD_RATIO));

  const afterFullLines = stripRepeatedFullLines(pages, threshold);
  return stripRepeatedPrefixes(afterFullLines, threshold);
}

function stripRepeatedFullLines(pages: PageForChunking[], threshold: number): PageForChunking[] {
  const pagesPerLine = new Map<string, Set<number>>();

  for (const page of pages) {
    const lines = new Set(
      page.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length >= 3),
    );
    for (const line of lines) {
      const key = normalizeLine(line);
      if (!pagesPerLine.has(key)) pagesPerLine.set(key, new Set());
      pagesPerLine.get(key)!.add(page.pageNumber);
    }
  }

  const boilerplateKeys = new Set(
    [...pagesPerLine.entries()].filter(([, pageSet]) => pageSet.size >= threshold).map(([key]) => key),
  );
  if (boilerplateKeys.size === 0) return pages;

  return pages.map((page) => ({
    ...page,
    text: page.text
      .split('\n')
      .filter((line) => !boilerplateKeys.has(normalizeLine(line.trim())))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }));
}

function stripRepeatedPrefixes(pages: PageForChunking[], threshold: number): PageForChunking[] {
  const pagesPerPrefix = new Map<string, Set<number>>();

  for (const page of pages) {
    const lines = page.text.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const prefix = firstWords(line, PREFIX_WORD_COUNT);
      if (prefix.length < MIN_PREFIX_CHARS) continue;
      const key = normalizeLine(prefix);
      if (!pagesPerPrefix.has(key)) pagesPerPrefix.set(key, new Set());
      pagesPerPrefix.get(key)!.add(page.pageNumber);
    }
  }

  const boilerplatePrefixes = new Set(
    [...pagesPerPrefix.entries()].filter(([, pageSet]) => pageSet.size >= threshold).map(([key]) => key),
  );
  if (boilerplatePrefixes.size === 0) return pages;

  return pages.map((page) => ({
    ...page,
    text: page.text
      .split('\n')
      .map((rawLine) => {
        const line = rawLine.trim();
        const prefix = firstWords(line, PREFIX_WORD_COUNT);
        if (prefix.length < MIN_PREFIX_CHARS) return rawLine;
        if (!boilerplatePrefixes.has(normalizeLine(prefix))) return rawLine;
        const remainder = line.slice(prefix.length).trim();
        return remainder.length >= 3 ? remainder : '';
      })
      .filter((l) => l.length > 0)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }));
}

/** Primeras `n` palabras de la línea, preservando el texto exacto (para poder recortarlo por longitud). */
function firstWords(line: string, n: number): string {
  const match = line.match(new RegExp(`^(?:\\S+\\s+){0,${n - 1}}\\S+`));
  return match ? match[0] : line;
}

/** Quita un número de página al final o al principio de la línea, si lo hay. */
function normalizeLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(page|página|pag\.?)\s*\d+\s*$/i, '$1')
    .replace(/^\s*\d+\s+/, '')
    .replace(/\s*[-–—]?\s*\d+\s*$/, '')
    .trim();
}
