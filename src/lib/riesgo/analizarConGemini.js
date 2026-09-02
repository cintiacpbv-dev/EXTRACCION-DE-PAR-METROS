// Llama al endpoint propio (/api/analisis-riesgo), que a su vez llama a
// Gemini con la API key del servidor. Nunca se llama a Gemini directo desde
// el navegador — la key no debe salir del servidor.
import { calcularIPR, clasificarSRI, filaVacia } from "./model.js";

// Gemini tarda en redactar cada fila (medido en producción: ~3 s por
// parámetro, con picos de lentitud bastante mayores según el momento) y una
// clave sin cuota puede hacer que el servidor pruebe varias antes de
// responder. Lotes chicos dejan margen para todo eso dentro de los 60 s de
// la función (ver vercel.json y api/analisis-riesgo.js) y, si uno falla, no
// se arrastra a los demás.
const TAMANO_LOTE = 5;

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
 * Un lote que falla (por ejemplo un 504 cuando Gemini está lento) se
 * reintenta una vez; si vuelve a fallar, se anota en `errores` y se sigue
 * con el resto — un tramo lento no debe tirar abajo todo lo que ya se
 * redactó bien.
 *
 * `onLote(filasDelLote, hecho, total)` es opcional: se llama apenas vuelve
 * cada lote (haya salido bien o no), para pintar filas conforme llegan en
 * vez de esperar a que termine la etapa completa.
 */
export async function analizarRiesgoConGemini({ producto, etapa, parametros, onLote }) {
  const lotes = partir(parametros, TAMANO_LOTE);
  const todasLasFilas = [];
  const errores = [];

  for (const [i, lote] of lotes.entries()) {
    let filas = [];
    try {
      const crudas = await pedirLote({ producto, etapa, parametros: lote });
      filas = crudas.map((f) => aFila(f, etapa));
    } catch {
      // Un reintento inmediato: casi siempre alcanza cuando el problema fue
      // una clave lenta o sin cuota justo esa vez.
      try {
        const crudas = await pedirLote({ producto, etapa, parametros: lote });
        filas = crudas.map((f) => aFila(f, etapa));
      } catch (e2) {
        errores.push({ lote: i + 1, total: lotes.length, mensaje: e2.message });
      }
    }
    todasLasFilas.push(...filas);
    onLote?.(filas, i + 1, lotes.length);
  }

  return { filas: todasLasFilas, errores };
}
