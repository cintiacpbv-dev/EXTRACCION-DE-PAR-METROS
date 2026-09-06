// Cruce del borrador de AMFE contra la bibliografía (Consulta PDF).
//
// El borrador que redacta Gemini es plausible, pero plausible no es lo mismo
// que sustentado: quien firma un análisis de riesgo necesita poder señalar
// DE DÓNDE sale cada modo de fallo y cada control. Aquí cada fila ya
// redactada se le pregunta a la bibliografía, y si ésta la respalda con
// citas verificadas, esas citas se escriben en "Documentos relacionados"
// —la columna que ya existe en el cuadro y ya se exporta al Excel.
//
// Regla de oro: esto sólo AGREGA. Si la bibliografía no responde, no
// encuentra nada, o contesta algo que no se entiende, la fila se queda
// exactamente como la dejó Gemini y el análisis sigue como se venía
// trabajando. Nunca borra ni reescribe lo redactado.

// Cuántas filas se mandan en cada llamada al endpoint propio. El servidor las
// reparte entre varias preguntas en paralelo dentro de su presupuesto de
// tiempo; lotes chicos hacen que las citas se vayan viendo pronto en la
// pantalla en vez de todas juntas al final.
const TAMANO_LOTE = 6;

/** Recorta un texto largo: la pregunta debe caber cómoda, y el RAG busca
 *  mejor con lo esencial que con párrafos enteros. */
