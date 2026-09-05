// Función serverless de Vercel: dado un resumen de las columnas de la hoja
// del Análisis Estadístico y lo que la persona quiere averiguar (en texto
// libre), le pide a Gemini que sugiera cuál de las pruebas o gráficos ya
// disponibles en la propia sección usar — nunca un análisis que la
// herramienta no sepa hacer, porque el prompt sólo lista las que existen.
//
// Mismo patrón de claves, reintentos y tiempos que api/analisis-riesgo.js:
// varias GEMINI_API_KEY_N en variables de entorno, probadas en orden
// aleatorio, con casi todo el presupuesto de tiempo puesto en un solo
// intento en vez de repartirlo entre muchos.
//
// Sólo se manda el RESUMEN de cada columna (tipo, n, algún estadístico
// básico), nunca los datos de la hoja completos: ni hace falta para
// sugerir una prueba, ni tiene sentido mandar los datos de un análisis a
// un tercero cuando el resumen alcanza.

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
const PRESUPUESTO_TOTAL_MS = 25000;
const TIMEOUT_MAXIMO_POR_INTENTO_MS = 20000;
const MINIMO_PARA_INTENTAR_MS = 6000;
const MAX_COLUMNAS = 30;

// Las mismas pruebas y gráficos que ofrece el Asistente de análisis
// (AnalysisAssistant.jsx) — si se agrega una acción nueva ahí, hay que
// agregarla aquí también para que la IA la pueda sugerir.
const ACCIONES_DISPONIBLES = [
  { id: "descriptiva", descripcion: "Estadística descriptiva (media, mediana, desv. est., cuartiles) de una o más columnas numéricas." },
  { id: "histograma", descripcion: "Histograma con curva normal superpuesta, de una columna numérica — para ver la forma de la distribución." },
  { id: "boxplot", descripcion: "Diagrama de caja de una o más columnas numéricas — para comparar dispersión y ver valores atípicos." },
  { id: "dispersion", descripcion: "Diagrama de dispersión entre dos columnas numéricas (X e Y), opcionalmente coloreado por una tercera columna de grupo — para ver relación entre dos variables." },
  { id: "correlacion", descripcion: "Correlación de Pearson entre columnas numéricas — para cuantificar qué tan relacionadas están dos o más variables." },
  { id: "t1", descripcion: "Prueba t de una muestra — compara la media de una columna numérica contra un valor de referencia." },
  { id: "t2", descripcion: "Prueba t de dos muestras independientes — compara las medias de dos columnas numéricas distintas (dos procesos, dos máquinas, dos turnos)." },
  { id: "tpareada", descripcion: "Prueba t pareada — compara dos columnas medidas sobre los mismos sujetos (antes/después)." },
  { id: "varianzas", descripcion: "Prueba de varianzas (F) — compara si dos columnas numéricas tienen la misma variabilidad." },
  { id: "proporcion1", descripcion: "Prueba de proporción de una muestra — para una columna de texto con dos categorías (ej. Conforme/No conforme), compara la proporción observada contra un valor de referencia." },
  { id: "imr", descripcion: "Gráfica de control I-MR (individuos y rango móvil) — para monitorear un proceso con una medición por fila, sin agrupar en subgrupos." },
  { id: "xbarr", descripcion: "Gráfica de control Xbar-R — para monitorear un proceso agrupando las mediciones en subgrupos de tamaño fijo." },
  { id: "capacidad", descripcion: "Análisis de capacidad de proceso (Cp, Cpk, Pp, Ppk) — necesita límites de especificación (LEI/LES)." },
  { id: "gagerr", descripcion: "Gage R&R — analiza si un sistema de medición (varios operadores midiendo varias partes, varias veces cada uno) es confiable. Necesita datos en formato largo: columna de Parte, de Operador y de Medición." },
  { id: "crear_diseno", descripcion: "Crear un diseño factorial nuevo (2 a 5 factores) — genera una tabla de corridas en blanco para un experimento que todavía no se ha hecho, no para datos que ya existen." },
  { id: "analizar_factorial", descripcion: "Analizar un diseño factorial ya con resultados — calcula los efectos de cada factor y sus interacciones sobre una columna de respuesta." },
];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    accionId: { type: "string", enum: ACCIONES_DISPONIBLES.map((a) => a.id) },
    columnasSugeridas: { type: "array", items: { type: "string" }, description: "Nombres exactos de las columnas de la hoja que conviene usar, en el orden en que conviene elegirlas." },
    justificacion: { type: "string", description: "Explicación breve, en español, de por qué esa prueba o gráfico responde a lo que la persona pidió." },
  },
  required: ["accionId", "justificacion"],
};

function construirPrompt({ columnas, objetivo }) {
  const listaColumnas = columnas
    .map((c) => `- "${c.nombre}" (${c.tipo}): ${c.resumen}`)
    .join("\n");
  const listaAcciones = ACCIONES_DISPONIBLES.map((a) => `- ${a.id}: ${a.descripcion}`).join("\n");

  return `Eres un consultor de estadística aplicada ayudando a alguien a elegir qué análisis correr en una herramienta de software parecida a Minitab.

Columnas disponibles en la hoja de trabajo:
${listaColumnas}

Lo que la persona quiere averiguar (en sus propias palabras):
"${objetivo}"

Los únicos análisis que la herramienta sabe hacer son estos (no sugieras nada fuera de esta lista):
${listaAcciones}

Elige EXACTAMENTE UNO ("accionId") — el más adecuado para lo que pide, dadas las columnas que tiene disponibles. Si ninguno encaja perfectamente, elige el más cercano y dilo en la justificación. Sugiere también qué columnas de las de arriba usar, por su nombre exacto. Responde en español, con una justificación breve (2 a 3 frases), clara para alguien que no es estadístico.`;
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

  const { columnas, objetivo } = body || {};
  if (!Array.isArray(columnas) || columnas.length === 0 || !objetivo || !objetivo.trim()) {
    res.status(400).json({ error: "Faltan las columnas de la hoja o la descripción de qué quieres averiguar." });
    return;
  }

  const cuerpoPeticion = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: construirPrompt({ columnas: columnas.slice(0, MAX_COLUMNAS), objetivo: String(objetivo).slice(0, 2000) }) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,
    },
  });

  let ultimoError = null;
  const inicio = Date.now();

  for (const [i, clave] of claves.entries()) {
    const restante = PRESUPUESTO_TOTAL_MS - (Date.now() - inicio);
    if (restante < MINIMO_PARA_INTENTAR_MS) {
      res.status(504).json({
        error: `Gemini está respondiendo lento en este momento (se agotó el tiempo tras probar ${i} de ${claves.length} claves). Prueba de nuevo.`,
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

      let sugerencia;
      try {
        sugerencia = JSON.parse(texto);
      } catch {
        res.status(502).json({ error: "La respuesta de Gemini no fue un JSON válido." });
        return;
      }

      res.status(200).json(sugerencia);
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
