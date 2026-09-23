// Función serverless de Vercel: los dos pasos del Procedimiento de Evaluación
// de Criticidad que necesitan criterio, no cálculo.
//
//   tarea "severidad" → Paso 1: qué tan grave sería que cada ATRIBUTO fallara,
//                       de 1 a 5, usando la matriz Severidad × Incertidumbre.
//   tarea "screening" → Paso 2: por cada PARÁMETRO, si hay sospecha de vínculo
//                       con algún atributo, con cuál, y de dónde sale la sospecha.
//   tarea "fmea"      → Paso 4: Probabilidad y Detectabilidad de los parámetros
//                       YA declarados Críticos, para priorizar entre ellos.
//
// Los pasos 3 y 5 NO pasan por aquí: la clasificación, el NPR y el vínculo
// estadístico son reglas deterministas (ver lib/criticidad/modelo.js) y
// pedírselas a un modelo sólo añadiría una forma de que salgan mal. La IA se
// usa donde hace falta juicio y nada más.
//
// Y el Paso 4 no decide nada: la clasificación ya está cerrada cuando se
// llega aquí. P y D sirven para ordenar el trabajo entre los Críticos y para
// diseñar su control, no para ascender ni degradar a ninguno.
//
// La API key vive sólo aquí, en variables de entorno del servidor
// (GEMINI_API_KEY, GEMINI_API_KEY_2… configuradas en Vercel) — nunca llega al
// navegador. Si una clave se queda sin cuota, se prueba la siguiente sola.
//
// Lo que devuelve es un borrador para revisar y firmar. En la severidad eso
// importa especialmente: es la pieza que decide toda la clasificación, así
// que una severidad revisada a mano nunca vuelve a ser pisada por el modelo.

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
const MAX_ATRIBUTOS = 40;
const MAX_PARAMETROS = 40;
const PRESUPUESTO_TOTAL_MS = 55000;
const TIMEOUT_MAXIMO_POR_INTENTO_MS = 45000;
const MINIMO_PARA_INTENTAR_MS = 8000;

const ESQUEMA_SEVERIDAD = {
  type: "array",
  items: {
    type: "object",
    properties: {
      atributo: { type: "string", description: "El nombre del atributo, copiado tal cual se recibió." },
      severidad: { type: "integer", minimum: 1, maximum: 5 },
      decision: {
        type: "string",
        description: "CQA, Atributo de Calidad (no crítico), o No CQA.",
        enum: ["CQA", "Atributo de Calidad (no crítico)", "No CQA"],
      },
      justificacion: { type: "string", description: "Una o dos frases: por qué esa severidad, nombrando la consecuencia." },
    },
    required: ["atributo", "severidad", "decision", "justificacion"],
  },
};

const ESQUEMA_SCREENING = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "El id del parámetro tal cual se recibió." },
      sospecha: {
        type: "boolean",
        description: "true si hay sospecha de que este parámetro afecte a algún atributo de la lista.",
      },
      afecta: {
        type: "array",
        description: "Los atributos afectados, con su nombre copiado de la lista. Vacío si no hay sospecha.",
        items: { type: "string" },
      },
      origen: {
        type: "string",
        description: "De dónde sale la sospecha: el mecanismo físico o químico, en una frase.",
      },
      desempeno: {
        type: "boolean",
        description:
          "La pregunta de desempeño de proceso: ¿este parámetro afecta al rendimiento, al tiempo de operación o a la consistencia del proceso? Se responde SIEMPRE, haya sospecha o no.",
      },
      desempenoMotivo: { type: "string", description: "Por qué sí o por qué no, en una frase corta." },
    },
    required: ["id", "sospecha", "afecta", "origen", "desempeno", "desempenoMotivo"],
  },
};

const ESQUEMA_FMEA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string", description: "El id del parámetro tal cual se recibió." },
      probabilidad: { type: "integer", minimum: 1, maximum: 5 },
      detectabilidad: { type: "integer", minimum: 1, maximum: 5 },
      racional: {
        type: "string",
        description: "Por qué esa Probabilidad y esa Detectabilidad, nombrando el control que existe.",
      },
    },
    required: ["id", "probabilidad", "detectabilidad", "racional"],
  },
};

