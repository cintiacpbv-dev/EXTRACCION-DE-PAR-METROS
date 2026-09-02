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

// Una etapa con muchos parámetros (Fabricación puede pasar de 60) parte en
// una docena de lotes; uno detrás de otro eso son varios minutos de espera
// —tiempo de sobra para que alguien exporte antes de que termine, como pasó
// con FLUIXX (10 de 59 filas: se bajó el Excel a mitad de camino). Corriendo
// unos cuantos lotes a la vez baja la espera real sin mandar las seis
// claves de golpe.
const LOTES_EN_PARALELO = 3;

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
 * Varios lotes se piden a la vez (ver LOTES_EN_PARALELO), así que terminan
 * en el orden en que responde Gemini, no necesariamente en el orden de la
 * lista original — no importa para el cuadro, que ya se edita a mano.
 *
 * `onLote(filasDelLote, hecho, total)` es opcional: se llama apenas vuelve
 * cada lote (haya salido bien o no), con cuántos van hechos en total, para
 * pintar filas conforme llegan y mostrar un progreso real en vez de un
 * botón congelado varios minutos.
 */
export async function analizarRiesgoConGemini({ producto, etapa, parametros, onLote }) {
  const lotes = partir(parametros, TAMANO_LOTE);
  const todasLasFilas = [];
  const errores = [];
  let completados = 0;

  async function procesarLote(lote, indice) {
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
        errores.push({ lote: indice + 1, total: lotes.length, mensaje: e2.message });
      }
    }
    todasLasFilas.push(...filas);
    completados += 1;
    onLote?.(filas, completados, lotes.length);
  }

  // Cola con cupo fijo: cada "trabajador" toma el siguiente lote libre en
  // cuanto termina el suyo, hasta que no queden más.
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < lotes.length) {
      const indice = siguiente++;
      await procesarLote(lotes[indice], indice);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(LOTES_EN_PARALELO, lotes.length) }, trabajador)
  );

  return { filas: todasLasFilas, errores };
}
