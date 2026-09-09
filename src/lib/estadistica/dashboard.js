// El dashboard de estado y el motor de conclusión: las dos últimas piezas
// del flujo completo (DATOS → CALIDAD → DISTRIBUCIÓN → MSA → ESTABILIDAD →
// CAPACIDAD → LOTES → VARIABLES CRÍTICAS → CONCLUSIÓN).
//
// Ninguna función de aquí calcula un estadístico: leen "hallazgos" —los
// estados que ya clasificó estado.js a partir de lo que ya calcularon
// normalidad.js/spc.js/pruebas.js/gageRR.js/regresion.js— y sólo los
// resumen. La conclusión nunca se escribe con una frase fija tipo "Proceso
// validado": siempre se arma a partir de qué etapas se evaluaron y en qué
// quedaron.
import { ESTADO, etiquetaEstado } from "./estado.js";

// El orden es el del flujo, y son las mismas ocho filas del dashboard
// pedido. Con más de un hallazgo por etapa (por ejemplo, "Lotes" después de
// correr ANOVA y luego Welch sobre las mismas columnas), manda el último:
// es el análisis más reciente el que refleja cómo se está mirando el dato
// ahora, no el primero que se probó.
export const ETAPAS = [
  { id: "datos", nombre: "Datos" },
  { id: "calidad", nombre: "Calidad" },
  { id: "distribucion", nombre: "Distribución" },
  { id: "msa", nombre: "MSA" },
  { id: "estabilidad", nombre: "Estabilidad" },
  { id: "capacidad", nombre: "Capacidad" },
  { id: "lotes", nombre: "Lotes" },
  { id: "variables_criticas", nombre: "Variables críticas" },
];

/** El último hallazgo registrado para cada etapa, o null si nunca se evaluó. */
export function ultimoHallazgoPorEtapa(hallazgos) {
  const porEtapa = {};
  for (const e of ETAPAS) porEtapa[e.id] = null;
  for (const h of hallazgos) {
    if (!(h.etapa in porEtapa)) continue;
    if (!porEtapa[h.etapa] || h.timestamp >= porEtapa[h.etapa].timestamp) porEtapa[h.etapa] = h;
  }
  return porEtapa;
}

/**
 * El motor de conclusión.
 *
 * Se arma en dos pasos, siempre a partir del mapa de "último hallazgo por
 * etapa" — nunca inventa una etapa que no se corrió:
 *
 * 1. Si alguna etapa evaluada dio NO_FAVORABLE o NO_CONCLUYENTE, la
 *    conclusión se detiene ahí: no hay forma de que el resto del análisis
 *    "compense" un sistema de medición no confiable o un proceso inestable
 *    — se nombra exactamente qué falta resolver.
 * 2. Si no, se cuenta cuántas etapas quedan sin evaluar y cuántas en
 *    REQUIERE REVISIÓN, y el texto se ajusta a eso: todo favorable, sólo si
 *    de verdad lo es.
 */
export function motorConclusion(hallazgos) {
  const porEtapa = ultimoHallazgoPorEtapa(hallazgos);
  const filas = ETAPAS.map((e) => ({ etapa: e, hallazgo: porEtapa[e.id] }));

  const bloqueantes = filas.filter((f) => f.hallazgo && [ESTADO.NO_FAVORABLE, ESTADO.NO_CONCLUYENTE].includes(f.hallazgo.estado));
  const revisar = filas.filter((f) => f.hallazgo && f.hallazgo.estado === ESTADO.REQUIERE_REVISION);
  const sinEvaluar = filas.filter((f) => !f.hallazgo);
  const favorables = filas.filter((f) => f.hallazgo && f.hallazgo.estado === ESTADO.FAVORABLE);

  let texto;
  if (bloqueantes.length > 0) {
    const nombres = bloqueantes.map((f) => f.etapa.nombre).join(", ");
    texto = `No es apropiado emitir una conclusión favorable hasta resolver: ${nombres}. El resto de los resultados —aunque sean favorables por su cuenta— no compensa lo que está pendiente ahí, y se muestran como referencia técnica, no como validación.`;
  } else if (favorables.length === 0) {
    texto = "Todavía no hay evidencia suficiente para una conclusión: ninguna etapa del flujo se ha evaluado favorablemente. Corre los análisis correspondientes desde el Asistente.";
  } else if (revisar.length === 0 && sinEvaluar.length === 0) {
    texto = "Evidencia estadística global FAVORABLE: todas las etapas evaluadas del flujo dieron resultado favorable.";
  } else {
    const partes = [];
    if (revisar.length > 0) partes.push(`observación pendiente sobre: ${revisar.map((f) => f.etapa.nombre).join(", ")}`);
    if (sinEvaluar.length > 0) partes.push(`sin evaluar todavía: ${sinEvaluar.map((f) => f.etapa.nombre).join(", ")}`);
    texto = `Evidencia estadística global FAVORABLE en lo evaluado, con ${partes.join("; ")}. La conclusión es parcial mientras eso siga pendiente.`;
  }

  return {
    filas: filas.map((f) => ({
      etapa: f.etapa.nombre,
      estado: f.hallazgo ? etiquetaEstado(f.hallazgo.estado) : etiquetaEstado(ESTADO.NO_EVALUADO),
      resumen: f.hallazgo?.resumen ?? "—",
    })),
    texto,
    completo: sinEvaluar.length === 0,
  };
}
