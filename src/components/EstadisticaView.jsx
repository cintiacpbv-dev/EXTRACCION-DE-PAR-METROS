import Navegador from "./Navegador.jsx";
import WorkbookGrid from "./WorkbookGrid.jsx";
import AnalysisAssistant from "./AnalysisAssistant.jsx";
import OutputViewer from "./OutputViewer.jsx";
import { useWorkbookStore } from "../lib/estadistica/store.js";

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
 */
export default function EstadisticaView() {
  const temaClaro = useWorkbookStore((s) => s.temaClaro);
  return (
    <div className={`stat-body ${temaClaro ? "stat-body--claro" : ""}`}>
      <Navegador />
      <div className="stat-main">
        <OutputViewer />
        <WorkbookGrid />
      </div>
      <AnalysisAssistant />
    </div>
  );
}
