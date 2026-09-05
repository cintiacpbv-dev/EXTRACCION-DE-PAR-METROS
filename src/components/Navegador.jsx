import { useMemo } from "react";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { IconChartBar, IconClose, IconGrid, IconLayers } from "./Icons.jsx";

/**
 * La lista de todo lo generado en la sesión — tablas y gráficos por igual,
 * en el orden en que se crearon — igual que el "Navegador" de Minitab.
 * Elegir un elemento lo abre grande en el visor de al lado; no hace falta
 * bajar a buscarlo entre los demás.
 */
export default function Navegador() {
  const resultados = useWorkbookStore((s) => s.resultados);
  const graficos = useWorkbookStore((s) => s.graficos);
  const seleccionActual = useWorkbookStore((s) => s.seleccionActual);
  const seleccionar = useWorkbookStore((s) => s.seleccionar);
  const eliminarResultado = useWorkbookStore((s) => s.eliminarResultado);
  const eliminarGrafico = useWorkbookStore((s) => s.eliminarGrafico);

  const items = useMemo(() => {
    const todos = [
      ...resultados.map((r) => ({ tipo: "resultado", id: r.id, titulo: r.titulo, timestamp: r.timestamp })),
      ...graficos.map((g) => ({ tipo: "grafico", id: g.id, titulo: g.titulo, timestamp: g.timestamp })),
    ];
    return todos.sort((a, b) => a.timestamp - b.timestamp);
  }, [resultados, graficos]);

  function quitar(item) {
    if (item.tipo === "grafico") eliminarGrafico(item.id);
    else eliminarResultado(item.id);
  }

  return (
    <aside className="navegador-panel">
      <div className="navegador-header">
        <IconLayers size={15} />
        <h3>Navegador</h3>
      </div>
      <ul className="navegador-lista">
        {items.length === 0 && <li className="navegador-vacio">Sin resultados todavía.</li>}
        {items.map((it) => {
          const activo = seleccionActual?.tipo === it.tipo && seleccionActual?.id === it.id;
          return (
            <li key={`${it.tipo}-${it.id}`} className={activo ? "is-activo" : ""}>
              <button type="button" className="navegador-item" onClick={() => seleccionar({ tipo: it.tipo, id: it.id })}>
                {it.tipo === "grafico" ? <IconChartBar size={13} /> : <IconGrid size={13} />}
                <span>{it.titulo}</span>
              </button>
              <button type="button" className="navegador-item__quitar" title="Quitar" onClick={() => quitar(it)}>
                <IconClose size={11} />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
