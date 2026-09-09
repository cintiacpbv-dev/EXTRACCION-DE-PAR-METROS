import { useWorkbookStore } from "../lib/estadistica/store.js";
import { ETAPAS, ultimoHallazgoPorEtapa } from "../lib/estadistica/dashboard.js";
import { ESTADO } from "../lib/estadistica/estado.js";

const CLASE_POR_ESTADO = {
  [ESTADO.FAVORABLE]: "dash-chip--favorable",
  [ESTADO.REQUIERE_REVISION]: "dash-chip--revision",
  [ESTADO.NO_FAVORABLE]: "dash-chip--no-favorable",
  [ESTADO.NO_CONCLUYENTE]: "dash-chip--no-favorable",
  [ESTADO.NO_EVALUADO]: "dash-chip--no-evaluado",
};

/**
 * La tira de estado por etapa, siempre a la vista arriba del panel: DATOS,
 * CALIDAD, DISTRIBUCIÓN, MSA, ESTABILIDAD, CAPACIDAD, LOTES, VARIABLES
 * CRÍTICAS — las mismas ocho filas que pide el dashboard, en el mismo orden
 * del flujo.
 *
 * No calcula nada: lee "hallazgos" del store, que es lo que va dejando cada
 * análisis al pasar por estado.js (ver dashboard.js). Una etapa que nunca se
 * corrió se ve "NO EVALUADO" — nunca se rellena con un supuesto para que la
 * tira se vea completa.
 */
export default function DashboardEstado() {
  const hallazgos = useWorkbookStore((s) => s.hallazgos);
  const porEtapa = ultimoHallazgoPorEtapa(hallazgos);

  return (
    <div className="dash-tira" role="list" aria-label="Estado del proyecto por etapa">
      {ETAPAS.map((e) => {
        const h = porEtapa[e.id];
        const estado = h?.estado ?? ESTADO.NO_EVALUADO;
        return (
          <div key={e.id} role="listitem" className={`dash-chip ${CLASE_POR_ESTADO[estado] ?? "dash-chip--no-evaluado"}`} title={h?.resumen ?? "Todavía no se evaluó esta etapa."}>
            <span className="dash-chip__punto" aria-hidden="true" />
            <span className="dash-chip__nombre">{e.nombre}</span>
          </div>
        );
      })}
    </div>
  );
}
