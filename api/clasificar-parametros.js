// Función serverless de Vercel: relaciona cada parámetro de proceso con los
// atributos de calidad a los que afecta, y dice con qué fuerza.
//
// Es el ÚLTIMO recurso de la sección, no el primero. El orden es: lo que diga
// el protocolo, lo que se lea del propio registro, lo que responda la
// bibliografía (Consulta PDF) y, sólo para lo que ninguno de los tres
// resuelva, esto. Por eso la petición trae `evidencia`: lo que la
// bibliografía ya confirmó se le pasa para que construya encima en vez de
// contradecirlo, y para que no vuelva a razonar lo que ya está sustentado.
//
// La API key vive sólo aquí, en variables de entorno del servidor
// (GEMINI_API_KEY, GEMINI_API_KEY_2… configuradas en Vercel) — nunca llega al
// navegador. Si una clave se queda sin cuota, se prueba la siguiente sola.
//
// Lo que devuelve es un borrador para revisar y firmar, no un veredicto. La
// pantalla marca de qué fuente salió cada fila justamente para que quien
// valida sepa cuáles mirar con más cuidado.

function clavesDisponibles() {
  const claves = [
    process.env.GEMINI_API_KEY,
    ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  ].filter(Boolean);

  // Probarlas siempre en el mismo orden atasca todas las peticiones en la
  // primera cuando ésa anda lenta o sin cuota. Mezclar reparte la carga.
  for (let i = claves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [claves[i], claves[j]] = [claves[j], claves[i]];
  }
  return claves;
}

function vaLaPenaProbarOtraClave(status) {
  return status === 429 || status === 403 || status >= 500;
}

async function fetchConLimite(url, opciones, timeoutMs) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opciones, signal: controlador.signal });
  } finally {
    clearTimeout(temporizador);
  }
}

const MODELO = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Un registro de cápsula blanda deja 83 parámetros agrupados en sus tres
// etapas. Se mandan por lotes desde el navegador; este tope es el del lote.
const MAX_PARAMETROS = 40;

const PRESUPUESTO_TOTAL_MS = 55000;
const TIMEOUT_MAXIMO_POR_INTENTO_MS = 45000;
const MINIMO_PARA_INTENTAR_MS = 8000;

const IMPACTOS = ["alto", "medio", "bajo"];

const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "El id del parámetro tal cual se recibió." },
      afecta: {
        type: "array",
        description:
          "Los atributos de calidad a los que este parámetro afecta. Vacío si no afecta a ninguno de la lista.",
        items: {
          type: "object",
          properties: {
            atributo: { type: "string", description: "El nombre del atributo, copiado de la lista recibida." },
            impacto: { type: "string", enum: IMPACTOS },
            justificacion: {
              type: "string",
              description: "Una frase: por qué mecanismo ese parámetro mueve ese atributo.",
            },
          },
          required: ["atributo", "impacto", "justificacion"],
        },
      },
      critico: {
        type: "boolean",
        description:
          "true si es Parámetro Crítico de Proceso (PCP): su variación dentro del rango de operación afecta de forma apreciable a un atributo crítico de calidad.",
      },
      justificacion: { type: "string", description: "Por qué es o no es crítico, en una o dos frases." },
    },
    required: ["id", "afecta", "critico", "justificacion"],
  },
};