const MATRIZ = `Matriz de apoyo — Severidad × Incertidumbre (adaptada de PDA TR60, Fig. 6.1-2).
Cruza el tipo de impacto si el atributo falla con lo bien conocida que esté esa relación:

| Tipo de impacto si el atributo falla | Incertidumbre baja | Incertidumbre alta |
| Riesgo directo a seguridad del paciente o eficacia | 5 | 5 |
| Vínculo directo hacia una consecuencia grave, mitigado por controles aguas abajo | 4 | 5 |
| Vínculo indirecto (varios pasos causales) o atributo redefinido más angosto por redundancia | 3 | 4 |
| Atributo cosmético con posible correlación funcional | 2 | 3 |
| Atributo puramente estético, sin correlación funcional | 1 | 2 |

No saber es, a efectos de riesgo, peor que saber: la incertidumbre alta sube la severidad un punto. Ante la duda, se sube la severidad como principio de precaución.

Para ubicar cada atributo en la matriz:
- Tipo de vínculo hacia una consecuencia grave: ¿es de tolerancia cero, directo con límite tolerable, indirecto, cosmético con correlación funcional, o puramente estético?
- Distingue el vínculo DIRECTO del INDIRECTO: si es directo, la severidad es alta; si es indirecto, media o baja.
- Considera la vía de administración, el margen terapéutico del principio activo y la población de pacientes objetivo: el mismo atributo no pesa igual en un inyectable que en una crema.`;

function promptSeveridad({ producto, forma, atributos }) {
  const lista = atributos
    .map((a) => `- ${a.nombre}${a.criterio ? ` (criterio: ${a.criterio})` : ""}${a.etapa ? ` [se mide en ${a.etapa}]` : ""}`)
    .join("\n");

  return `Eres un especialista en validación de procesos farmacéuticos aplicando ICH Q9(R1) 2023 y PDA TR60.

Producto: ${producto}
${forma ? `Forma farmacéutica: ${forma}\n` : ""}
Estás en el Paso 1 del Procedimiento de Evaluación de Criticidad y Riesgo: fijar la SEVERIDAD de cada atributo de calidad. Una sola pregunta por atributo: ¿qué tan grave sería que ese atributo fallara? Se contesta de forma INDEPENDIENTE de cualquier parámetro de proceso — no importa aquí qué lo podría causar ni con qué frecuencia, sólo el daño si ocurre.

${MATRIZ}

Preguntas guía, para que dos evaluadores den lo mismo:
1 — ¿Una variación prácticamente no tendría consecuencia para el paciente ni para el desempeño del producto?
2 — ¿Tendría una consecuencia limitada y reversible, sin afectar seguridad ni eficacia?
3 — ¿Existe una posibilidad razonable de que afecte el desempeño, por una vía indirecta?
4 — ¿Podría afectar significativamente un atributo de calidad, aunque existan controles aguas abajo?
5 — ¿Podría comprometer directamente la seguridad del paciente o la eficacia del medicamento?

ATRIBUTOS A CALIFICAR:
${lista}

Para cada uno devuelve su severidad (1-5), su decisión (CQA cuando la variación puede afectar seguridad, eficacia o calidad; "Atributo de Calidad (no crítico)" cuando es un atributo real pero sin ese alcance; "No CQA" cuando es puramente estético o de conveniencia) y una justificación que nombre la CONSECUENCIA concreta, no la importancia genérica.

Ten presente el umbral que viene después: sólo severidad 4 o 5 puede producir un Parámetro Crítico de Proceso. Sé conservador y coherente: un atributo de farmacopea con tolerancia casi nula (esterilidad, endotoxinas, uniformidad de dosis) es 5; uno cosmético sin correlación funcional es 1 o 2. Responde en español.`;
}

