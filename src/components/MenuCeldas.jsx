import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * El menú del clic derecho sobre la hoja, con lo mismo que ofrece el de
 * Minitab: borrar, eliminar, copiar, cortar, pegar, insertar y quitar filas o
 * columnas, ordenar, y con cuántos decimales se muestra la columna.
 *
 * Se dibuja en su sitio y, si no cabe hacia abajo o hacia la derecha, se
 * vuelve hacia el otro lado: pinchar en la última fila de la hoja no puede
 * abrir un menú que se sale de la pantalla.
 */
export default function MenuCeldas({ x, y, opciones, onCerrar }) {
  const cajaRef = useRef(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = cajaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margen = 8;
    setPos({
      x: Math.max(margen, Math.min(x, window.innerWidth - r.width - margen)),
      y: Math.max(margen, Math.min(y, window.innerHeight - r.height - margen)),
    });
  }, [x, y]);

  useEffect(() => {
    const fuera = (e) => {
      if (!cajaRef.current?.contains(e.target)) onCerrar();
    };
    const escape = (e) => {
      if (e.key === "Escape") onCerrar();
    };
    // "pointerdown" y no "click": así se cierra antes de que el clic llegue a
    // la celda de debajo, y no se mueve la selección al descartar el menú.
    document.addEventListener("pointerdown", fuera, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", onCerrar);
    return () => {
      document.removeEventListener("pointerdown", fuera, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", onCerrar);
    };
  }, [onCerrar]);

  return (
    <div ref={cajaRef} className="menu-celdas" style={{ left: pos.x, top: pos.y }} role="menu">
      {opciones.map((o, i) =>
        o.separador ? (
          // eslint-disable-next-line react/no-array-index-key
          <div key={`sep${i}`} className="menu-celdas__raya" />
        ) : (
          <button
            key={o.etiqueta}
            type="button"
            role="menuitem"
            className="menu-celdas__opcion"
            disabled={o.desactivada}
            title={o.ayuda}
            onClick={() => {
              onCerrar();
              o.hacer();
            }}
          >
            <span>{o.etiqueta}</span>
            {o.atajo && <small>{o.atajo}</small>}
          </button>
        )
      )}
    </div>
  );
}
