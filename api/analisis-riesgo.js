// Función serverless de Vercel: recibe los parámetros críticos ya
// extraídos de un producto/etapa y le pide a Gemini un borrador de AMFE
// (Modo de fallo, Efecto, Causa, Controles, y una Severidad/Ocurrencia/
// Detección sugeridas) por cada uno.
//
// La API key vive sólo aquí, en variables de entorno del servidor
// (GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3… configuradas en
// Vercel) — nunca llega al navegador, así que no hay forma de robarla
// inspeccionando el sitio publicado. Si una clave se queda sin cuota, se
// prueba la siguiente sola, sin que quien usa el panel note nada.
//
// El borrador es sólo eso: un punto de partida para que quien valida lo
// revise, corrija y firme. Ninguna fila se exporta sin que alguien la haya
// visto en el panel antes de bajar el Excel.

/**
 * Las claves configuradas, en orden aleatorio.
 *
 * Probarlas siempre en el mismo orden (1, 2, 3…) significa que, si la
 * primera anda lenta o sin cuota justo ahora, TODAS las peticiones se
 * atascan ahí antes de llegar a una que sí sirve — y como cada intento
 * puede tardar bastante (Gemini no siempre responde rápido), no alcanza el
 * tiempo para llegar muy lejos en la lista. Mezclar el orden reparte la
 * carga entre las seis en vez de machacar siempre a la misma primero.
 */
function clavesDisponibles() {
  const claves = [
    process.env.GEMINI_API_KEY,
    ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  ].filter(Boolean);

  for (let i = claves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [claves[i], claves[j]] = [claves[j], claves[i]];
  }
  return claves;
}

/** Sin cuota, clave rechazada, o un error transitorio del propio Gemini:
 * en los tres casos vale la pena probar con otra clave. */
function vaLaPenaProbarOtraClave(status) {
  return status === 429 || status === 403 || status >= 500;
}

/** `fetch` con límite de tiempo: una clave que no responde no debe comerse
 * todo el presupuesto de la función — se corta y se prueba la siguiente. */
async function fetchConLimite(url, opciones, timeoutMs) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opciones, signal: controlador.signal });
  } finally {
    clearTimeout(temporizador);
  }
}

// Configurable por variable de entorno (GEMINI_MODEL) porque Google retira
// modelos sin avisar —"gemini-2.5-flash" dejó de estar disponible para
// cuentas nuevas de un día para otro—; así el nombre se actualiza en Vercel
// sin tener que tocar ni volver a desplegar el código.
const MODELO = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const MAX_PARAMETROS = 80; // una llamada, no una por parámetro — y con límite, por costo.

// La función tiene 60 s (vercel.json). Probado en producción: incluso con
// pocos parámetros, dos intentos seguidos de 25 s cada uno se quedaron sin
// responder — Gemini puede tardar bastante más de lo que tarda en el caso
// normal (~3 s por parámetro), así que cortar corto y probar muchas claves
// en fila dentro de la misma llamada sólo reparte el mismo presupuesto en
// intentos cada vez más chicos, ninguno con margen real para terminar. Mejor
// darle a un intento casi todo el tiempo disponible, y que el reintento (ver
// analizarConGemini.js, que ya reintenta una vez) caiga en una llamada
// nueva —con su propio presupuesto entero— probablemente con otra clave.
const PRESUPUESTO_TOTAL_MS = 55000;
const TIMEOUT_MAXIMO_POR_INTENTO_MS = 45000;
const MINIMO_PARA_INTENTAR_MS = 8000;

const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      parametro: { type: "string", description: "La etiqueta del parámetro que originó esta fila, tal cual se recibió." },
      actividad: { type: "string" },
      modoFallo: { type: "string" },
      efecto: { type: "string" },
      severidad: { type: "integer", minimum: 1, maximum: 5 },
      causa: { type: "string" },
      ocurrencia: { type: "integer", minimum: 1, maximum: 5 },
      controles: { type: "string" },
      deteccion: { type: "integer", minimum: 1, maximum: 5 },
      accionesATomar: { type: "string" },
    },
    required: [
      "parametro",
      "actividad",
      "modoFallo",
      "efecto",
      "severidad",
      "causa",
      "ocurrencia",
      "controles",
      "deteccion",
      "accionesATomar",
    ],
  },
};

