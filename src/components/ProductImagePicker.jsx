import { useEffect, useRef, useState } from "react";
import { IconClose, IconSearch, IconUpload, IconLink, IconAlert, IconTrash } from "./Icons.jsx";
import { buscarImagenes, sugerenciasDeBusqueda } from "../lib/imageSearch.js";
import { imagenRemotaAPng, archivoAPng } from "../lib/productImage.js";

/**
 * Elegir la imagen que identifica a un producto, por tres vías:
 *
 *  1. Buscar en internet (Openverse y Wikimedia Commons, ambas de licencia
 *     reutilizable y sin clave de API).
 *  2. Subir un archivo del propio equipo — la vía fiable para la caja real
 *     del producto, que ningún buscador libre indexa.
 *  3. Pegar el enlace de una imagen.
 *
 * Sea cual sea la vía, la imagen se normaliza a un PNG cuadrado antes de
 * guardarse (ver lib/productImage.js).
 */
export default function ProductImagePicker({ familia, imagenActual, onGuardar, onQuitar, onCerrar }) {
  const [consulta, setConsulta] = useState(familia || "");
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [error, setError] = useState(null);
  const [aplicando, setAplicando] = useState(null);
  const [enlace, setEnlace] = useState("");
  const archivoRef = useRef(null);
  const dialogoRef = useRef(null);

  const sugerencias = sugerenciasDeBusqueda(familia);

  useEffect(() => {
    dialogoRef.current?.focus();
    function onKey(e) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  async function lanzarBusqueda(texto) {
    const q = (texto ?? consulta).trim();
    if (!q) return;
    setConsulta(q);
    setBuscando(true);
    setError(null);
    try {
      const { resultados: r, errores } = await buscarImagenes(q);
      setResultados(r);
      setBuscado(true);
      if (r.length === 0 && errores.length > 0) setError(errores[0]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBuscando(false);
    }
  }

  async function usar(promesa, clave) {
    setAplicando(clave);
    setError(null);
    try {
      const { dato } = await promesa;
      await onGuardar(dato);
      onCerrar();
    } catch (err) {
      setError(err.message);
    } finally {
      setAplicando(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar} role="presentation">
      <div
        className="modal modal--imagen"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Imagen de ${familia}`}
        tabIndex={-1}
        ref={dialogoRef}
      >
        <div className="modal__head">
          <div>
            <h2>Imagen del producto</h2>
            <p>{familia}</p>
          </div>
          <button className="icon-btn" onClick={onCerrar} aria-label="Cerrar">
            <IconClose size={18} />
          </button>
        </div>

        {imagenActual && (
          <div className="imagen-actual">
            <img src={imagenActual} alt={`Imagen actual de ${familia}`} />
            <div>
              <strong>Imagen actual</strong>
              <button
                className="btn btn--ghost btn--sm"
                onClick={async () => {
                  await onQuitar();
                  onCerrar();
                }}
              >
                <IconTrash size={14} /> Quitar y volver al icono
              </button>
            </div>
          </div>
        )}

        {/* 1 · Archivo propio, primero por ser el que siempre funciona */}
        <section className="picker-bloque">
          <h3 className="picker-bloque__titulo">
            <IconUpload size={14} /> Subir una imagen de tu equipo
          </h3>
          <p className="picker-bloque__ayuda">
            La vía más fiable: una foto o el arte de la caja. Se recorta en cuadrado y se guarda en PNG.
          </p>
          <input
            ref={archivoRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) usar(archivoAPng(file), "archivo");
            }}
          />
          <button
            className="btn btn--ghost"
            onClick={() => archivoRef.current?.click()}
            disabled={aplicando !== null}
          >
            {aplicando === "archivo" ? "Procesando…" : "Elegir archivo…"}
          </button>
        </section>

        {/* 2 · Buscar en internet */}
        <section className="picker-bloque">
          <h3 className="picker-bloque__titulo">
            <IconSearch size={14} /> Buscar en internet
          </h3>
          <p className="picker-bloque__ayuda">
            Busca en Openverse y Wikimedia Commons, que ofrecen imágenes de licencia reutilizable. No indexan
            marcas comerciales: si el nombre del producto no devuelve nada, prueba por principio activo o forma
            farmacéutica.
          </p>

          <form
            className="picker-buscador"
            onSubmit={(e) => {
              e.preventDefault();
              lanzarBusqueda();
            }}
          >
            <input
              type="search"
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              placeholder="Nombre, principio activo, forma farmacéutica…"
              aria-label="Qué buscar"
            />
            <button className="btn btn--primary" type="submit" disabled={buscando || !consulta.trim()}>
              {buscando ? "Buscando…" : "Buscar"}
            </button>
          </form>

          {sugerencias.length > 0 && (
            <div className="picker-sugerencias">
              <span className="muted">Prueba con:</span>
              {sugerencias.map((s) => (
                <button key={s} className="tab" onClick={() => lanzarBusqueda(s)} disabled={buscando}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {buscado && !buscando && resultados.length === 0 && (
            <p className="picker-vacio">
              <IconAlert size={14} /> Sin resultados para «{consulta}». Los buscadores de imágenes libres no
              incluyen marcas de laboratorio; sube una foto desde tu equipo o busca por principio activo.
            </p>
          )}

          {resultados.length > 0 && (
            <ul className="picker-resultados">
              {resultados.map((r) => (
                <li key={r.id}>
                  <button
                    className="picker-resultado"
                    onClick={() => usar(imagenRemotaAPng(r.url), r.id)}
                    disabled={aplicando !== null}
                    title={`${r.titulo}${r.autor ? ` — ${r.autor}` : ""}${r.licencia ? ` (${r.licencia})` : ""}`}
                  >
                    <img src={r.miniatura} alt={r.titulo} loading="lazy" />
                    <span className="picker-resultado__pie">
                      {aplicando === r.id ? "Guardando…" : r.licencia || r.origen}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 3 · Enlace directo */}
        <section className="picker-bloque">
          <h3 className="picker-bloque__titulo">
            <IconLink size={14} /> Pegar el enlace de una imagen
          </h3>
          <form
            className="picker-buscador"
            onSubmit={(e) => {
              e.preventDefault();
              if (enlace.trim()) usar(imagenRemotaAPng(enlace.trim()), "enlace");
            }}
          >
            <input
              type="url"
              value={enlace}
              onChange={(e) => setEnlace(e.target.value)}
              placeholder="https://…/imagen.png"
              aria-label="Enlace de la imagen"
            />
            <button className="btn btn--ghost" type="submit" disabled={!enlace.trim() || aplicando !== null}>
              {aplicando === "enlace" ? "Procesando…" : "Usar"}
            </button>
          </form>
        </section>

        {error && (
          <p className="picker-error">
            <IconAlert size={14} /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
