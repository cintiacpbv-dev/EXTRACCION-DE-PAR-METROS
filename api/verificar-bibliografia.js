// Función serverless de Vercel: puente entre el Análisis de Riesgo y la
// bibliografía (Consulta PDF, que es otra aplicación con su propia base de
// datos y sus propias claves).
//
// Va por el servidor y no directo desde el navegador por dos razones:
//
//   1. CORS. La API pública de Consulta PDF no promete permitir llamadas
//      desde otro dominio; entre servidores esa restricción no existe.
//   2. Formato. La respuesta del chat interno puede venir con distintos
//      nombres de campo; normalizarla en un solo sitio evita repartir ese
//      "adivinar la forma" por toda la aplicación.
//
// Lo importante: esto NUNCA debe romper el análisis de riesgo. Si la
// bibliografía no responde, responde raro, o no encuentra nada, se devuelve
// "no confirmado" y el borrador sigue su curso tal como venía trabajando.

const BASE = (process.env.CONSULTA_PDF_URL || "https://consulta-pdf.vercel.app").replace(/\/$/, "");

// La bibliografía responde con un RAG (busca en los PDF y luego redacta), así
// que cada pregunta tarda segundos, no milisegundos. Se piden varias a la vez
// para que verificar un cuadro entero no sea eterno, pero sin abrir tantas
// que la otra aplicación empiece a rechazar por saturación.
const EN_PARALELO = 4;

// La función tiene 60 s (ver vercel.json). Se corta antes para poder
// contestar con lo que sí se alcanzó a verificar, en vez de que Vercel mate
// la llamada y se pierda todo el lote.
const PRESUPUESTO_MS = 50000;
const TIMEOUT_POR_PREGUNTA_MS = 30000;

const MAX_PREGUNTAS = 12;

/** `fetch` con límite de tiempo: una pregunta lenta no debe comerse el
 *  presupuesto de todo el lote. */
async function fetchConLimite(url, opciones, timeoutMs) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opciones, signal: controlador.signal });
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Busca el texto de la respuesta dentro del cuerpo que devolvió Consulta PDF.
 *
 * Se prueban varios nombres porque la API pública devuelve "la misma
 * respuesta que usa el chat interno" y ese chat puede llamar a su campo de
 * texto de más de una forma. Si ninguno aparece, se devuelve cadena vacía y
 * quien llama lo trata como "no encontró información" — nunca como un error
 * que corte el análisis.
 */
function textoDeRespuesta(datos) {
  if (typeof datos === "string") return datos;
  if (!datos || typeof datos !== "object") return "";

  const directos = [
    datos.answer,
    datos.respuesta,
    datos.text,
    datos.content,
    datos.message,
    datos.output,
    datos.result,
    datos.data?.answer,
    datos.data?.respuesta,
    datos.data?.text,
  ];
  for (const valor of directos) {
    if (typeof valor === "string" && valor.trim()) return valor.trim();
  }

  // Algunas APIs de chat devuelven la respuesta como el último mensaje de una
  // conversación, no como un campo suelto.
  const mensajes = datos.messages || datos.mensajes;
  if (Array.isArray(mensajes) && mensajes.length > 0) {
    const ultimo = mensajes[mensajes.length - 1];
    const texto = ultimo?.content ?? ultimo?.text ?? ultimo?.contenido;
    if (typeof texto === "string" && texto.trim()) return texto.trim();
  }

  return "";
}

/**
 * Saca las citas (qué documento y en qué página respalda la respuesta).
 *
 * Son lo que de verdad importa aquí: una respuesta sin citas es la IA
 * hablando de memoria, y eso es justo lo que este cruce viene a evitar. Sin
 * citas verificadas, la fila se queda como estaba.
 */
function citasDeRespuesta(datos) {
  if (!datos || typeof datos !== "object") return [];

  const lista =
    datos.citations ||
    datos.citas ||
    datos.sources ||
    datos.fuentes ||
    datos.references ||
    datos.referencias ||
    datos.chunks ||
    datos.data?.citations ||
    datos.data?.citas ||
    [];

  if (!Array.isArray(lista)) return [];

  return lista
    .map((c) => {
      if (typeof c === "string") return { documento: c, pagina: "", fragmento: "" };
      if (!c || typeof c !== "object") return null;

      const documento =
        c.documentTitle ||
        c.document_title ||
        c.documento ||
        c.document ||
        c.title ||
        c.titulo ||
        c.fileName ||
        c.file_name ||
        c.nombre ||
        c.source ||
        "";

      const pagina = c.page ?? c.pagina ?? c.pageNumber ?? c.page_number ?? c.section ?? c.seccion ?? "";

      const fragmento = c.snippet || c.text || c.contenido || c.fragmento || c.quote || c.cita || "";

      if (!documento && !fragmento) return null;
      return {
        documento: String(documento).trim(),
        pagina: pagina === null || pagina === undefined ? "" : String(pagina).trim(),
        fragmento: String(fragmento).trim().slice(0, 400),
      };
    })
    .filter(Boolean);
}

