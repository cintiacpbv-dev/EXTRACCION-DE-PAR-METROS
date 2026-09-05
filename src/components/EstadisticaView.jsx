import WorkbookGrid from "./WorkbookGrid.jsx";
import AnalysisAssistant from "./AnalysisAssistant.jsx";
import ResultsPanel from "./ResultsPanel.jsx";

/**
 * Análisis Estadístico (estilo Minitab), como sección propia — no depende
 * de nada de Detección de Parámetros ni de Análisis de Riesgo: los datos
 * los trae la propia persona, pegados, tecleados o importados de un CSV o
 * un Excel. Fase 1: hoja de trabajo editable, estadística descriptiva,
 * histograma, diagrama de caja y de dispersión.
 */
export default function EstadisticaView() {
  return (
    <div className="stat-body">
      <WorkbookGrid />
      <AnalysisAssistant />
      <ResultsPanel />
    </div>
  );
}
