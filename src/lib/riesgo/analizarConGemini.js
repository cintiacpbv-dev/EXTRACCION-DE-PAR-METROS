// Llama al endpoint propio (/api/analisis-riesgo), que a su vez llama a
// Gemini con la API key del servidor. Nunca se llama a Gemini directo desde
// el navegador — la key no debe salir del servidor.
import { calcularIPR, clasificarSRI, filaVacia } from "./model.js";

/**
 * Pide a Gemini un borrador de AMFE para una lista de parámetros críticos,
 * y lo devuelve ya con la forma de fila que espera el panel y el
 * exportador (ver riesgo/model.js) — con el IPR y el SRI ya calculados,
 * aunque también se reescriben como fórmula al exportar.
 */
export async function analizarRiesgoConGemini({ producto, etapa, parametros }) {
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

  return cuerpo.filas.map((f) => {
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
  });
}
