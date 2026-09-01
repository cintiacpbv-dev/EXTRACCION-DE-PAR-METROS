import { createCanvas } from '@napi-rs/canvas';
import { openPdf } from './pdf-reader';

const TARGET_WIDTH = 400;
/** Fracción de píxeles casi-blancos por encima de la cual se considera "en blanco". */
const BLANK_THRESHOLD_RATIO = 0.98;
const NEAR_WHITE_CHANNEL_VALUE = 245;

/**
 * Renderiza la primera página del PDF como una miniatura PNG. Nunca
 * lanza -- si algo falla (PDF corrupto, página sin contenido renderizable,
 * etc.), devuelve null y el documento simplemente se muestra con el
 * ícono genérico en vez de carátula.
 *
 * Si la página 1 sale prácticamente en blanco (portadas genéricas,
 * separadores, escaneos con la primera hoja vacía), se intenta traer en
 * su lugar una imagen referencial de Wikipedia buscando por el título
 * del documento -- mejor una imagen aproximada del tema que una
 * carátula completamente vacía.
 */
export async function renderCoverImage(
  pdfBytes: Uint8Array,
  documentTitle?: string,
): Promise<Buffer | null> {
  try {
    const pdf = await openPdf(pdfBytes);
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = TARGET_WIDTH / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext('2d');

    // @napi-rs/canvas es compatible en tiempo de ejecución con la API de
    // canvas del DOM que pdfjs espera, pero no comparte los mismos tipos
    // de TypeScript.
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
    }).promise;

    page.cleanup();

    if (isMostlyBlank(context, canvas.width, canvas.height) && documentTitle) {
      const wikipediaImage = await findWikipediaImage(documentTitle);
      if (wikipediaImage) return wikipediaImage;
    }

    return canvas.toBuffer('image/png');
  } catch {
    return null;
  }
}

function isMostlyBlank(
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  width: number,
  height: number,
): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  let whitePixels = 0;
  let sampledPixels = 0;

  // Muestrea 1 de cada 4 píxeles (RGBA = 4 bytes por píxel) para no
  // recorrer la imagen entera -- de sobra para una detección confiable.
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sampledPixels++;
    if (r >= NEAR_WHITE_CHANNEL_VALUE && g >= NEAR_WHITE_CHANNEL_VALUE && b >= NEAR_WHITE_CHANNEL_VALUE) {
      whitePixels++;
    }
  }

  if (sampledPixels === 0) return false;
  return whitePixels / sampledPixels >= BLANK_THRESHOLD_RATIO;
}

// Wikimedia bloquea con 403 ("Please honor our robot policy") los
// User-Agent con un contacto que parezca un placeholder genérico (se
// verificó en la práctica: "contacto: no-reply@example.com" lo activaba,
// una URL real identificable no). https://wikitech.wikimedia.org/wiki/Robot_policy
const WIKIPEDIA_USER_AGENT = 'ConsultaATuPDF/1.0 (https://github.com/carlosj31z/CONSULTA_PDF)';

/**
 * Busca en Wikipedia (en español) una página relacionada con el título
 * dado y devuelve su imagen principal, si tiene una. No requiere API key
 * -- es la API pública de Wikimedia. Nunca lanza: si no encuentra nada,
 * hay algún error de red, o la página no tiene imagen, devuelve null y
 * el documento se queda con la carátula en blanco (o el ícono genérico).
 */
async function findWikipediaImage(query: string): Promise<Buffer | null> {
  try {
    const searchUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query,
    )}&format=json&srlimit=1&origin=*`;
    const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': WIKIPEDIA_USER_AGENT } });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const title = searchData?.query?.search?.[0]?.title;
    if (!title) return null;

    const summaryRes = await fetch(
      `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { 'User-Agent': WIKIPEDIA_USER_AGENT } },
    );
    if (!summaryRes.ok) return null;
    const summary = await summaryRes.json();
    const imageUrl: string | undefined = summary?.thumbnail?.source;
    if (!imageUrl) return null;

    const imageRes = await fetch(imageUrl, { headers: { 'User-Agent': WIKIPEDIA_USER_AGENT } });
    if (!imageRes.ok) return null;
    return Buffer.from(await imageRes.arrayBuffer());
  } catch {
    return null;
  }
}