function construirPrompt({ producto, forma, etapa, parametros, atributos, evidencia }) {
  const listaParametros = parametros
    .map(
      (p) =>
        `- id ${p.id} · [${p.seccion || "GENERAL"}] ${p.magnitud}${
          p.criterios?.length ? ` — criterio en el registro: ${p.criterios.join(" ; ")}` : " — sin criterio impreso"
        }`
    )
    .join("\n");

  const listaAtributos = atributos
    .map((a) => `- ${a.nombre}${a.criterio ? ` (criterio: ${a.criterio})` : ""}${a.etapa ? ` [${a.etapa}]` : ""}`)
    .join("\n");

  const respaldos = (evidencia || [])
    .filter((e) => e?.texto)
    .map((e) => `- Sobre ${e.magnitud}: ${String(e.texto).slice(0, 600)}`)
    .join("\n");

  return `Eres un especialista en validación de procesos farmacéuticos aplicando ICH Q8 (Quality by Design).

Producto: ${producto}
${forma ? `Forma farmacéutica: ${forma}\n` : ""}Etapa del proceso: ${etapa}

ATRIBUTOS DE CALIDAD que este proceso mide (salen del propio registro de manufactura y del protocolo, con el criterio de aceptación que les imprime):
${listaAtributos || "(no se reconoció ninguno; usa los atributos habituales de esta forma farmacéutica y nómbralos tú)"}

PARÁMETROS DE PROCESO a clasificar:
${listaParametros}
${respaldos ? `\nLo que la bibliografía consultada ya respalda, para que construyas sobre ello y no lo contradigas:\n${respaldos}\n` : ""}
Para CADA parámetro de la lista, y usando su id exactamente como se te dio:

1. Di a qué atributos de la lista afecta. Usa los nombres de la lista, tal cual. Un parámetro puede afectar a varios, a uno o a ninguno — si no afecta a ninguno, devuelve "afecta" vacío en vez de forzar una relación.
2. Para cada atributo que toque, el impacto: "alto" si moverlo dentro de su rango de operación cambia el atributo de forma apreciable o puede sacarlo de especificación; "medio" si lo mueve pero el proceso lo absorbe; "bajo" si la relación existe pero es marginal.
3. Di si es Parámetro Crítico de Proceso (PCP): lo es cuando su variación afecta de forma apreciable a un atributo crítico de calidad. Un parámetro con un impacto "alto" sobre un atributo con criterio de aceptación normalmente lo es; uno que sólo tiene impactos "bajo" normalmente no.
4. Justifica por el MECANISMO, no por la fórmula: di qué le pasa al producto, no "porque es importante". Por ejemplo: "la temperatura de la masa de gelatina gobierna su viscosidad, y con ella el espesor de la cinta que forma la pared de la cápsula".

Sé conservador: no inventes relaciones para llenar el cuadro. Un parámetro de condiciones ambientales de la sala no afecta a todos los atributos por el hecho de estar ahí. Responde en español, en el tono de un especialista de aseguramiento de calidad.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido." });
    return;
  }

  const claves = clavesDisponibles();
  if (claves.length === 0) {
    res.status(500).json({
      error:
        "No hay ninguna GEMINI_API_KEY configurada en el servidor. Agrégala en Vercel → Settings → Environment Variables y vuelve a desplegar.",
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

  const { producto, forma, etapa, parametros, atributos, evidencia } = body || {};
  if (!producto || !Array.isArray(parametros) || parametros.length === 0) {
    res.status(400).json({ error: "Faltan el producto o la lista de parámetros." });
    return;
  }

  const recortados = parametros.slice(0, MAX_PARAMETROS);
  const cuerpoPeticion = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: construirPrompt({
              producto,
              forma,
              etapa: etapa || "no indicada",
              parametros: recortados,
              atributos: atributos || [],
              evidencia,
            }),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      // Baja: aquí no se quiere redacción variada sino la misma lectura
      // técnica ante el mismo registro.
      temperature: 0.2,
    },
  });

  let ultimoError = null;
  const inicio = Date.now();

  for (const [i, clave] of claves.entries()) {
    const restante = PRESUPUESTO_TOTAL_MS - (Date.now() - inicio);
    if (restante < MINIMO_PARA_INTENTAR_MS) {
      res.status(504).json({
        error: `Gemini está respondiendo lento en este momento (se agotó el tiempo tras probar ${i} de ${claves.length} claves). Vuelve a pedir la clasificación y seguirá por donde iba.`,
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

      res.status(200).json({ filas: Array.isArray(filas) ? filas : [] });
      return;
    } catch (err) {
      ultimoError =
        err.name === "AbortError"
          ? `Gemini no respondió en ${Math.round(Math.min(restante, TIMEOUT_MAXIMO_POR_INTENTO_MS) / 1000)}s.`
          : `No se pudo llamar a Gemini: ${err.message}`;
    }
  }

  res.status(502).json({ error: ultimoError || "Ninguna de las claves configuradas funcionó." });
}
