// Función serverless de Vercel: recibe las lecturas que el detector NO supo
// clasificar como parámetros de proceso en un registro de manufactura, y le
// pide a Gemini que diga cuáles lo son de verdad y con qué palabra se las
// reconoce.
//
// Para qué. El detector reconoce una magnitud por su nombre, con una lista
// escrita a mano que sirve para lo que la planta ya fabrica. Cuando entra un
// producto de otra familia —un inyectable estéril donde antes sólo había
// sólidos orales— sus magnitudes no están en esa lista y sus lecturas caen en
// el montón de "otros", que no se muestra. Hasta ahora eso se arreglaba
// editando el código. Esta función es la que lo arregla sola: lo que devuelve
// se guarda en Supabase (tabla vocabulario_parametros) y vale desde entonces
// para todos los registros parecidos y para todos los equipos.
//
// La API key vive sólo aquí, en variables de entorno del servidor
// (GEMINI_API_KEY, GEMINI_API_KEY_2… configuradas en Vercel) — nunca llega al
// navegador. Si una clave se queda sin cuota, se prueba la siguiente sola.
//
// Lo que propone es un candidato, no un hecho: cada término queda guardado con
// el producto, la receta, la etapa y la etiqueta exacta de la que salió, para
// que quien valida pueda revisarlo y borrarlo desde el panel. Y sólo puede
// SUMAR: un término aprendido asciende una lectura que hoy queda escondida en
// "otros", y no puede quitar ni cambiar nada de lo que ya se detectaba.

/**
 * Las claves configuradas, en orden aleatorio.
 *
 * Probarlas siempre en el mismo orden significa que, si la primera anda lenta
 * o sin cuota justo ahora, todas las peticiones se atascan ahí antes de llegar
 * a una que sí sirve. Mezclar el orden reparte la carga.
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

/** Sin cuota, clave rechazada, o un error transitorio del propio Gemini: en
 * los tres casos vale la pena probar con otra clave. */
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

// Configurable por variable de entorno porque Google retira modelos sin
// avisar; así el nombre se actualiza en Vercel sin volver a desplegar.
const MODELO = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Un registro deja entre 6 y 35 lecturas sin clasificar (medido sobre los
// registros reales de fabricación, envase, acondicionado y una crema). El
// tope es para el caso raro de un documento muy largo, no para el normal.
const MAX_CANDIDATOS = 120;

// Esta llamada ocurre una sola vez por receta y etapa, y nadie la está
// esperando mirando la pantalla: se lanza en segundo plano después de cargar
// el registro. Aun así se le pone techo, por el mismo motivo que a las demás.
const PRESUPUESTO_TOTAL_MS = 55000;
const TIMEOUT_MAXIMO_POR_INTENTO_MS = 45000;
const MINIMO_PARA_INTENTAR_MS = 8000;

const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      etiqueta: {
        type: "string",
        description: "La etiqueta de la lista que originó este término, copiada tal cual se recibió.",
      },
      termino: {
        type: "string",
        description:
          "El nombre de la MAGNITUD medida, en singular y sin el equipo ni el número de paso: para 'TEMPERATURA DE MOLDEO DEL CUERPO' el término es 'TEMPERATURA DE MOLDEO'.",
      },
      motivo: {
        type: "string",
        description: "Una frase corta: qué se mide y por qué afecta a la calidad del producto.",
      },
    },
    required: ["etiqueta", "termino", "motivo"],
  },
};

function construirPrompt({ producto, etapa, candidatos, conocidos }) {
  const lista = candidatos
    .map(
      (c, i) =>
        `${i + 1}. [${c.seccion || "GENERAL"}] ${c.label}${c.value ? ` = ${c.value}` : ""}${
          c.unit ? ` ${c.unit}` : ""
        }`
    )
    .join("\n");

  const yaSabidas = (conocidos || []).slice(0, 60).join(", ");

  return `Eres un especialista en validación de procesos farmacéuticos que está leyendo un Registro de Manufactura (RMD).

Producto: ${producto}
Etapa del proceso: ${etapa}

Un detector automático ya separó del registro las lecturas que reconoce como parámetros de proceso. Abajo están las que NO reconoció: quedaron sueltas porque el nombre de su magnitud no está en su vocabulario. Cada línea es una etiqueta del registro con el valor anotado al lado.

${lista}

Tu tarea es decir CUÁLES de esas líneas son de verdad un parámetro de proceso —una magnitud física, química o de operación que se mide o se ajusta durante la fabricación y que puede afectar la calidad del producto— y con qué palabra se reconoce esa magnitud.

NO son parámetros de proceso, y hay que dejarlas fuera:
- códigos de equipo, de sala, de máquina o de instrumento;
- números de lote, de orden, de análisis, de material o de documento;
- nombres de personas, firmas, cargos, fechas y horas;
- cantidades de material dispensado o de envases entregados, que son trazabilidad;
- instrucciones del procedimiento sin una lectura anotada;
- cualquier línea de la que no estés seguro. Es preferible dejar fuera un parámetro real que meter basura en el vocabulario.

${yaSabidas ? `El detector YA reconoce estas magnitudes, así que NO las repitas: ${yaSabidas}.\n\n` : ""}Para el campo "termino" da el nombre de la magnitud sola, sin el equipo, sin el número de paso y sin el valor: si la etiqueta es "TEMPERATURA DE LA MASA EN EL TANQUE 3", el término es "TEMPERATURA DE LA MASA". Debe tener al menos cuatro letras y ser una palabra o frase que aparecería igual en otro registro del mismo tipo de producto.

Si ninguna línea es un parámetro de proceso, responde con una lista vacía. Responde en español.`;
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

  const { producto, etapa, candidatos, conocidos } = body || {};
  if (!producto || !etapa || !Array.isArray(candidatos) || candidatos.length === 0) {
    res.status(400).json({ error: "Faltan producto, etapa o la lista de lecturas sin clasificar." });
    return;
  }

  const recortados = candidatos.slice(0, MAX_CANDIDATOS);
  const cuerpoPeticion = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: construirPrompt({ producto, etapa, candidatos: recortados, conocidos }) }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      // Más baja que en el borrador de AMFE a propósito: aquí no se quiere
      // redacción variada sino la misma respuesta ante el mismo registro.
      temperature: 0.1,
    },
  });

  let ultimoError = null;
  const inicio = Date.now();

  for (const [i, clave] of claves.entries()) {
    const restante = PRESUPUESTO_TOTAL_MS - (Date.now() - inicio);
    if (restante < MINIMO_PARA_INTENTAR_MS) {
      res.status(504).json({
        error: `Gemini está respondiendo lento en este momento (se agotó el tiempo tras probar ${i} de ${claves.length} claves).`,
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

      let terminos;
      try {
        terminos = JSON.parse(texto);
      } catch {
        res.status(502).json({ error: "La respuesta de Gemini no fue un JSON válido." });
        return;
      }

      res.status(200).json({ terminos: Array.isArray(terminos) ? terminos : [] });
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
