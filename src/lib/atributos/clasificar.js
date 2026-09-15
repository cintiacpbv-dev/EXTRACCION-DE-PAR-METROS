// Clasificar cada parámetro de proceso: a qué atributos de calidad afecta,
// con qué impacto, y si eso lo convierte en Parámetro Crítico de Proceso.
//
// El orden de las fuentes es lo que hace que esto valga para un expediente,
// y va de más sustentado a menos:
//
//   1. EL REGISTRO. Si el propio registro le imprime un criterio de
//      aceptación al parámetro, el documento ya está diciendo que eso se
//      mantiene. Eso no se le pregunta a nadie: se lee.
//   2. EL PROTOCOLO, cuando se sube. Es la fuente de los atributos reales del
//      producto, con sus especificaciones.
//   3. LA BIBLIOGRAFÍA (Consulta PDF). Se le pregunta por cada parámetro, y
//      si responde CON CITAS, esa es la relación y queda con su referencia.
//   4. LA IA. Sólo para lo que los tres anteriores no resolvieron, y se le
//      pasa lo que la bibliografía sí confirmó para que construya encima.
//
// Cada fila del cuadro dice de cuál de las cuatro salió. Esa es la mejora que
// pedía la evaluación: no es lo mismo una relación que está impresa en el
// registro que una que redactó un modelo, y quien firma tiene que poder
// distinguirlas de un vistazo.

import { porRelevancia, separarLecturas } from "./modelo.js";

// Cuántos parámetros se le preguntan a la bibliografía de una vez. El
// servidor los reparte en preguntas paralelas dentro de su presupuesto; lotes
// chicos hacen que las respuestas se vean llegar en vez de todas al final.
const LOTE_BIBLIOGRAFIA = 6;

// Y cuántos van en cada llamada a la IA. Más grande porque es una sola
// petición que razona sobre el conjunto, y ve mejor el proceso entero que
// parámetro suelto.
const LOTE_IA = 20;

const IMPACTOS = ["alto", "medio", "bajo"];

/** Un identificador estable para cada parámetro, con el que casar respuestas. */
export function idDe(parametro) {
  return `${parametro.etapa}|${parametro.seccion}|${parametro.magnitud}`
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, "-");
}

/**
 * La pregunta que se le hace a la bibliografía por un parámetro.
 *
 * Se le pide explícitamente que diga cuándo NO hay información: un RAG al que
 * no se le da esa salida redacta algo igual, y una relación inventada con
 * pinta de citada es peor que una casilla vacía.
 */
export function preguntaDe(parametro, { producto, atributos }) {
  const nombres = (atributos || []).map((a) => a.nombre).slice(0, 14).join(", ");
  return (
    `Producto: ${producto || "no indicado"}. ` +
    `Etapa: ${parametro.etapa}. Operación: ${parametro.seccion}. ` +
    `Parámetro de proceso: ${parametro.magnitud}` +
    (parametro.criterios?.length ? ` (criterio en el registro: ${parametro.criterios.join(" ; ")})` : "") +
    ".\n\n" +
    "¿A qué atributos de calidad del producto afecta este parámetro de proceso, y por qué mecanismo? " +
    (nombres ? `Los atributos que este proceso mide son: ${nombres}. ` : "") +
    "Indica también si se considera un parámetro crítico de proceso. " +
    "Cita el documento y la sección o página que lo sustenta. " +
    "Si en los documentos no hay información sobre esto, dilo claramente y no propongas nada por tu cuenta."
  );
}

/**
 * Lo que el propio registro ya dice, sin preguntarle a nadie.
 *
 * Un parámetro con criterio impreso está controlado por definición: el
 * documento le puso un rango. Eso no lo convierte todavía en crítico —para
 * eso hace falta saber a qué atributo afecta— pero sí es el primer dato, y es
 * el único que no depende de que nada externo responda.
 */
export function desdeElRegistro(parametro) {
  if (!parametro.criterios?.length) return null;
  return {
    fuente: "registro",
    controlado: true,
    justificacion:
      `El registro de manufactura le imprime un criterio de aceptación (${parametro.criterios.join(" ; ")}), ` +
      `anotado ${parametro.veces} ${parametro.veces === 1 ? "vez" : "veces"} en ${parametro.seccion}.`,
  };
}

