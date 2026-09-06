import { useState } from "react";
import Navegador from "./Navegador.jsx";
import WorkbookGrid from "./WorkbookGrid.jsx";
import AnalysisAssistant from "./AnalysisAssistant.jsx";
import OutputViewer from "./OutputViewer.jsx";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { exportarInformeWord } from "../lib/estadistica/exportar.js";
import { IconLayers, IconGrid, IconFlask, IconDownload } from "./Icons.jsx";

/**
 * Análisis Estadístico (estilo Minitab), como sección propia — no depende
 * de nada de Detección de Parámetros ni de Análisis de Riesgo: los datos
 * los trae la propia persona, pegados, tecleados o importados de un CSV o
 * un Excel.
 *
 * El acomodo copia el de Minitab: el Navegador (lista de lo generado) a la
 * izquierda, el resultado elegido en grande arriba, la hoja de trabajo
 * abajo, y a la derecha el Asistente — que en Minitab son los menús con sus
 * cuadros de diálogo, aquí un panel fijo porque no hay equivalente directo.
 *
 * Los tres paneles se pueden cerrar desde la barra de arriba. No es un
 * adorno: en una pantalla de portátil, con los tres abiertos, al gráfico le
 * queda la mitad del ancho, y un gráfico es justo lo que se viene a mirar
 * en grande.
 */
export default function EstadisticaView() {
  const temaClaro = useWorkbookStore((s) => s.temaClaro);
  const alternarTema = useWorkbookStore((s) => s.alternarTema);
  const paneles = useWorkbookStore((s) => s.paneles);
  const alternarPanel = useWorkbookStore((s) => s.alternarPanel);
  const resultados = useWorkbookStore((s) => s.resultados);
  const graficos = useWorkbookStore((s) => s.graficos);

  const [exportando, setExportando] = useState(false);
  const total = resultados.length + graficos.length;

  async function exportarTodo() {
    setExportando(true);
    try {
      await exportarInformeWord({ resultados, graficos });
    } finally {
      setExportando(false);
    }
  }

  // Las columnas de la rejilla se arman con los paneles que estén abiertos:
  // un panel cerrado no deja su hueco vacío, se lo queda el visor.
  const columnas = [paneles.navegador ? "210px" : null, "minmax(0, 1fr)", paneles.asistente ? "290px" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`stat-shell ${temaClaro ? "stat-body--claro" : ""}`}>
      <div className="stat-toolbar">
        <div className="stat-toolbar__grupo">
          <button
            type="button"
            className={`stat-toggle ${paneles.navegador ? "is-activo" : ""}`}
            onClick={() => alternarPanel("navegador")}
            aria-pressed={paneles.navegador}
            title="Mostrar u ocultar el Navegador"
          >
            <IconLayers size={14} /> Navegador
          </button>
          <button
            type="button"
            className={`stat-toggle ${paneles.hoja ? "is-activo" : ""}`}
            onClick={() => alternarPanel("hoja")}
            aria-pressed={paneles.hoja}
            title="Mostrar u ocultar la hoja de trabajo"
          >
            <IconGrid size={14} /> Hoja de trabajo
          </button>
          <button
            type="button"
            className={`stat-toggle ${paneles.asistente ? "is-activo" : ""}`}
            onClick={() => alternarPanel("asistente")}
            aria-pressed={paneles.asistente}
            title="Mostrar u ocultar el Asistente"
          >
            <IconFlask size={14} /> Asistente
          </button>
        </div>

        <div className="stat-toolbar__grupo stat-toolbar__grupo--fin">
          <button
            type="button"
            className="stat-toggle"
            onClick={alternarTema}
            aria-pressed={temaClaro}
            title="Cambiar entre fondo claro y oscuro (los gráficos van siempre en claro, para imprimirlos)"
          >
            {temaClaro ? "☀️ Fondo claro" : "🌙 Fondo oscuro"}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--mini"
            onClick={exportarTodo}
            disabled={total === 0 || exportando}
            title="Descarga un Word con todas las tablas y todos los gráficos de esta sesión"
          >
            <IconDownload size={14} />
            {exportando ? "Generando…" : `Exportar todo (${total})`}
          </button>
        </div>
      </div>

      <div className="stat-body" style={{ gridTemplateColumns: columnas }}>
        {paneles.navegador && <Navegador />}
        <div className="stat-main">
          <OutputViewer />
          {paneles.hoja && <WorkbookGrid />}
        </div>
        {paneles.asistente && <AnalysisAssistant />}
      </div>
    </div>
  );
}
