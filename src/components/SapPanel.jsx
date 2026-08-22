import { useCallback, useEffect, useRef, useState } from "react";
import { IconCloud, IconDownload, IconCheck, IconAlert, IconChevronDown } from "./Icons.jsx";
import {
  buscarAyudante,
  pedirEstado,
  pedirDescarga,
  listarArchivos,
  traerPdf,
  contarLotes,
} from "../lib/sapLocal.js";

const ETIQUETAS = {
  ok: { texto: "Descargado", clase: "sap-marca--ok" },
  falta: { texto: "No está en SAP", clase: "sap-marca--falta" },
  error: { texto: "Error", clase: "sap-marca--mal" },
};

/**
 * Trae los RMD y las órdenes directamente de SAP, sin pasar por la descarga
 * manual ni por arrastrar archivos.
 *
 * El trabajo pesado lo hace un programa que corre en esta computadora: una
 * página web no puede manejar un Chrome, ni entrar a la red interna, ni usar
 * la sesión de SAP. Aquí sólo se le encarga y se recogen los resultados.
 */
export default function SapPanel({ onArchivos, ocupado }) {
  const [base, setBase] = useState(null);
  const [buscando, setBuscando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [lotes, setLotes] = useState("");
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [analizando, setAnalizando] = useState(false);
  const sondeo = useRef(null);

  const aplicar = useCallback((encontrada) => {
    setBase(encontrada);
    setBuscando(false);
    if (encontrada) setAbierto(true);
  }, []);

  // Reintento manual desde el botón; ahí sí procede volver a "buscando".
  const detectar = useCallback(async () => {
    setBuscando(true);
    aplicar(await buscarAyudante());
  }, [aplicar]);

  // Al montar ya se arranca en "buscando", así que sólo se aplica el
  // resultado cuando llega.
  useEffect(() => {
    let vigente = true;
    buscarAyudante().then((encontrada) => {
      if (vigente) aplicar(encontrada);
    });
    return () => {
      vigente = false;
    };
  }, [aplicar]);

  // Mientras hay una tanda en marcha se pregunta el avance cada segundo.
  useEffect(() => {
    if (!base || !abierto) return undefined;

    const tic = async () => {
      try {
        setEstado(await pedirEstado(base));
      } catch {
        setBase(null); // se cerró la ventana del ayudante
      }
    };

    tic();
    sondeo.current = setInterval(tic, 1000);
    return () => clearInterval(sondeo.current);
  }, [base, abierto]);

  async function descargar() {
    setError(null);
    try {
      await pedirDescarga(base, lotes);
    } catch (err) {
      setError(err.message);
    }
  }

  async function analizar() {
    setError(null);
    setAnalizando(true);
    try {
      const archivos = await listarArchivos(base);
      if (archivos.length === 0) {
        setError("Todavía no hay PDF descargados.");
        return;
      }
      const ficheros = [];
      for (const a of archivos) ficheros.push(await traerPdf(base, a));
      await onArchivos(ficheros);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalizando(false);
    }
  }

  const trabajando = estado?.fase === "descargando" || estado?.fase === "esperandoLogin";
  const nLotes = contarLotes(lotes);
  const resultados = estado?.resultados || [];
  const cuenta = (e) => resultados.filter((r) => r.estado === e).length;

  if (buscando) return null;

  // Sin ayudante abierto se explica cómo abrirlo, sin ocupar sitio.
  if (!base) {
    return (
      <section className="card sap-panel sap-panel--cerrado">
        <div className="sap-cabecera">
          <span className="sap-icono">
            <IconCloud size={16} />
          </span>
          <div>
            <strong>Traer lotes desde SAP</strong>
            <p className="muted">
              Abre <code>APLICACION.bat</code> en <code>herramientas/sap-descargas</code> y vuelve aquí.
            </p>
          </div>
          <button className="btn btn--ghost" onClick={detectar}>
            Buscar de nuevo
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card sap-panel">
      <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        <span className="sap-icono sap-icono--activo">
          <IconCloud size={16} />
        </span>
        <div>
          <strong>Traer lotes desde SAP</strong>
          <p className="muted">
            {trabajando ? estado.mensaje : "Conectado con el ayudante de descargas."}
          </p>
        </div>
        <IconChevronDown size={16} className={`sap-chevron ${abierto ? "is-open" : ""}`} />
      </button>

      {abierto && (
        <div className="sap-cuerpo">
          <label className="field__label" htmlFor="sap-lotes">
            Lotes que quieres traer
          </label>
          <textarea
            id="sap-lotes"
            className="sap-textarea"
            value={lotes}
            onChange={(e) => setLotes(e.target.value)}
            placeholder={"Pega aquí los lotes, uno por línea\n\n2058836\n2018796"}
            disabled={trabajando}
          />

          <div className="sap-acciones">
            <button className="btn btn--primary" onClick={descargar} disabled={trabajando || nLotes === 0}>
              <IconDownload size={16} />
              {trabajando ? "Descargando…" : "Descargar de SAP"}
            </button>
            <button
              className="btn btn--ghost"
              onClick={analizar}
              disabled={trabajando || analizando || ocupado}
            >
              {analizando ? "Analizando…" : "Analizar lo descargado"}
            </button>
            {nLotes > 0 && <span className="counter">{nLotes === 1 ? "1 lote" : `${nLotes} lotes`}</span>}
          </div>

          {error && (
            <p className="sap-error">
              <IconAlert size={14} /> {error}
            </p>
          )}

          {resultados.length > 0 && (
            <>
              <div className="sap-resumen">
                <span className="sap-pastilla sap-pastilla--ok">{cuenta("ok")} descargados</span>
                <span className="sap-pastilla sap-pastilla--falta">{cuenta("falta")} no están en SAP</span>
                {cuenta("error") > 0 && (
                  <span className="sap-pastilla sap-pastilla--mal">{cuenta("error")} con error</span>
                )}
              </div>

              <div className="sap-tabla-scroll">
                <table className="sap-tabla">
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th>Producto</th>
                      <th>Etapa</th>
                      <th>Doc.</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultados.map((r, i) => {
                      const marca = ETIQUETAS[r.estado] || { texto: r.estado, clase: "" };
                      return (
                        <tr key={`${r.lote}-${r.etapa}-${r.tipo}-${i}`}>
                          <td className="sap-mono">{r.lote}</td>
                          <td>{r.producto}</td>
                          <td>{r.etapa}</td>
                          <td className="sap-mono">{r.tipo}</td>
                          <td>
                            <span className={`sap-marca ${marca.clase}`}>
                              {r.estado === "ok" ? <IconCheck size={13} /> : null} {marca.texto}
                            </span>
                            {r.detalle ? <span className="muted"> ({r.detalle})</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
