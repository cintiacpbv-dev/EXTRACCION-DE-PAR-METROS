import { useState } from "react";
import { IconChevronDown, IconClose, IconFileText, IconLayers } from "./Icons.jsx";

/**
 * Los archivos que se apartaron por estar ya analizados.
 *
 * No se analizan al soltarlos: se reconocen por la huella del archivo y se
 * quedan aquí, agrupados por el producto con el que se analizaron la primera
 * vez. Analizarlos otra vez es una decisión, no lo que pasa por defecto —
 * tiene sentido cuando la aplicación aprendió a leer algo que antes no veía.
 */
export default function ArchivosOmitidos({ archivos, onAnalizar, onDescartar, ocupado }) {
  const [abierto, setAbierto] = useState(false);

  if (archivos.length === 0) return null;

  // Por producto reconocido; los que no se pudieron identificar van juntos al
  // final, bajo un nombre que dice justamente eso.
  const grupos = new Map();
  for (const a of archivos) {
    const clave = a.previo?.producto || "Sin producto reconocido";
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(a);
  }
  const lista = [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <section className="card sap-panel sap-panel--omitidos">
      <button
        className="sap-cabecera sap-cabecera--boton"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
      >
        <span className="sap-icono">
          <IconFileText size={16} />
        </span>
        <div>
          <strong>Ya analizados · {archivos.length}</strong>
          <p className="muted">
            {lista.length === 1 ? "1 producto" : `${lista.length} productos`} · no se volvieron a analizar.
            Ábrelo para analizarlos de nuevo.
          </p>
        </div>
        <IconChevronDown size={16} className={`sap-chevron ${abierto ? "is-open" : ""}`} />
      </button>

      {abierto && (
        <div className="sap-cuerpo">
          <div className="omitidos-barra">
            <button className="btn btn--primary" onClick={() => onAnalizar(archivos)} disabled={ocupado}>
              Analizar los {archivos.length}
            </button>
            <button className="btn btn--ghost" onClick={() => onDescartar(archivos)} disabled={ocupado}>
              Quitar de la lista
            </button>
          </div>

          {lista.map(([producto, suyos]) => (
            <div className="omitidos-grupo" key={producto}>
              <div className="omitidos-grupo__cabecera">
                <strong>{producto}</strong>
                <span className="muted">
                  {suyos.length} {suyos.length === 1 ? "archivo" : "archivos"}
                </span>
                <button className="btn btn--ghost" onClick={() => onAnalizar(suyos)} disabled={ocupado}>
                  Analizar de nuevo
                </button>
              </div>

              <ul className="omitidos-lista">
                {suyos.map((a) => (
                  <li key={a.huella}>
                    <span className="omitidos-lista__archivo">{a.file.name}</span>
                    {a.previo?.lote && (
                      <span className="muted">
                        <IconLayers size={12} /> lote {a.previo.lote}
                        {a.previo.stage ? ` · ${a.previo.stage}` : ""}
                      </span>
                    )}
                    <button
                      className="omitidos-lista__quitar"
                      onClick={() => onDescartar([a])}
                      disabled={ocupado}
                      title="Quitar de la lista"
                    >
                      <IconClose size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