function citaComoTexto(cita) {
  const documento = cita.documento || "Documento sin nombre";
  return cita.pagina ? `${documento} (p. ${cita.pagina})` : documento;
}

/** Las citas de una respuesta, en una línea, sin repetir documento. */
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

/**
 * Normaliza una fila de la IA contra los atributos que de verdad existen.
 *
 * Un atributo que la IA nombre y que no esté en la lista no se descarta: se
 * deja marcado como propuesto por ella. Descartarlo escondería que el modelo
 * ve algo que el registro no mide, que es justo lo que quien valida querría
 * saber. Lo que sí se corrige es el impacto: si devuelve cualquier otra cosa
 * que no sea alto/medio/bajo, se deja sin nivel en vez de inventarle uno.
 */
export function normalizarFila(fila, { atributos }) {
  const conocidos = new Map((atributos || []).map((a) => [a.nombre.toUpperCase(), a.nombre]));
  const afecta = (Array.isArray(fila?.afecta) ? fila.afecta : [])
    .map((x) => {
      const nombre = String(x?.atributo || "").trim();
      if (!nombre) return null;
      const conocido = conocidos.get(nombre.toUpperCase());
      const impacto = String(x?.impacto || "").toLowerCase();
      return {
        atributo: conocido || nombre,
        enElRegistro: !!conocido,
        impacto: IMPACTOS.includes(impacto) ? impacto : "",
        justificacion: String(x?.justificacion || "").trim(),
      };
    })
    .filter(Boolean);

  return {
    afecta,
    critico: fila?.critico === true,
    justificacion: String(fila?.justificacion || "").trim(),
  };
}

/**
 * Pregunta a la bibliografía por un lote de parámetros.
 *
 * Nunca lanza: si Consulta PDF no responde, responde raro o no encuentra
 * nada, se devuelve el lote sin respaldo y la clasificación sigue con la IA.
 * Que la bibliografía esté caída no puede dejar la sección sin resultado.
 */
export async function preguntarBibliografia(parametros, { producto, atributos, fetchImpl = fetch }) {
  const preguntas = parametros.map((p) => ({ id: idDe(p), pregunta: preguntaDe(p, { producto, atributos }) }));

  try {
    const respuesta = await fetchImpl("/api/verificar-bibliografia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preguntas }),
    });
    if (!respuesta.ok) return new Map();

    const { resultados = [] } = await respuesta.json().catch(() => ({}));
    const porId = new Map();
    for (const r of resultados) {
      if (!r?.confirmado || !r?.respuesta) continue;
      porId.set(r.id, {
        fuente: "bibliografía",
        texto: r.respuesta,
        citas: r.citas || [],
        referencias: citasComoTexto(r.citas),
      });
    }
    return porId;
  } catch {
    return new Map();
  }
}

/** Pide a la IA lo que las demás fuentes no resolvieron. */
export async function preguntarIA(parametros, { producto, forma, etapa, atributos, evidencia, fetchImpl = fetch }) {
  const respuesta = await fetchImpl("/api/clasificar-parametros", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      producto,
      forma,
      etapa,
      atributos: (atributos || []).map((a) => ({ nombre: a.nombre, criterio: a.criterios?.[0] || "", etapa: a.etapa })),
      parametros: parametros.map((p) => ({
        id: idDe(p),
        magnitud: p.magnitud,
        seccion: p.seccion,
        criterios: p.criterios,
      })),
      evidencia,
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.json().catch(() => ({}));
    throw new Error(detalle.error || `La IA respondió ${respuesta.status}.`);
  }

  const { filas = [] } = await respuesta.json().catch(() => ({}));
  return new Map(filas.map((f) => [String(f?.id || ""), f]));
}

/**
 * La clasificación completa de un producto.
 *
 * Va etapa por etapa porque los atributos son de la etapa: la hermeticidad es
 * del blíster y se decide en envase, no en fabricación. Preguntar por todo
 * junto le daría a la IA una lista de atributos que no corresponden al
 * parámetro que está mirando.
 */
