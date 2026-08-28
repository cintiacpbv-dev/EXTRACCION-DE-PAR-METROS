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
import { claveLote, compararEtapas } from "../lib/model.js";
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

/**
 * Agrupa lo descargado por lote + producto + etapa, que es la unidad en la
 * que se decide analizar o no: la OP y el RMD de un mismo paso van juntos, no
 * se elige uno sin el otro.
 */
function agruparPorLote(archivos, { analizados, omitirMM }) {
  const grupos = new Map();

  for (const a of archivos) {
    if (omitirMM && esMuestraMedica(a.producto)) continue;
    const clave = `${a.lote}::${a.producto}::${a.etapa}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { clave, lote: a.lote, producto: a.producto, etapa: a.etapa, op: null, rmd: null });
    }
    const g = grupos.get(clave);
    if (a.tipo === "OP") g.op = a;
    else if (a.tipo === "RMD") g.rmd = a;
  }

  for (const g of grupos.values()) {
    g.opAnalizada = g.op ? analizados.has(claveDe(g.op)) : null;
    g.rmdAnalizado = g.rmd ? analizados.has(claveDe(g.rmd)) : null;
    // Pendiente si algo de lo que hay (OP, RMD, o ambos) todavía no se cargó.
    g.pendiente = (g.op && !g.opAnalizada) || (g.rmd && !g.rmdAnalizado);
    // Un paso sólo está completo cuando están descargados sus dos documentos.
    // Con uno solo el análisis sale cojo —sin la OP no hay lote ME de los
    // materiales ni rendimiento oficial; sin el RMD no hay parámetros—, así
    // que el marcado automático lo deja fuera. Marcarlo a mano sigue siendo
    // posible: a veces se quiere adelantar con lo que hay.
    g.completo = Boolean(g.op && g.rmd);
  }

  return [...grupos.values()].sort(
    (a, b) => a.lote.localeCompare(b.lote) || compararEtapas(a.etapa, b.etapa) || a.producto.localeCompare(b.producto)
  );
}

/** Celda de la columna OP/RMD: si no está descargado, si lo está, o si ya se cargó al análisis. */
function celdaDoc(archivo, analizado) {
  if (!archivo) return <span className="muted">—</span>;
  return (
    <span className={`sap-marca ${analizado ? "sap-marca--ok" : ""}`}>
      <IconCheck size={13} /> {analizado ? "Analizado" : "Descargado"}
    </span>
  );
}

export default function SapPanel({ onArchivos, ocupado, analizados = new Set(), omitirMM = false }) {
  const [base, setBase] = useState(null);
  const [buscando, setBuscando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [lotes, setLotes] = useState("");
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [analizando, setAnalizando] = useState(false);
  const [enDisco, setEnDisco] = useState([]);
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [filtroLote, setFiltroLote] = useState("");
  const seleccionInicial = useRef(false);
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

  // Lo descargado, agrupado por lote + producto + etapa: es la unidad en la
  // que se decide analizar, porque la OP y el RMD de un mismo paso van juntos.
  const grupos = agruparPorLote(enDisco, { analizados, omitirMM });
  const grupoDeClave = new Map(grupos.map((g) => [g.clave, g]));

  // Lo que el marcado automático propone: lo que falta por analizar y tiene
  // sus dos documentos. Un paso al que le falta la OP o el RMD no se marca
  // solo — se analizaría a medias sin que nadie lo hubiera decidido.
  const automarcables = grupos.filter((g) => g.pendiente && g.completo);

  // La primera vez que aparece algo pendiente se marca por defecto, para que
  // el flujo de un clic siga funcionando sin obligar a marcar uno por uno; a
  // partir de ahí la selección la decide quien la vaya tocando, y no se
  // vuelve a pisar en cada sondeo del avance.
  useEffect(() => {
    if (seleccionInicial.current) return;
    if (automarcables.length === 0) return;
    setSeleccion(new Set(automarcables.map((g) => g.clave)));
    seleccionInicial.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enDisco]);

  function alternarSeleccion(clave) {
    setSeleccion((previa) => {
      const s = new Set(previa);
      if (s.has(clave)) s.delete(clave);
      else s.add(clave);
      return s;
    });
  }

  function seleccionarPendientes() {
    setSeleccion(new Set(automarcables.map((g) => g.clave)));
  }

  function limpiarSeleccion() {
    setSeleccion(new Set());
  }

  async function analizar() {
    setError(null);
    setAnalizando(true);
    try {
      const objetivo = [...seleccion].map((c) => grupoDeClave.get(c)).filter(Boolean);
      const archivos = objetivo.flatMap((g) => [g.op, g.rmd].filter(Boolean));
      if (archivos.length === 0) {
        setError("Marca al menos un lote de la lista para analizar.");
        return;
      }

      // Los archivos de SAP se llaman por el número del documento, que no
      // dice nada mientras se espera. Aquí sí se sabe a qué lote y etapa
      // corresponde cada uno, así que se manda para que la barra de avance
      // pueda decirlo.
      const etiquetas = {};
      for (const g of objetivo) {
        for (const a of [g.op, g.rmd]) {
          if (a) etiquetas[a.nombre] = `Lote ${g.lote} · ${g.etapa} · ${a.tipo}`;
        }
      }

      const ficheros = [];
      for (const a of archivos) ficheros.push(await traerPdf(base, a));
      await onArchivos(ficheros, { etiquetas });
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

  // Cuántos documentos (OP + RMD) hay detrás de lo marcado, para que el botón
  // diga lo mismo que antes decía ("Analizar N documentos") pero sobre la
  // selección en vez de sobre todo lo pendiente.
  const archivosSeleccionados = [...seleccion]
    .map((c) => grupoDeClave.get(c))
    .filter(Boolean)
    .flatMap((g) => [g.op, g.rmd].filter(Boolean));

  const pendientesTotal = automarcables.length;
  // Los que faltan por analizar pero les falta un documento: no se marcan
  // solos, y conviene decir cuántos son para que no parezca que se perdieron.
  const incompletosTotal = grupos.filter((g) => g.pendiente && !g.completo).length;

  const grupoCoincide = (g) => !filtroLote.trim() || g.lote.toLowerCase().includes(filtroLote.trim().toLowerCase());
  const gruposVisibles = grupos.filter(grupoCoincide);

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
              disabled={trabajando || analizando || ocupado || archivosSeleccionados.length === 0}
              title={
                enDisco.length === 0
                  ? "Todavía no hay nada descargado"
                  : archivosSeleccionados.length === 0
                    ? "Marca en la lista de abajo qué lotes analizar"
                    : undefined
              }
            >
              {analizando
                ? "Analizando…"
                : enDisco.length === 0
                  ? "Analizar lo descargado"
                  : `Analizar ${archivosSeleccionados.length} documento${archivosSeleccionados.length === 1 ? "" : "s"}`}
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

          {enDisco.length > 0 && (
            <div className="sap-seleccion">
              <div className="sap-seleccion__cabecera">
                <div>
                  <strong>Elige qué analizar</strong>
                  <p className="muted">
                    Lote, producto y etapa de lo descargado, con si tiene OP y RMD. Marca los que quieras
                    analizar. Los que no tengan los dos documentos no se marcan solos.
                  </p>
                </div>
                <input
                  type="search"
                  className="sap-filtro"
                  placeholder="Filtrar por lote…"
                  value={filtroLote}
                  onChange={(e) => setFiltroLote(e.target.value)}
                  aria-label="Filtrar la lista por lote"
                />
              </div>

              <div className="sap-acciones sap-acciones--compactas">
                <button className="btn btn--ghost btn--sm" onClick={seleccionarPendientes} type="button">
                  Marcar lo pendiente{pendientesTotal > 0 ? ` (${pendientesTotal})` : ""}
                </button>
                <button className="btn btn--ghost btn--sm" onClick={limpiarSeleccion} type="button">
                  Quitar selección
                </button>
                <span className="counter">
                  {seleccion.size === 0
                    ? "Nada marcado"
                    : `${seleccion.size} de ${grupos.length} marcado${seleccion.size === 1 ? "" : "s"}`}
                  {incompletosTotal > 0 &&
                    ` · ${incompletosTotal} sin OP o sin RMD, fuera del marcado automático`}
                </span>
              </div>

              <div className="sap-tabla-scroll">
                <table className="sap-tabla">
                  <thead>
                    <tr>
                      <th aria-hidden="true"></th>
                      <th>Lote</th>
                      <th>Producto</th>
                      <th>Etapa</th>
                      <th>OP</th>
                      <th>RMD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gruposVisibles.map((g) => (
                      <tr
                        key={g.clave}
                        className={[
                          seleccion.has(g.clave) ? "is-seleccionado" : "",
                          g.completo ? "" : "is-incompleto",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={seleccion.has(g.clave)}
                            onChange={() => alternarSeleccion(g.clave)}
                            aria-label={`Analizar el lote ${g.lote}, etapa ${g.etapa}`}
                          />
                        </td>
                        <td className="sap-mono">{g.lote}</td>
                        <td>{g.producto}</td>
                        <td>{g.etapa}</td>
                        <td>{celdaDoc(g.op, g.opAnalizada)}</td>
                        <td>{celdaDoc(g.rmd, g.rmdAnalizado)}</td>
                      </tr>
                    ))}
                    {gruposVisibles.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted">
                          Ningún lote coincide con &quot;{filtroLote}&quot;.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
