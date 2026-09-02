// Cálculo del AMFE (Análisis de Modos de Fallo y Efectos): el Índice de
// Prioridad de Riesgo (IPR = S×O×D) y su clasificación de significancia
// (SRI), con los cortes que usa Humanova en su procedimiento de gestión de
// riesgos de calidad.
//
// Esto es aritmética pura, no depende de ninguna IA: los mismos cortes se
// escriben también como fórmula en el Excel exportado, para que la celda se
// recalcule sola si alguien cambia un S/O/D a mano.

export const SRI = {
  NS: "NS", // Riesgo No Significativo
  MS: "MS", // Riesgo Medianamente Significativo
  RS: "RS", // Riesgo Significativo
};

// IPR va de 1 (1×1×1) a 125 (5×5×5). Los tramos son los del procedimiento de
// Humanova: hasta 15 se acepta el riesgo tal cual; de 16 a 63 hace falta una
// acción programada (típicamente subir la detectabilidad); de 64 en
// adelante hace falta eliminar el modo de fallo, no sólo mitigarlo.
const CORTE_NS = 15;
const CORTE_MS = 63;

export function calcularIPR(severidad, ocurrencia, deteccion) {
  const s = Number(severidad) || 0;
  const o = Number(ocurrencia) || 0;
  const d = Number(deteccion) || 0;
  return s * o * d;
}

export function clasificarSRI(ipr) {
  if (!ipr || ipr <= 0) return "";
  if (ipr <= CORTE_NS) return SRI.NS;
  if (ipr <= CORTE_MS) return SRI.MS;
  return SRI.RS;
}

export const TEXTO_SRI = {
  [SRI.NS]: "Riesgo no significativo — se acepta sin intervenciones adicionales.",
  [SRI.MS]: "Riesgo medianamente significativo — requiere una acción programada, enfocada en subir la detectabilidad.",
  [SRI.RS]: "Riesgo significativo — exige una acción inmediata orientada a eliminar el modo de fallo.",
};

// Las escalas de 1 a 5 del propio formato de referencia, para el pie del
// cuadro y para que un panel de captura ofrezca las mismas opciones.
export const ESCALA_SEVERIDAD = [
  { valor: 1, nivel: "Insignificante" },
  { valor: 2, nivel: "Bajo impacto" },
  { valor: 3, nivel: "Considerable, el sujeto está en riesgo" },
  { valor: 4, nivel: "Relevante, alto riesgo" },
  { valor: 5, nivel: "Muy alto impacto al sujeto en protección" },
];

export const ESCALA_OCURRENCIA = [
  { valor: 1, nivel: "Muy baja" },
  { valor: 2, nivel: "Baja" },
  { valor: 3, nivel: "Moderada" },
  { valor: 4, nivel: "Alta" },
  { valor: 5, nivel: "Muy alta" },
];

export const ESCALA_DETECCION = [
  { valor: 1, nivel: "Muy detectable" },
  { valor: 2, nivel: "Detectable" },
  { valor: 3, nivel: "Moderadamente detectable" },
  { valor: 4, nivel: "Baja detectabilidad" },
  { valor: 5, nivel: "No puede ser detectado" },
];

/**
 * Una fila en blanco del cuadro, con los campos que arma la plantilla y los
 * que rellena la IA o la persona que valida.
 */
export function filaVacia({ proceso = "", actividad = "" } = {}) {
  return {
    id: `${proceso}::${actividad}::${Math.random().toString(36).slice(2, 8)}`,
    proceso,
    actividad,
    modoFallo: "",
    efecto: "",
    severidad: "",
    causa: "",
    ocurrencia: "",
    controles: "",
    documentos: "",
    deteccion: "",
    accionesATomar: "",
    responsable: "",
    plazo: "",
    // Situación de mejora: mismo trío S/O/D, tras aplicar las acciones.
    accionesImplantadas: "",
    severidad2: "",
    ocurrencia2: "",
    deteccion2: "",
  };
}
