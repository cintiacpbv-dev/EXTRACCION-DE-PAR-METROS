import { useState } from "react";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { estadisticaDescriptiva } from "../lib/estadistica/descriptiva.js";
import { IconAlert, IconSparkles } from "./Icons.jsx";

/**
 * Un resumen corto de la columna, no los datos: es lo único que sale hacia
 * Gemini. Alcanza para que sugiera qué prueba usar, y evita mandar la hoja
 * completa a un tercero cuando ni hace falta para eso.
 */
function resumenColumna(c) {
  const noVacios = c.values.filter((v) => v != null);
  if (c.type === "numeric") {
    const r = estadisticaDescriptiva(c.values);
    if (r.vacio) return "sin datos numéricos";
    return `n=${r.n}, media=${r.media.toFixed(2)}, desv.est=${r.desvEst.toFixed(2)}, mínimo=${r.minimo.toFixed(2)}, máximo=${r.maximo.toFixed(2)}`;
  }
  if (c.type === "text") {
    const unicos = [...new Set(noVacios.map(String))];
    return `n=${noVacios.length}, ${unicos.length} valor(es) distinto(s)${unicos.length <= 6 ? `: ${unicos.join(", ")}` : ` (ej.: ${unicos.slice(0, 4).join(", ")}…)`}`;
  }
  return `n=${noVacios.length} valores de fecha`;
}

/**
 * Panel plegado por defecto: pedirle una sugerencia a la IA es un extra,
 * no el camino principal — la mayoría de las veces la persona ya sabe qué
 * prueba quiere correr.
 */
export default function AiAdvisor({ onAplicarSugerencia }) {
  const columns = useWorkbookStore((s) => s.columns);
  const [abierto, setAbierto] = useState(false);
  const [objetivo, setObjetivo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [sugerencia, setSugerencia] = useState(null);
  const [error, setError] = useState("");

  async function preguntar() {
    if (!objetivo.trim()) {
      setError("Escribe qué quieres averiguar.");
      return;
    }
    setCargando(true);
    setError("");
    setSugerencia(null);
    try {
      const columnasResumen = columns.map((c) => ({ nombre: c.name, tipo: c.type, resumen: resumenColumna(c) }));
      const respuesta = await fetch("/api/sugerencia-estadistica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnas: columnasResumen, objetivo }),
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        setError(datos.error || "No se pudo obtener una sugerencia.");
        return;
      }
      setSugerencia(datos);
    } catch (err) {
      setError(`No se pudo conectar con el asistente (${err.message}).`);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="ai-advisor">
      <button type="button" className="ai-advisor__toggle" onClick={() => setAbierto((a) => !a)}>
        <IconSparkles size={14} />
        <span>Preguntar a la IA</span>
        <span className="ai-advisor__caret">{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && (
        <div className="ai-advisor__panel">
          <textarea
            className="ai-advisor__texto"
            placeholder='Ej.: "¿el proceso está bajo control?" o "¿estas dos máquinas dan resultados distintos?"'
            value={objetivo}
            onChange={(e) => setObjetivo(e.target.value)}
            rows={3}
          />
          <button type="button" className="btn btn--ghost btn--sm" onClick={preguntar} disabled={cargando}>
            {cargando ? "Pensando…" : "Sugerir análisis"}
          </button>

          {error && (
            <div className="assistant-aviso">
              <IconAlert size={13} />
              <span>{error}</span>
            </div>
          )}

          {sugerencia && (
            <div className="ai-advisor__sugerencia">
              <p>{sugerencia.justificacion}</p>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => onAplicarSugerencia(sugerencia)}>
                Usar esta sugerencia
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