/**
 * ¿La respuesta dice, en el fondo, "de esto no hay nada en los documentos"?
 *
 * Un RAG honesto contesta eso en vez de inventar, y esa respuesta no debe
 * escribirse en el cuadro como si fuera un respaldo. Se mira el texto además
 * de las citas porque a veces vienen citas de documentos que se consultaron
 * pero que no confirman nada.
 */
function diceQueNoEncontro(texto) {
  if (!texto) return true;
  const t = texto.toLowerCase();
  const negativas = [
    "no se encontr",
    "no encontr",
    "no hay informaci",
    "no dispongo de informaci",
    "no aparece en los documentos",
    "no se menciona",
    "no puedo responder",
    "no está en los documentos",
    "no esta en los documentos",
    "sin información suficiente",
    "sin informacion suficiente",
    "no contienen información",
    "no contienen informacion",
    "los documentos proporcionados no",
    "no se especifica en",
  ];
  return negativas.some((frase) => t.includes(frase));
}

/** Una pregunta contra la bibliografía, ya normalizada y sin excepciones:
 *  cualquier fallo se traduce a "no confirmado", con el motivo aparte. */
async function preguntar(pregunta, timeoutMs) {
  try {
    const respuesta = await fetchConLimite(
      `${BASE}/api/public/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: pregunta }),
      },
      timeoutMs
    );

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => "");
      return {
        confirmado: false,
        motivo: `La bibliografía respondió ${respuesta.status}. ${detalle.slice(0, 200)}`.trim(),
      };
    }

    const datos = await respuesta.json().catch(() => null);
    const texto = textoDeRespuesta(datos);
    const citas = citasDeRespuesta(datos);

    // Sin citas no hay corroboración: puede ser una respuesta redactada de
    // memoria, que es exactamente lo que no queremos escribir en el cuadro.
    if (citas.length === 0 || diceQueNoEncontro(texto)) {
      return {
        confirmado: false,
        motivo: "La bibliografía no trajo información que respalde esta fila.",
        // Cuando no se reconoció NADA de la respuesta, se devuelven las
        // claves que sí venían: es lo que permite ajustar el normalizador si
        // algún día la otra aplicación cambia los nombres de sus campos, sin
        // tener que adivinar a ciegas.
        formatoDesconocido:
          !texto && citas.length === 0 && datos && typeof datos === "object"
            ? Object.keys(datos).slice(0, 20)
            : undefined,
      };
    }

    return { confirmado: true, respuesta: texto, citas };
  } catch (err) {
    return {
      confirmado: false,
      motivo:
        err.name === "AbortError"
          ? "La bibliografía no respondió a tiempo."
          : `No se pudo consultar la bibliografía: ${err.message}`,
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido." });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Cuerpo de la petición inválido." });
    return;
  }

  const preguntas = Array.isArray(body?.preguntas) ? body.preguntas.slice(0, MAX_PREGUNTAS) : [];
  if (preguntas.length === 0) {
    res.status(400).json({ error: "Falta la lista de preguntas." });
    return;
  }

  const inicio = Date.now();
  const resultados = [];
  const pendientes = [];
  let siguiente = 0;

  // Cola con cupo fijo, igual que en el borrador de riesgo: cada trabajador
  // toma la siguiente pregunta libre. Lo que no alcance a entrar en el
  // presupuesto se devuelve como "pendiente" para que el navegador lo vuelva
  // a pedir en otra llamada, con su propio presupuesto entero.
  async function trabajador() {
    while (siguiente < preguntas.length) {
      const indice = siguiente++;
      const item = preguntas[indice];
      const restante = PRESUPUESTO_MS - (Date.now() - inicio);

      if (restante < 5000) {
        pendientes.push(item?.id);
        continue;
      }

      const salida = await preguntar(
        String(item?.pregunta || ""),
        Math.min(restante, TIMEOUT_POR_PREGUNTA_MS)
      );
      resultados.push({ id: item?.id, ...salida });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(EN_PARALELO, preguntas.length) }, trabajador)
  );

  res.status(200).json({ resultados, pendientes: pendientes.filter(Boolean) });
}