function promptScreening({ producto, forma, etapa, parametros, atributos }) {
  const listaParametros = parametros
    .map(
      (p) =>
        `- id ${p.id} · [${p.seccion || "GENERAL"}] ${p.magnitud}${
          p.criterios?.length ? ` — criterio en el registro: ${p.criterios.join(" ; ")}` : " — sin criterio impreso"
        }`
    )
    .join("\n");

  const listaAtributos = atributos.map((a) => `- ${a.nombre}${a.severidad ? ` (severidad ${a.severidad})` : ""}`).join("\n");

  return `Eres un especialista en validación de procesos farmacéuticos aplicando ICH Q9(R1) 2023 y PDA TR60.

Producto: ${producto}
${forma ? `Forma farmacéutica: ${forma}\n` : ""}Etapa del proceso: ${etapa}

Estás en el Paso 2 del Procedimiento de Evaluación de Criticidad y Riesgo: el análisis causa-efecto, que es un SCREENING. Por cada parámetro de proceso hay que responder sólo tres cosas: (1) ¿hay sospecha de vínculo con algún atributo de calidad, sí o no?, (2) ¿con cuál o cuáles?, (3) ¿de dónde sale esa sospecha?

Importante: aquí NO se evalúa la gravedad, ni la probabilidad, ni la detectabilidad. Sólo si existe sospecha de vínculo. La gravedad ya está fijada por atributo en el Paso 1, y la clasificación se decide después con una regla, no con tu criterio.

ATRIBUTOS DE CALIDAD de este producto:
${listaAtributos || "(no se reconoció ninguno)"}

PARÁMETROS DE PROCESO de esta etapa:
${listaParametros}

Para cada parámetro, usando su id exactamente como se te dio:
- "sospecha": true sólo si hay un mecanismo físico o químico plausible por el que ese parámetro mueva un atributo de la lista. "No hay riesgo; se requiere para continuar con el proceso" es una respuesta legítima y frecuente — muchos parámetros son operativos y no tocan ningún atributo.
- "afecta": los nombres de la lista, copiados tal cual. Vacío si no hay sospecha.
- "origen": el mecanismo, en una frase. Por ejemplo: "la temperatura de la masa gobierna su viscosidad, y con ella el espesor de la pared de la cápsula". No escribas "es importante" ni "podría afectar la calidad".

Además, y SIEMPRE —tenga sospecha o no—, responde la pregunta de desempeño de proceso en "desempeno": ¿este parámetro afecta al rendimiento del lote, al tiempo de operación o a la consistencia del proceso? Es una pregunta distinta de la anterior: no habla de la calidad del producto sino de si el proceso sale adelante. Un enfriamiento que sólo sirve para poder continuar afecta al TIEMPO y por tanto al desempeño; un parámetro meramente informativo no afecta a nada. Esta respuesta es la que decide entre "Clave" y "No Clave" para los parámetros que no llegan a Críticos, y «No Clave» es un resultado correcto y frecuente.

Dos parámetros que compartan el mismo mecanismo —el tiempo y la velocidad de una misma agitación— deben recibir el mismo "afecta" y el mismo "origen": la separación en filas no crea dos causalidades distintas.

Sé conservador: no inventes vínculos para llenar el cuadro. Responde en español.`;
}

