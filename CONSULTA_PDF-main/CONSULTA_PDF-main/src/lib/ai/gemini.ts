import { GoogleGenAI } from '@google/genai';
import { aiConfig } from './config';

let clients: GoogleGenAI[] | null = null;
/** Índice de la última key que funcionó -- las siguientes llamadas empiezan ahí. */
let preferredIndex = 0;

function getClients(): GoogleGenAI[] {
  if (!clients) {
    clients = aiConfig.apiKeys().map((apiKey) => new GoogleGenAI({ apiKey }));
  }
  return clients;
}

function isQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('"code":429') ||
    message.includes('rateLimitExceeded')
  );
}

/**
 * 503/UNAVAILABLE: el modelo está saturado, no es culpa de la key. Rotar
 * no sirve (todas apuntan al mismo modelo), pero suele resolverse en
 * segundos, así que conviene esperar y reintentar en vez de fallar de
 * inmediato -- visto en producción: un 503 tumbaba la consulta entera.
 */
function isOverloadedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('UNAVAILABLE') || message.includes('"code":503');
}

const OVERLOAD_RETRIES = 2;
const OVERLOAD_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ejecuta una llamada a Gemini con rotación automática entre las API keys
 * configuradas: si la key en uso agota su cuota (429/RESOURCE_EXHAUSTED),
 * reintenta con la siguiente. Si el modelo está saturado (503), espera y
 * reintenta un par de veces. Recuerda cuál key funcionó por última vez
 * para no volver a probar las agotadas en cada llamada.
 */
export async function withGemini<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const all = getClients();
  let lastError: unknown;

  for (let i = 0; i < all.length; i++) {
    const index = (preferredIndex + i) % all.length;

    for (let attempt = 0; attempt <= OVERLOAD_RETRIES; attempt++) {
      try {
        const result = await fn(all[index]);
        preferredIndex = index;
        return result;
      } catch (err) {
        lastError = err;
        if (isOverloadedError(err) && attempt < OVERLOAD_RETRIES) {
          await sleep(OVERLOAD_DELAY_MS * (attempt + 1));
          continue;
        }
        break;
      }
    }

    // Solo tiene sentido pasar a otra key si la actual se quedó sin cuota.
    if (!isQuotaError(lastError)) throw lastError;
  }

  throw lastError;
}

export { aiConfig };
