import { useEffect, useRef } from "react";
import ReactECharts from "echarts-for-react";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { IconAlert, IconClose, IconMessageSquare, IconTrash } from "./Icons.jsx";

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

export default function ResultsPanel() {
  const resultados = useWorkbookStore((s) => s.resultados);
  const graficos = useWorkbookStore((s) => s.graficos);
  const eliminarResultado = useWorkbookStore((s) => s.eliminarResultado);
  const eliminarGrafico = useWorkbookStore((s) => s.eliminarGrafico);
  const finSesion = useRef(null);

  // Como la ventana de sesión de Minitab: lo nuevo entra por abajo y la
  // vista sigue el final, en vez de obligar a bajar a mano cada vez.
  useEffect(() => {
    finSesion.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [resultados.length, graficos.length]);

  const vacio = resultados.length === 0 && graficos.length === 0;

  return (
    <section className="results-panel">
      <div className="results-scroll">
        {vacio && (
          <div className="results-vacio">
            <IconMessageSquare size={20} />
            <p>Elige columnas en el Asistente y pulsa Ejecutar. Los resultados y gráficos aparecen aquí.</p>
          </div>
        )}

        {resultados.map((r) => (
          <article key={r.id} className="resultado-item">
            <header>
              <h4>{r.titulo}</h4>
              <button type="button" className="btn btn--ghost btn--icon" title="Quitar" onClick={() => eliminarResultado(r.id)}>
                <IconClose size={13} />
              </button>
            </header>
            {r.advertencias?.length > 0 && (
              <div className="resultado-advertencias">
                {r.advertencias.map((a, i) => (
                  <p key={i}>
                    <IconAlert size={13} /> {a}
                  </p>
                ))}
              </div>
            )}
            <TablaResultado contenido={r.contenido} />
          </article>
        ))}

        {graficos.map((g) => (
          <article key={g.id} className="resultado-item resultado-item--grafico">
            <header>
              <h4>{g.titulo}</h4>
              <button type="button" className="btn btn--ghost btn--icon" title="Quitar" onClick={() => eliminarGrafico(g.id)}>
                <IconTrash size={13} />
              </button>
            </header>
            <ReactECharts option={g.opciones} style={{ height: 320 }} notMerge lazyUpdate theme={undefined} />
          </article>
        ))}

        <div ref={finSesion} />
      </div>
    </section>
  );
}
