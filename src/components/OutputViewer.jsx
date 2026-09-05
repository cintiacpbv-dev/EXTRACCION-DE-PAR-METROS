import ReactECharts from "echarts-for-react";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { IconAlert, IconMessageSquare } from "./Icons.jsx";

function TablaResultado({ contenido }) {
  return (
    <div className="resultado-tabla-wrap">
      <table className="resultado-tabla">
        <thead>
          <tr>
            {contenido.encabezados.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contenido.filas.map((fila, i) => (
            <tr key={i}>
              {fila.map((valor, j) => (
                <td key={j}>{valor}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * El visor principal: muestra en grande lo que esté elegido en el
 * Navegador —una tabla o un gráfico—, igual que la ventana de salida de
 * Minitab. Sin nada elegido, explica qué hacer para llegar a ver algo acá.
 */
export default function OutputViewer() {
  const resultados = useWorkbookStore((s) => s.resultados);
  const graficos = useWorkbookStore((s) => s.graficos);
  const seleccionActual = useWorkbookStore((s) => s.seleccionActual);

  const item =
    seleccionActual?.tipo === "resultado"
      ? resultados.find((r) => r.id === seleccionActual.id)
      : seleccionActual?.tipo === "grafico"
        ? graficos.find((g) => g.id === seleccionActual.id)
        : null;

  return (
    <section className="output-viewer">
      {!item && (
        <div className="results-vacio">
          <IconMessageSquare size={20} />
          <p>Elige columnas en el Asistente y pulsa Ejecutar. Los resultados y gráficos aparecen aquí.</p>
        </div>
      )}

      {item && seleccionActual.tipo === "resultado" && (
        <article className="resultado-item">
          <header>
            <h4>{item.titulo}</h4>
          </header>
          {item.advertencias?.length > 0 && (
            <div className="resultado-advertencias">
              {item.advertencias.map((a, i) => (
                <p key={i}>
                  <IconAlert size={13} /> {a}
                </p>
              ))}
            </div>
          )}
          <TablaResultado contenido={item.contenido} />
        </article>
      )}

      {item && seleccionActual.tipo === "grafico" && (
        <article className="resultado-item resultado-item--grafico">
          <header>
            <h4>{item.titulo}</h4>
          </header>
          <ReactECharts option={item.opciones} style={{ height: "100%", minHeight: 380 }} notMerge lazyUpdate />
        </article>
      )}
    </section>
  );
}
