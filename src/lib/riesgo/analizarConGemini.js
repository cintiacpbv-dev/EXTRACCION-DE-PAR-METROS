// Llama al endpoint propio (/api/analisis-riesgo), que a su vez llama a
// Gemini con la API key del servidor. Nunca se llama a Gemini directo desde
// el navegador — la key no debe salir del servidor.
import { calcularIPR, clasificarSRI, filaVacia } from "./model.js";

// Gemini tarda en redactar cada fila (medido en producción: ~3 s por
// parámetro, y el primer lote de una función recién despertada puede tardar
// bastante más — más de 90 s con 20 parámetros de un tirón). Una sola
// llamada con la etapa completa (hasta 80 parámetros) se arriesga a que
// Vercel corte la función a medio camino, y quien está esperando no ve nada
// hasta que se cae. Por eso se manda en lotes chicos: cada uno termina
// rápido, y el progreso se ve avanzar en vez de una espera muda.
const TAMANO_LOTE = 8;

function partir(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

async function pedirLote({ producto, etapa, parametros }) {
  const respuesta = await fetch("/api/analisis-riesgo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ producto, etapa, parametros }),
  });

  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new Error(cuerpo?.error || `El servidor respondió ${respuesta.status}.`);
  }
  if (!Array.isArray(cuerpo?.filas)) {
    throw new Error("La respuesta no trajo filas utilizables.");
  }
  return cuerpo.filas;
}

function aFila(f, etapa) {
  const base = filaVacia({ proceso: etapa, actividad: f.actividad || "" });
  return {
    ...base,
    modoFallo: f.modoFallo || "",
    efecto: f.efecto || "",
    severidad: f.severidad ?? "",
    causa: f.causa || "",
    ocurrencia: f.ocurrencia ?? "",
    controles: f.controles || "",
    deteccion: f.deteccion ?? "",
    accionesATomar: f.accionesATomar || "",
    _ipr: calcularIPR(f.severidad, f.ocurrencia, f.deteccion),
    _sri: clasificarSRI(calcularIPR(f.severidad, f.ocurrencia, f.deteccion)),
    _parametroOrigen: f.parametro || "",
  };
}

/**
 * Pide a Gemini un borrador de AMFE para una lista de parámetros críticos,
 * en lotes chicos y uno detrás de otro (ver TAMANO_LOTE arriba), y lo
 * devuelve ya con la forma de fila que espera la vista y el exportador (ver
 * riesgo/model.js) — con el IPR y el SRI ya calculados, aunque también se
 * reescriben como fórmula al exportar.
 *
 * `onLote(filasDelLote, hecho, total)` es opcional: se llama apenas vuelve
 * cada lote, para pintar filas conforme llegan en vez de esperar a que
 * termine la etapa completa — y para no perder lo ya redactado si un lote
 * de más adelante falla.
 */
export async function analizarRiesgoConGemini({ producto, etapa, parametros, onLote }) {
  const lotes = partir(parametros, TAMANO_LOTE);
  const todasLasFilas = [];

  for (const [i, lote] of lotes.entries()) {
    const filasCrudas = await pedirLote({ producto, etapa, parametros: lote });
    const filas = filasCrudas.map((f) => aFila(f, etapa));
    todasLasFilas.push(...filas);
    onLote?.(filas, i + 1, lotes.length);
  }

  return todasLasFilas;
}
