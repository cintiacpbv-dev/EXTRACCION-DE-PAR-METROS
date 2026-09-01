/**
 * Punto único de configuración de modelos Gemini. Cambiar de modelo
 * (o de proveedor en el futuro) no debe requerir tocar la lógica de negocio.
 */
export const aiConfig = {
  /**
   * Lista de API keys de Google AI, en orden de preferencia. Soporta
   * GOOGLE_AI_API_KEY + GOOGLE_AI_API_KEY_2, _3, _4... (numeradas en
   * secuencia, sin límite) para poder rotar automáticamente a la
   * siguiente cuando una se queda sin cuota -- ver withGemini() en
   * gemini.ts.
   */
  apiKeys: (): string[] => {
    const keys: string[] = [];
    if (process.env.GOOGLE_AI_API_KEY) keys.push(process.env.GOOGLE_AI_API_KEY);
    for (let i = 2; ; i++) {
      const key = process.env[`GOOGLE_AI_API_KEY_${i}`];
      if (!key) break;
      keys.push(key);
    }
    if (keys.length === 0) {
      throw new Error('Falta la variable de entorno GOOGLE_AI_API_KEY');
    }
    return keys;
  },
  models: {
    flash: process.env.GEMINI_MODEL_FLASH ?? 'gemini-3.6-flash',
    // Sin tier "pro" estable disponible para esta API key a agosto 2026
    // (gemini-2.5-pro descontinuado para keys nuevas, Gemini 3 pro sigue
    // en preview) -- se usa flash también aquí hasta que haya uno.
    pro: process.env.GEMINI_MODEL_PRO ?? 'gemini-3.6-flash',
    embedding: process.env.GEMINI_MODEL_EMBEDDING ?? 'gemini-embedding-001',
  },
  embeddingDimensions: 1536,
} as const;
