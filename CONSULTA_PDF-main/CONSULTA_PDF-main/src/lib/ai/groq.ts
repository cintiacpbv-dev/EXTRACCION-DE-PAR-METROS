import Groq from 'groq-sdk';

let client: Groq | null = null;

/**
 * Modelos de respaldo en orden de preferencia. Se prueba el siguiente si
 * uno falla -- Groq descontinúa modelos sin aviso (llama-3.3-70b-versatile
 * dejó de existir de un día para otro y tumbó todo el respaldo justo
 * cuando Gemini estaba caído). Con varios en cascada, que se retire uno
 * ya no deja la app sin alternativa.
 */
export const GROQ_FALLBACK_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.6-27b',
] as const;

export const groqConfig = {
  /** GROQ_MODEL fuerza uno concreto; si no, se recorre la lista de arriba. */
  models: (): string[] => {
    const preferred = process.env.GROQ_MODEL;
    if (!preferred) return [...GROQ_FALLBACK_MODELS];
    return [preferred, ...GROQ_FALLBACK_MODELS.filter((m) => m !== preferred)];
  },
  isConfigured: () => Boolean(process.env.GROQ_API_KEY),
};

/**
 * Cliente Groq: respaldo de ÚLTIMO recurso, solo para generar texto
 * (la respuesta del chat sobre contexto ya recuperado). Groq no ofrece
 * modelos de embeddings ni comprensión nativa de PDF -- no reemplaza a
 * Gemini para ingesta (OCR/embeddings), solo cubre la generación de
 * respuestas cuando todas las API keys de Gemini fallan.
 */
export function getGroqClient(): Groq {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('Falta la variable de entorno GROQ_API_KEY');
    client = new Groq({ apiKey });
  }
  return client;
}