function construirPrompt({ producto, etapa, parametros }) {
  const lista = parametros
    .map((p, i) => `${i + 1}. [${p.seccion || "GENERAL"}] ${p.label}${p.setpoint ? ` — criterio: ${p.setpoint}` : ""}${p.unit ? ` ${p.unit}` : ""}`)
    .join("\n");

  return `Eres un especialista en gestión de riesgos de calidad (QRM) de la industria farmacéutica, aplicando la metodología AMFE (Análisis de Modos de Fallo y Efectos) según ICH Q9.

Producto: ${producto}
Etapa del proceso: ${etapa}

A continuación una lista de parámetros críticos de proceso, extraídos del Registro de Manufactura de esta etapa, con su criterio de aceptación cuando lo hay:

${lista}

Para cada parámetro de la lista, propone UNA fila de AMFE: un modo de fallo plausible y específico a ese parámetro (no genérico), su efecto sobre la calidad del producto, una causa raíz razonable, los controles que normalmente existirían en un proceso de manufactura farmacéutica validado, y una acción de mitigación sugerida. Asigna Severidad, Ocurrencia y Detección (1 a 5 cada una, según la escala estándar de AMFE: 1=mínimo, 5=máximo) de forma realista y conservadora — no asignes valores altos sin justificación en el modo de fallo.

Responde en español, en un tono técnico y profesional, como lo escribiría un especialista de aseguramiento de calidad. Sé específico al parámetro, no repitas el mismo texto genérico en todas las filas.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido." });
    return;
  }

  const claves = clavesDisponibles();
  if (claves.length === 0) {
    res.status(500).json({
      error: "No hay ninguna GEMINI_API_KEY configurada en el servidor. Agrégala en Vercel → Settings → Environment Variables y vuelve a desplegar.",
    });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Cuerpo de la petición inválido." });
    return;
  }

  const { producto, etapa, parametros } = body || {};
  if (!producto || !etapa || !Array.isArray(parametros) || parametros.length === 0) {
    res.status(400).json({ error: "Faltan producto, etapa o la lista de parámetros." });
    return;
  }

  const recortados = parametros.slice(0, MAX_PARAMETROS);
  const cuerpoPeticion = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: construirPrompt({ producto, etapa, parametros: recortados }) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.4,
    },
  });

  let ultimoError = null;
  const inicio = Date.now();

  for (const [i, clave] of claves.entries()) {
    const restante = PRESUPUESTO_TOTAL_MS - (Date.now() - inicio);
    if (restante < MINIMO_PARA_INTENTAR_MS) {
      res.status(504).json({
        error: `Gemini está respondiendo lento en este momento (se agotó el tiempo tras probar ${i} de ${claves.length} claves). Probablemente funcione si generas el borrador de nuevo.`,
      });
      return;
    }

    try {
      const respuesta = await fetchConLimite(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${clave}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpoPeticion },
        Math.min(restante, TIMEOUT_MAXIMO_POR_INTENTO_MS)
      );

      if (!respuesta.ok) {
        const detalle = await respuesta.text().catch(() => "");
        ultimoError = `Gemini respondió con error (${respuesta.status}): ${detalle.slice(0, 300)}`;
        // Sin cuota, clave rechazada, o error transitorio del propio Gemini:
        // se prueba la siguiente clave, si queda tiempo y hay otra. Un error
        // de petición mal formada no mejora probando otra clave.
        if (vaLaPenaProbarOtraClave(respuesta.status) && i < claves.length - 1) continue;
        res.status(502).json({ error: ultimoError });
        return;
      }

      const datos = await respuesta.json();
      const texto = datos?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!texto) {
        res.status(502).json({ error: "Gemini no devolvió contenido utilizable." });
        return;
      }

      let filas;
      try {
        filas = JSON.parse(texto);
      } catch {
        res.status(502).json({ error: "La respuesta de Gemini no fue un JSON válido." });
        return;
      }

      res.status(200).json({ filas });
      return;
    } catch (err) {
      // Un aborto por tiempo no descarta la clave para siempre, sólo dice
      // que ahora mismo tardó de más: se prueba la siguiente si queda
      // tiempo, sin más aviso que dejarlo en ultimoError por si ninguna
      // responde a tiempo.
      ultimoError =
        err.name === "AbortError"
          ? `Gemini no respondió en ${Math.round(Math.min(restante, TIMEOUT_MAXIMO_POR_INTENTO_MS) / 1000)}s.`
          : `No se pudo llamar a Gemini: ${err.message}`;
    }
  }

  res.status(502).json({ error: ultimoError || "Ninguna de las claves configuradas funcionó." });
}
