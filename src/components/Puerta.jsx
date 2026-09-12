import { useEffect, useState } from "react";
import { IconFlask, IconAlert } from "./Icons.jsx";
import { entrar, haceFaltaContrasena } from "../lib/acceso.js";

/**
 * La pantalla de contraseña, delante de la aplicación.
 *
 * Mientras se pregunta al servidor si hace falta contraseña no se dibuja
 * nada: enseñar la aplicación y taparla un instante después es peor que
 * esperar, porque en ese instante ya se vio.
 *
 * Sin contraseña configurada en el servidor, este componente no pinta nada y
 * la aplicación sale directamente, como siempre.
 *
 * Haber entrado vive aquí, en memoria, y en ningún otro sitio: al recargar o
 * al abrir otra pestaña se vuelve a pedir.
 */
export default function Puerta({ children }) {
  const [estado, setEstado] = useState("comprobando");
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);
  const [entrando, setEntrando] = useState(false);

  useEffect(() => {
    let vigente = true;
    haceFaltaContrasena().then((hace) => {
      if (vigente) setEstado(hace ? "pedir" : "abierto");
    });
    return () => {
      vigente = false;
    };
  }, []);

  async function probar(e) {
    e.preventDefault();
    if (!clave || entrando) return;
    setEntrando(true);
    setError(null);
    const r = await entrar(clave);
    setEntrando(false);
    if (r.ok) {
      setClave("");
      setEstado("dentro");
    } else {
      setError(r.error);
      setClave("");
    }
  }

  if (estado === "comprobando") {
    return (
      <div className="puerta">
        <p className="muted">Comprobando el acceso…</p>
      </div>
    );
  }

  if (estado === "abierto" || estado === "dentro") return children;

  return (
    <div className="puerta">
      <form className="puerta__caja" onSubmit={probar}>
        <span className="puerta__icono">
          <IconFlask size={26} />
        </span>
        <h1>Detección de Parámetros</h1>
        <p className="muted">Extracción y validación comparativa de registros de manufactura</p>

        <label className="puerta__campo">
          <span>Contraseña</span>
          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            autoFocus
            autoComplete="current-password"
            disabled={entrando}
          />
        </label>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        <button className="btn btn--primary" type="submit" disabled={!clave || entrando}>
          {entrando ? "Comprobando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