export async function clasificar(documentos, { producto, forma, atributosExtra = [], onAvance, fetchImpl = fetch } = {}) {
  const { parametros, atributos } = separarLecturas(documentos);
  const todosLosAtributos = [...atributos, ...atributosExtra];

  const etapas = [...new Set(parametros.map((p) => p.etapa))];
  const filas = [];
  const avisos = [];

  for (const etapa of etapas) {
    const deLaEtapa = porRelevancia(parametros.filter((p) => p.etapa === etapa));
    const atributosDeLaEtapa = todosLosAtributos.filter((a) => !a.etapa || a.etapa === etapa);

    // 1 y 2: lo que ya se sabe sin preguntar.
    const base = new Map(deLaEtapa.map((p) => [idDe(p), desdeElRegistro(p)]));

    // 3: la bibliografía, por lotes.
    const respaldos = new Map();
    for (let i = 0; i < deLaEtapa.length; i += LOTE_BIBLIOGRAFIA) {
      const lote = deLaEtapa.slice(i, i + LOTE_BIBLIOGRAFIA);
      onAvance?.({ etapa, fase: "bibliografía", hechos: i, total: deLaEtapa.length });
      const encontrados = await preguntarBibliografia(lote, { producto, atributos: atributosDeLaEtapa, fetchImpl });
      for (const [id, valor] of encontrados) respaldos.set(id, valor);
    }

    // 4: la IA, con lo que la bibliografía trajo como contexto.
    const porIA = new Map();
    for (let i = 0; i < deLaEtapa.length; i += LOTE_IA) {
      const lote = deLaEtapa.slice(i, i + LOTE_IA);
      onAvance?.({ etapa, fase: "IA", hechos: i, total: deLaEtapa.length });
      const evidencia = lote
        .map((p) => {
          const r = respaldos.get(idDe(p));
          return r ? { magnitud: p.magnitud, texto: r.texto } : null;
        })
        .filter(Boolean);

      try {
        const resultado = await preguntarIA(lote, {
          producto, forma, etapa, atributos: atributosDeLaEtapa, evidencia, fetchImpl,
        });
        for (const [id, valor] of resultado) porIA.set(id, valor);
      } catch (err) {
        avisos.push(`${etapa}: ${err.message}`);
      }
    }

    for (const parametro of deLaEtapa) {
      const id = idDe(parametro);
      const delRegistro = base.get(id);
      const respaldo = respaldos.get(id);
      const cruda = porIA.get(id);
      const clasificada = cruda ? normalizarFila(cruda, { atributos: atributosDeLaEtapa }) : null;

      filas.push({
        id,
        etapa,
        seccion: parametro.seccion,
        magnitud: parametro.magnitud,
        ejemplo: parametro.ejemplo,
        criterios: parametro.criterios,
        veces: parametro.veces,
        controlado: !!delRegistro,
        afecta: clasificada?.afecta || [],
        critico: clasificada?.critico ?? null,
        justificacion: clasificada?.justificacion || delRegistro?.justificacion || "",
        referencias: respaldo?.referencias || "",
        respaldo: respaldo?.texto || "",
        // De dónde salió LA RELACIÓN, que es lo que hay que poder mirar — y
        // no de dónde salió el respaldo, que no es lo mismo.
        //
        // La bibliografía responde en prosa: dice que ese parámetro gobierna
        // ese atributo y cita dónde lo dice. Quien convierte eso en una fila
        // con su atributo, su impacto y su veredicto es la IA. Así que una
        // fila con cita NO es una fila bibliográfica: es una propuesta de la
        // IA con respaldo citado, y decir otra cosa haría pasar por
        // documentado un nivel de impacto que no lo está.
        fuente: clasificada
          ? respaldo
            ? "IA+bibliografía"
            : "IA"
          : respaldo
            ? "bibliografía"
            : delRegistro
              ? "registro"
              : "sin clasificar",
      });
    }
  }

  return { filas, atributos: todosLosAtributos, avisos };
}