function promptFmea({ producto, forma, parametros }) {
  const lista = parametros
    .map(
      (p) =>
        `- id ${p.id} · [${p.etapa} / ${p.seccion || "GENERAL"}] ${p.magnitud}` +
        `${p.criterios?.length ? ` — criterio: ${p.criterios.join(" ; ")}` : " — sin criterio impreso"}` +
        `${p.afecta?.length ? ` — afecta a: ${p.afecta.join(", ")} (severidad ${p.severidad})` : ""}`
    )
    .join("\n");

  return `Eres un especialista en validación de procesos farmacéuticos aplicando ICH Q9(R1) 2023 y PDA TR60.

Producto: ${producto}
${forma ? `Forma farmacéutica: ${forma}\n` : ""}
Estás en el Paso 4 del Procedimiento de Evaluación de Criticidad y Riesgo. Los parámetros de abajo YA están declarados Críticos: eso no se discute aquí y tu respuesta no puede cambiarlo. Lo que se documenta ahora es Probabilidad y Detectabilidad, para dos cosas: priorizar entre los Críticos mediante el NPR, y diseñar la estrategia de control de cada uno.

OCURRENCIA / PROBABILIDAD (P) — según las desviaciones y no conformidades registradas asociadas al parámetro:
5 Muy alta — ha ocurrido más de tres veces en el último año; rango de control estrecho respecto a la variabilidad natural del proceso/equipo, sin historial de control robusto
4 Alta — ha ocurrido tres veces en el último año; rango moderadamente estrecho, desviaciones registradas en productos o procesos análogos
3 Moderada — ha ocurrido dos veces en el último año; control demostrado pero sin amplio margen, requiere monitoreo activo
2 Baja — ha ocurrido sólo una vez en el último año; rango amplio respecto a la variabilidad esperada, control demostrado en plataforma similar
1 Muy baja — no ha ocurrido en el último año; parámetro fácilmente controlado, automatizado, o con rango muy amplio ya demostrado

DETECTABILIDAD (D) — en qué parte de la secuencia de validación se detecta:
5 No puede ser detectado — durante el mantenimiento del estado validado; sin control en línea, se detecta sólo en análisis de producto terminado, si acaso
4 Baja detectabilidad — durante la elaboración del reporte de validación; detección fuera de línea, tras el lote, con retraso significativo
3 Moderadamente detectable — durante la ejecución de los lotes de validación; muestreo en proceso a intervalos definidos
2 Detectable — durante la elaboración del protocolo de validación; monitoreo en línea frecuente con alarmas y/o alertas
1 Muy detectable — durante las revisiones previas a la elaboración del protocolo; control continuo automatizado (PAT / control en tiempo real)

IMPORTANTE: tú NO conoces el historial de desviaciones de esta planta, que es el primer criterio de la Ocurrencia. Califícala por el segundo —el ancho del rango frente a la variabilidad esperada— y dilo en el racional con estas palabras: "Ocurrencia propuesta por el rango; confirmar con el historial de desviaciones del último año." Quien valida la corregirá con el dato real.

PARÁMETROS CRÍTICOS:
${lista}

Criterio de calificación: la Probabilidad no se asume alta sólo porque la confirmación sea analítica, ni baja sólo porque haya monitoreo visual. Úsala para el ancho del rango frente a la variabilidad esperada. En la Detectabilidad, lo que manda es CUÁNDO se entera alguien: un parámetro que se lee en el panel del equipo durante el proceso no es lo mismo que uno que sólo se ve en el análisis del producto terminado.

Si el criterio impreso en el registro es amplio ("no menos de 10 minutos", "informativo"), eso es señal de Probabilidad baja: hay margen. Si es estrecho ("70 °C ± 2 °C"), de Probabilidad media o alta.

En el racional, nombra el control que existe. Responde en español.`;
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

  const { tarea, producto, forma, etapa, atributos = [], parametros = [] } = body || {};
  if (!producto) {
    res.status(400).json({ error: "Falta el producto." });
    return;
  }

  let prompt;
  let esquema;

  if (tarea === "severidad") {
    if (atributos.length === 0) {
      res.status(400).json({ error: "Falta la lista de atributos de calidad." });
      return;
    }
    prompt = promptSeveridad({ producto, forma, atributos: atributos.slice(0, MAX_ATRIBUTOS) });
    esquema = ESQUEMA_SEVERIDAD;
  } else if (tarea === "screening") {
    if (parametros.length === 0) {
      res.status(400).json({ error: "Falta la lista de parámetros." });
      return;
    }
    prompt = promptScreening({
      producto,
      forma,
      etapa: etapa || "no indicada",
      parametros: parametros.slice(0, MAX_PARAMETROS),
      atributos,
    });
    esquema = ESQUEMA_SCREENING;
  } else if (tarea === "fmea") {
    if (parametros.length === 0) {
      res.status(400).json({ error: "Falta la lista de parámetros críticos." });
      return;
    }
    prompt = promptFmea({ producto, forma, parametros: parametros.slice(0, MAX_PARAMETROS) });
    esquema = ESQUEMA_FMEA;
  } else {
    res.status(400).json({ error: 'La tarea debe ser "severidad", "screening" o "fmea".' });
    return;
  }

  const cuerpoPeticion = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: esquema,
      // Muy baja: en una evaluación de criticidad lo que se quiere es la
      // misma lectura ante el mismo documento, no redacción variada.
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

      let filas;
      try {
        filas = JSON.parse(texto);
      } catch {
        res.status(502).json({ error: "La respuesta de Gemini no fue un JSON válido." });
        return;
      }

      res.status(200).json({ tarea, filas: Array.isArray(filas) ? filas : [] });
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