function recortar(texto, maximo) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo)}…` : limpio;
}

/**
 * La pregunta que se le hace a la bibliografía por una fila del cuadro.
 *
 * Se pide explícitamente que diga cuándo NO hay información: un RAG al que no
 * se le da esa salida tiende a redactar algo igual, y una cita inventada en
 * un análisis de riesgo es peor que una casilla vacía.
 */
export function preguntaDeFila(fila, { producto, etapa }) {
  const partes = [
    `Producto: ${producto || "no indicado"}.`,
    `Etapa del proceso: ${fila.proceso || etapa || "no indicada"}.`,
    fila.actividad ? `Actividad/parámetro: ${recortar(fila.actividad, 160)}.` : "",
    fila.modoFallo ? `Modo de fallo propuesto: ${recortar(fila.modoFallo, 300)}.` : "",
    fila.efecto ? `Efecto propuesto: ${recortar(fila.efecto, 220)}.` : "",
    fila.causa ? `Causa propuesta: ${recortar(fila.causa, 220)}.` : "",
    fila.controles ? `Controles propuestos: ${recortar(fila.controles, 260)}.` : "",
  ].filter(Boolean);

  return (
    `${partes.join(" ")}\n\n` +
    "En un análisis de riesgo de calidad (AMFE, ICH Q9) se propuso lo anterior. " +
    "Según los documentos disponibles, ¿este modo de fallo, su causa y esos controles están respaldados? " +
    "Cita el documento y la sección o página que lo sustenta. " +
    "Si en los documentos no hay información sobre esto, dilo claramente y no propongas nada por tu cuenta."
  );
}

/**
 * Cómo queda una cita escrita en la casilla "Documentos relacionados".
 *
 * Formato corto y legible por una persona que revisa el cuadro impreso: el
 * documento y, cuando la hay, la página o sección. Sin el fragmento completo,
 * que haría la celda ilegible en el Excel.
 */
function citaComoTexto(cita) {
  const documento = cita.documento || "Documento sin nombre";
  return cita.pagina ? `${documento} (p. ${cita.pagina})` : documento;
}

/**
 * Junta las citas de una fila en una sola línea, sin repetir el mismo
 * documento dos veces y con un tope: tres referencias ya dicen de dónde sale,
 * quince sólo llenan la celda.
 */
export function citasComoTexto(citas) {
  const vistas = new Set();
  const textos = [];
  for (const cita of citas || []) {
    const texto = citaComoTexto(cita);
    if (vistas.has(texto)) continue;
    vistas.add(texto);
    textos.push(texto);
    if (textos.length >= 3) break;
  }
  return textos.join(" · ");
}

async function pedirLote(preguntas) {
  const respuesta = await fetch("/api/verificar-bibliografia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preguntas }),
  });

  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new Error(cuerpo?.error || `El servidor respondió ${respuesta.status}.`);
  }
  return {
    resultados: Array.isArray(cuerpo?.resultados) ? cuerpo.resultados : [],
    pendientes: Array.isArray(cuerpo?.pendientes) ? cuerpo.pendientes : [],
  };
}

function partir(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

/**
 * Verifica contra la bibliografía las filas ya redactadas.
 *
 * `onFila({ id, documentos, respuesta })` se llama por cada fila CONFIRMADA,
 * apenas llega su respuesta, para que las citas se vayan pintando en el
 * cuadro en vez de aparecer todas al final. Las filas sin respaldo no llaman
 * a nada: se quedan como estaban, que es justo el comportamiento de siempre.
 *
 * `onAvance(hechas, total)` sirve para el rótulo de progreso.
 *
 * Devuelve un resumen — cuántas se confirmaron, cuántas no, y el primer
 * motivo de fallo si la bibliografía entera falló (para poder avisar que el
 * cruce no se pudo hacer, sin ensuciar el cuadro).
 */
export async function verificarFilasConBibliografia(filas, { producto, etapa, onFila, onAvance, debeSeguir } = {}) {
  const candidatas = (filas || []).filter((f) => f && (f.modoFallo || f.causa || f.controles));
  const total = candidatas.length;

  let confirmadas = 0;
  let sinRespaldo = 0;
  let hechas = 0;
  let motivoFallo = "";
  let formatoDesconocido = null;

  const lotes = partir(candidatas, TAMANO_LOTE);

  for (const lote of lotes) {
    if (debeSeguir && !debeSeguir()) break;

    const preguntas = lote.map((f) => ({ id: f.id, pregunta: preguntaDeFila(f, { producto, etapa }) }));

    let salida;
    try {
      salida = await pedirLote(preguntas);
    } catch (e) {
      // La bibliografía no está disponible: se anota el motivo una sola vez y
      // se sigue con el resto del cuadro tal cual. No es un error del
      // análisis, es una corroboración que esta vez no se pudo hacer.
      motivoFallo = motivoFallo || e.message;
      hechas += lote.length;
      sinRespaldo += lote.length;
      onAvance?.(hechas, total);
      continue;
    }

    // Lo que el servidor no alcanzó a preguntar dentro de su tiempo se pide
    // otra vez, una sola: si vuelve a no dar tiempo, esas filas se quedan sin
    // cruzar y el cuadro sigue igualmente.
    let resultados = salida.resultados;
    if (salida.pendientes.length > 0) {
      const reintento = preguntas.filter((p) => salida.pendientes.includes(p.id));
      try {
        const segunda = await pedirLote(reintento);
        resultados = [...resultados, ...segunda.resultados];
      } catch {
        // Se ignora: cuentan como sin respaldo, más abajo.
      }
    }

    const porId = new Map(resultados.map((r) => [r.id, r]));

    for (const fila of lote) {
      const resultado = porId.get(fila.id);
      hechas += 1;

      if (!resultado?.confirmado) {
        sinRespaldo += 1;
        if (!motivoFallo && resultado?.motivo) motivoFallo = resultado.motivo;
        if (!formatoDesconocido && resultado?.formatoDesconocido) {
          formatoDesconocido = resultado.formatoDesconocido;
        }
        continue;
      }

      const texto = citasComoTexto(resultado.citas);
      if (!texto) {
        sinRespaldo += 1;
        continue;
      }

      confirmadas += 1;
      onFila?.({ id: fila.id, documentos: texto, respuesta: resultado.respuesta });
    }

    onAvance?.(hechas, total);
  }

  return { total, confirmadas, sinRespaldo, motivoFallo, formatoDesconocido };
}
