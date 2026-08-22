import { IconFlask, IconLayers, IconClock, IconPlus, IconTrash, IconImage } from "./Icons.jsx";
import { relativeDate } from "../lib/formatDate.js";

/**
 * Pantalla de inicio: un producto analizado por tarjeta, con lo necesario
 * para decidir si abrirlo o eliminarlo, y una tarjeta aparte para arrancar un
 * análisis nuevo sin mezclarlo con lo que ya había.
 */
export default function ProductLibrary({ productos, imagenes = {}, onOpen, onNew, onDelete, onCambiarImagen }) {
  return (
    <section className="library">
      <div className="library__head">
        <div>
          <h2>Tus análisis</h2>
          <p>Abre un producto guardado o empieza uno nuevo.</p>
        </div>
      </div>

      <div className="library__grid">
        <button className="library-card library-card--new" onClick={onNew}>
          <span className="library-card__plus">
            <IconPlus size={22} />
          </span>
          <strong>Nuevo análisis</strong>
          <span className="muted">Sube los PDF de un producto que aún no está aquí</span>
        </button>

        {productos.map((p) => (
          <div key={p.familia} className="library-card">
            <button className="library-card__body" onClick={() => onOpen(p.familia)}>
              <div className={`library-card__icon ${imagenes[p.familia] ? "library-card__icon--foto" : ""}`}>
                {imagenes[p.familia] ? (
                  <img src={imagenes[p.familia]} alt="" />
                ) : (
                  <IconFlask size={18} />
                )}
              </div>
              <strong className="library-card__title">{p.familia}</strong>

              <div className="library-card__meta">
                <span>
                  <IconLayers size={13} /> {p.etapas.join(" · ")}
                </span>
                <span>
                  {p.lotes.length} {p.lotes.length === 1 ? "lote" : "lotes"} · {p.totalParams} parám.
                </span>
                <span>
                  <IconClock size={13} /> {relativeDate(p.updatedAt)}
                </span>
              </div>
            </button>

            <div className="library-card__acciones">
              <button
                className="library-card__accion"
                onClick={(e) => {
                  e.stopPropagation();
                  onCambiarImagen(p.familia);
                }}
                title={`Cambiar la imagen de ${p.familia}`}
                aria-label={`Cambiar la imagen de ${p.familia}`}
              >
                <IconImage size={15} />
              </button>
              <button
                className="library-card__accion library-card__accion--borrar"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(p.familia);
                }}
                title={`Eliminar ${p.familia}`}
                aria-label={`Eliminar ${p.familia}`}
              >
                <IconTrash size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
