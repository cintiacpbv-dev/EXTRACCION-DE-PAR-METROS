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
            <IconPlus size={26} />
          </span>
          <div className="library-card__info">
            <strong>Nuevo análisis</strong>
            <span className="muted">Sube los PDF de un producto que aún no está aquí</span>
          </div>
        </button>

        {productos.map((p) => (
          <div key={p.familia} className="library-card">
            {/* La imagen manda en la tarjeta: ocupa el primer plano a la
                izquierda y el resto de los datos se ordenan a su derecha. */}
            <button className="library-card__body" onClick={() => onOpen(p.familia)}>
              <div className={`library-card__icon ${imagenes[p.familia] ? "library-card__icon--foto" : ""}`}>
                {imagenes[p.familia] ? (
                  <img src={imagenes[p.familia]} alt="" />
                ) : (
                  <IconFlask size={28} />
                )}
              </div>

              <div className="library-card__info">
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
