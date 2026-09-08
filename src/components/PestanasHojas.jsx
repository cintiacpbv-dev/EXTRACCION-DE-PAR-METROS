import { useState } from "react";
import { useWorkbookStore } from "../lib/estadistica/store.js";

/**
 * La tira de hojas de trabajo del pie de la gradilla, como la de Minitab:
 * los cuatro botones para ir a la primera, la anterior, la siguiente y la
 * última, el "+" para abrir una hoja nueva, y las pestañas.
 *
 * Varias hojas en el mismo proyecto es lo que permite tener los datos de un
 * lote en una y los del siguiente en otra sin vaciar nada, y comparar las dos
 * en el mismo informe. Doble clic en una pestaña la renombra: "Lote 2632158"
 * dice mucho más que "Hoja de trabajo 2".
 */
export default function PestanasHojas() {
  const hojas = useWorkbookStore((s) => s.hojas);
  const hojaActiva = useWorkbookStore((s) => s.hojaActiva);
  const elegirHoja = useWorkbookStore((s) => s.elegirHoja);
  const agregarHoja = useWorkbookStore((s) => s.agregarHoja);
  const renombrarHoja = useWorkbookStore((s) => s.renombrarHoja);
  const eliminarHoja = useWorkbookStore((s) => s.eliminarHoja);

  const [editando, setEditando] = useState(null); // { indice, texto }

  function confirmar() {
    if (!editando) return;
    renombrarHoja(editando.indice, editando.texto);
    setEditando(null);
  }

  return (
    <div className="hoja-pestanas">
      <div className="hoja-pestanas__nav">
        <button type="button" onClick={() => elegirHoja(0)} disabled={hojaActiva === 0} title="Primera hoja" aria-label="Primera hoja">
          ⏮
        </button>
        <button
          type="button"
          onClick={() => elegirHoja(hojaActiva - 1)}
          disabled={hojaActiva === 0}
          title="Hoja anterior"
          aria-label="Hoja anterior"
        >
          ◀
        </button>
        <button
          type="button"
          onClick={() => elegirHoja(hojaActiva + 1)}
          disabled={hojaActiva >= hojas.length - 1}
          title="Hoja siguiente"
          aria-label="Hoja siguiente"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => elegirHoja(hojas.length - 1)}
          disabled={hojaActiva >= hojas.length - 1}
          title="Última hoja"
          aria-label="Última hoja"
        >
          ⏭
        </button>
        <button type="button" className="hoja-pestanas__mas" onClick={agregarHoja} title="Nueva hoja de trabajo" aria-label="Nueva hoja de trabajo">
          +
        </button>
      </div>

      <div className="hoja-pestanas__lista" role="tablist">
        {hojas.map((h, i) => (
          <div
            key={h.id}
            role="tab"
            tabIndex={0}
            aria-selected={i === hojaActiva}
            className={`hoja-pestana ${i === hojaActiva ? "is-activa" : ""}`}
            onClick={() => elegirHoja(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                elegirHoja(i);
              }
            }}
            onDoubleClick={() => setEditando({ indice: i, texto: h.nombre })}
            title="Doble clic para cambiarle el nombre"
          >
            {editando?.indice === i ? (
              <input
                className="hoja-pestana__editor"
                value={editando.texto}
                autoFocus
                onChange={(e) => setEditando({ indice: i, texto: e.target.value })}
                onBlur={confirmar}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") confirmar();
                  else if (e.key === "Escape") setEditando(null);
                }}
              />
            ) : (
              <span>{h.nombre}</span>
            )}

            {hojas.length > 1 && (
              <button
                type="button"
                className="hoja-pestana__cerrar"
                title={`Cerrar ${h.nombre}`}
                aria-label={`Cerrar ${h.nombre}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`¿Cerrar "${h.nombre}"? Se pierden sus datos.`)) eliminarHoja(i);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
