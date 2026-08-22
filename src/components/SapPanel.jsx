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
import { claveLote } from "../lib/model.js";
import { esMuestraMedica } from "../lib/muestraMedica.js";

const ETIQUETAS = {
  ok: { texto: "Descargado", clase: "sap-marca--ok" },
  falta: { texto: "No está en SAP", clase: "sap-marca--falta" },
  error: { texto: "Error", clase: "sap-marca--mal" },
  omitido: { texto: "Omitido (MM)", clase: "sap-marca--falta" },
};

/**
 * Trae los RMD y las órdenes directamente de SAP, sin pasar por la descarga
 * manual ni por arrastrar archivos.
 *
 * El trabajo pesado lo hace un programa que corre en esta computadora: una
 * página web no puede manejar un Chrome, ni entrar a la red interna, ni usar
 * la sesión de SAP. Aquí sólo se le encarga y se recogen los resultados.
 */
/**
 * Misma clave que usa la aplicación para saber si un documento ya se analizó.
 * Incluye la marca de muestra médica: un lote trae a la vez producto de venta
 * y muestra ("...3g CJA x20" y "...3g CJA x2MM") en la misma etapa, y sin
 * distinguirlos analizar uno daría por analizado al otro.
 */
const claveDe = (a) =>
  `${claveLote({ lote: a.lote, producto: a.producto })}::${a.etapa}::${a.tipo === "OP" ? "orden" : "registro"}`;

export default function SapPanel({ onArchivos, ocupado, analizados = new Set(), omitirMM = false }) {
  const [base, setBase] = useState(null);
  const [buscando, setBuscando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [lotes, setLotes] = useState("");
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [analizando, setAnalizando] = useState(false);
  const [enDisco, setEnDisco] = useState([]);
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
        const nuevo = await pedirEstado(base);
        setEstado((previo) => {
          // La carpeta sólo se relee cuando cambia el número de documentos
          // resueltos o al terminar, para no pedirla cada segundo.
          const cambio =
            (previo?.resultados?.length ?? -1) !== nuevo.resultados.length || previo?.fase !== nuevo.fase;
          if (cambio) listarArchivos(base).then(setEnDisco).catch(() => {});
          return nuevo;
        });
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
      await pedirDescarga(base, lotes, omitirMM);
    } catch (err) {
      setError(err.message);
    }
  }

  async function analizar() {
    setError(null);
    setAnalizando(true);
    try {
      // Se manda sólo lo que aún no está en el análisis: reprocesar lo ya
      // cargado no aporta nada y cuesta varios segundos por documento.
      const pendientes = (await listarArchivos(base)).filter(
        (a) => !analizados.has(claveDe(a)) && !(omitirMM && esMuestraMedica(a.producto))
      );
      if (pendientes.length === 0) {
        setError("Todo lo descargado ya está analizado.");
        return;
      }
      const ficheros = [];
      for (const a of pendientes) ficheros.push(await traerPdf(base, a));
      await onArchivos(ficheros);
      setEnDisco(await listarArchivos(base).catch(() => enDisco));
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

  // El fallo del trabajo llega por el estado, no por la petición: sin
  // mostrarlo, una tanda que falla se veía exactamente igual que una que no
  // había empezado.
  const fallo = error || (estado?.fase === "error" ? estado.error : null);

  // Lo que hay en la carpeta y todavía no está en el análisis.
  // Se descuentan también las muestras médicas cuando están omitidas: si no,
  // el botón invitaría a analizar documentos que después se descartan.
  const sinAnalizar = enDisco.filter(
    (a) => !analizados.has(claveDe(a)) && !(omitirMM && esMuestraMedica(a.producto))
  );

  const subtitulo = trabajando
    ? estado.mensaje || "Trabajando…"
    : estado?.fase === "error"
      ? "La última tanda no pudo completarse."
      : estado?.fase === "terminado"
        ? estado.mensaje
        : "Conectado con el ayudante de descargas.";

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
          <p className="muted">{subtitulo}</p>
        </div>
        {trabajando && <span className="sap-girador" aria-hidden="true" />}
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
              disabled={trabajando || analizando || ocupado || sinAnalizar.length === 0}
              title={
                sinAnalizar.length === 0 && enDisco.length > 0
                  ? "Todo lo que hay descargado ya está en el análisis"
                  : undefined
              }
            >
              {analizando
                ? "Analizando…"
                : enDisco.length === 0
                  ? "Analizar lo descargado"
                  : sinAnalizar.length === 0
                    ? "Todo analizado"
                    : `Analizar ${sinAnalizar.length} documento${sinAnalizar.length === 1 ? "" : "s"}`}
            </button>
            {nLotes > 0 && <span className="counter">{nLotes === 1 ? "1 lote" : `${nLotes} lotes`}</span>}
          </div>

          {trabajando && (
            <div className="sap-progreso">
              <span className="sap-girador" aria-hidden="true" />
              <div>
                <strong>{estado.mensaje || "Trabajando…"}</strong>
                <p className="muted">
                  {estado.lotes?.length > 1
                    ? `Lote ${estado.indice || 1} de ${estado.lotes.length}. `
                    : ""}
                  Cada lote tarda alrededor de un minuto: se abren seis documentos en SAP, uno por uno.
                </p>
              </div>
            </div>
          )}

          {fallo && (
            <p className="sap-error">
              <IconAlert size={14} /> {fallo}
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
                            {r.estado === "ok" && analizados.has(claveDe(r)) ? (
                              <span className="sap-analizado">ya analizado</span>
                            ) : null}
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
