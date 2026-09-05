import WorkbookGrid from "./WorkbookGrid.jsx";
import AnalysisAssistant from "./AnalysisAssistant.jsx";
import ResultsPanel from "./ResultsPanel.jsx";
import { useWorkbookStore } from "../lib/estadistica/store.js";

/**
 * Análisis Estadístico (estilo Minitab), como sección propia — no depende
 * de nada de Detección de Parámetros ni de Análisis de Riesgo: los datos
 * los trae la propia persona, pegados, tecleados o importados de un CSV o
 * un Excel. Fase 1: hoja de trabajo editable, estadística descriptiva,
 * histograma, diagrama de caja y de dispersión.
 */
export default function EstadisticaView() {
  const temaClaro = useWorkbookStore((s) => s.temaClaro);
  return (
    <div className={`stat-body ${temaClaro ? "stat-body--claro" : ""}`}>
      <WorkbookGrid />
      <AnalysisAssistant />
      <ResultsPanel />
    </div>
  );
}
