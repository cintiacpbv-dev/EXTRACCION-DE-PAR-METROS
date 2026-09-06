import { useCallback, useEffect, useRef, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconAlert, IconDownload, IconTrash, IconLayers, IconCheck } from "./Icons.jsx";
import { processPdfFile } from "../lib/parsers/index.js";
import { buildTable } from "../lib/model.js";
import { calcularIPR, clasificarSRI, filaVacia } from "../lib/riesgo/model.js";
import { analizarRiesgoConGemini } from "../lib/riesgo/analizarConGemini.js";
import { verificarFilasConBibliografia } from "../lib/riesgo/verificarConBibliografia.js";
import { exportRiesgoToExcel } from "../lib/riesgo/exportRiesgo.js";
import { abrirAnalisis, analisisDesde, borrarAnalisis, guardarAnalisis, listarHistorial } from "../lib/riesgo/historial.js";
import { relativeDate } from "../lib/formatDate.js";

/**
 * Análisis de riesgo (AMFE), como sección propia — no depende de haber
 * analizado nada en Detección de Parámetros.
 *
 * El registro que se sube aquí suele ser una plantilla sin llenar: lo único
 * que hace falta de él es su estructura (qué parámetros existen, en qué
 * etapa, con qué criterio de aceptación), no valores de un lote real. Por
 * eso se procesa con el mismo detector de siempre, pero pidiendo sólo los
 * parámetros y descartando el resto (personal, lote, insumos).
 */

function parametrosDe(resultado) {
  const doc = {
    ...resultado,
    producto: resultado.meta.producto || "PRODUCTO SIN IDENTIFICAR",
    lote: resultado.meta.lote || "SIN LOTE",
    familia: resultado.meta.producto || "PRODUCTO SIN IDENTIFICAR",
  };
  const table = buildTable([doc], doc.familia, doc.stage, { onlyCritical: true });
  const parametros = table.sections.flatMap((s) =>
    s.rows
      .filter((r) => !r.banda && !r.enBlanco)
      .map((r) => ({ seccion: s.title, label: r.label, setpoint: r.setpoint, unit: r.unit }))
  );
  return { producto: doc.producto, etapa: doc.stage, parametros };
}

export default function RiesgoView() {
  const [documentos, setDocumentos] = useState([]); // [{ id, fileName, producto, etapa, parametros }]
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  // Una lista, no un único mensaje: si Fabricación sale bien y Envase falla,
  // el aviso de Envase no debe tapar el resultado de Fabricación, y ambos
  // tienen que poder verse a la vez.
  const [avisos, setAvisos] = useState([]);
  // Cruzar el borrador contra la bibliografía (Consulta PDF) va activado: es
  // lo que separa un borrador plausible de uno con respaldo citable. Se puede
  // apagar para una pasada rápida, o cuando esa aplicación está caída.
  const [corroborar, setCorroborar] = useState(true);

  // El historial de análisis guardados, y cuál de ellos es el que se está
  // editando ahora mismo. `analisisId` es lo que hace que las correcciones
  // sigan cayendo sobre el mismo registro en vez de crear uno nuevo en cada
  // guardado.
  const [historial, setHistorial] = useState([]);
  const [analisisId, setAnalisisId] = useState(null);
  const [creado, setCreado] = useState(null);
  const [guardadoEn, setGuardadoEn] = useState(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  function avisar(texto) {
    setAvisos((prev) => [...prev, texto]);
  }

  const refrescarHistorial = useCallback(async () => {
    setHistorial(await listarHistorial());
  }, []);

  useEffect(() => {
    refrescarHistorial();
  }, [refrescarHistorial]);

  // Lo que hay en pantalla, para poder guardarlo sin que el temporizador de
  // más abajo tenga que depender de cada cambio y reprogramarse solo.
  const estadoRef = useRef({ filas, documentos, analisisId, creado });
  estadoRef.current = { filas, documentos, analisisId, creado };

  /**
   * Guarda el cuadro tal como está, creando el registro la primera vez y
   * actualizándolo después.
   *
   * Guardar es automático a propósito: lo que se pierde al recargar no es el
   * borrador de la IA —ese se puede volver a pedir— sino las correcciones
   * hechas a mano encima, que son el trabajo de verdad. Un botón de "guardar"
   * que hay que acordarse de pulsar las perdería igual.
   */
  const guardarAhora = useCallback(async () => {
    const { filas: f, documentos: docs, analisisId: id, creado: c } = estadoRef.current;
    if (f.length === 0) return;

    const analisis = analisisDesde({
      id,
      producto: docs[0]?.producto || "",
      etapas: [...new Set(docs.map((d) => d.etapa))].join(" / "),
      filas: f,
      creado: c,
    });

    if (!id) {
      setAnalisisId(analisis.id);
      setCreado(analisis.creado);
    }

    const res = await guardarAnalisis(analisis);
    setGuardadoEn(analisis.actualizado);
    if (!res.ok) {
      avisar(
        `El análisis se guardó en este navegador, pero no en la nube: ${res.error}. ¿Falta ejecutar supabase_migration_v14.sql?`
      );
    }
    refrescarHistorial();
  }, [refrescarHistorial]);

  // Las correcciones se guardan solas, pero no en cada tecla: se espera a que
  // quien escribe haga una pausa. Sin esa espera, escribir un modo de fallo
  // largo dispararía una escritura por letra.
  const temporizadorRef = useRef(null);
  useEffect(() => {
    if (filas.length === 0) return;
    clearTimeout(temporizadorRef.current);
    temporizadorRef.current = setTimeout(guardarAhora, 1500);
    return () => clearTimeout(temporizadorRef.current);
  }, [filas, guardarAhora]);

  async function abrirDelHistorial(id) {
    const analisis = await abrirAnalisis(id);
    if (!analisis) {
      avisar("No se pudo abrir ese análisis: puede que se haya borrado desde otra computadora.");
      refrescarHistorial();
      return;
    }
    setFilas(analisis.filas || []);
    setAnalisisId(analisis.id);
    setCreado(analisis.creado);
    setGuardadoEn(analisis.actualizado);
    setHistorialAbierto(false);
    // Los documentos no se restauran —son los PDF que se subieron entonces—,
    // pero su producto y etapa sí, para que el cuadro siga sabiendo de qué
    // habla al exportarlo.
    setDocumentos(
      analisis.producto
        ? [{ id: `historial::${analisis.id}`, fileName: "", producto: analisis.producto, etapa: analisis.etapas, parametros: [] }]
        : []
    );
  }

  async function eliminarDelHistorial(id, nombre) {
    const ok = window.confirm(
      `¿Eliminar el análisis de riesgo "${nombre}"? Se borra de este navegador y de la nube, y no se puede deshacer.`
    );
    if (!ok) return;

    const res = await borrarAnalisis(id);
    if (!res.ok) {
      avisar(`No se pudo borrar de la nube: ${res.error}. Se quitó de este navegador.`);
    }
    // Si era el que estaba abierto, la pantalla se queda en blanco: seguir
    // mostrando un cuadro que ya no existe invita a seguir editándolo para
    // nada.
    if (id === analisisId) empezarUnoNuevo();
    refrescarHistorial();
  }

  function empezarUnoNuevo() {
    clearTimeout(temporizadorRef.current);
    setFilas([]);
    setAnalisisId(null);
    setCreado(null);
    setGuardadoEn(null);
    setDocumentos([]);
    setAvisos([]);
  }

  async function cargarRegistros(files) {
    setCargando(true);
    try {
      const nuevos = [];
      for (const [i, file] of files.entries()) {
        setBusyLabel(`Leyendo ${file.name} (${i + 1} de ${files.length})…`);
        try {
          const resultado = await processPdfFile(file);
          if (resultado.kind !== "registro") {
            avisar(`${file.name} es una Orden de Producción, no un Registro de Manufactura — se omitió.`);
            continue;
          }
          const { producto, etapa, parametros } = parametrosDe(resultado);
          if (parametros.length === 0) {
            avisar(`${file.name}: no se detectó ningún parámetro crítico en ${etapa || "esta etapa"}.`);
            continue;
          }
          nuevos.push({ id: `${file.name}::${Date.now()}::${i}`, fileName: file.name, producto, etapa, parametros });
        } catch (e) {
          avisar(`${file.name}: ${e.message}`);
        }
      }
      setDocumentos((prev) => [...prev, ...nuevos]);
    } finally {
      setCargando(false);
      setBusyLabel("");
    }
  }

  function quitarDocumento(id) {
    setDocumentos((prev) => prev.filter((d) => d.id !== id));
  }

  /**
   * Cruza contra la bibliografía las filas recién redactadas de una etapa y
   * escribe las citas en "Documentos relacionados".
   *
   * Sólo rellena casillas vacías: si alguien ya anotó ahí un POE a mano, esa
   * anotación manda sobre lo que traiga la bibliografía.
   */
  async function corroborarConBibliografia(filasNuevas, doc, prefijo) {
    if (filasNuevas.length === 0) return;

    setBusyLabel(`${prefijo}corroborando con la bibliografía… (0 de ${filasNuevas.length} filas)`);

    const { confirmadas, motivoFallo, formatoDesconocido } = await verificarFilasConBibliografia(
      filasNuevas,
      {
        producto: doc.producto,
        etapa: doc.etapa,
        onFila: ({ id, documentos: citas }) => {
          setFilas((prev) =>
            prev.map((f) => (f.id === id && !f.documentos ? { ...f, documentos: citas } : f))
          );
        },
        onAvance: (hechas, total) => {
          setBusyLabel(`${prefijo}corroborando con la bibliografía… (${hechas} de ${total} filas)`);
        },
      }
    );

    // Que NINGUNA fila encuentre respaldo no es un dato del análisis: casi
    // siempre significa que la bibliografía no respondió o que no tiene nada
    // de este proceso. Se avisa una vez, sin tocar el cuadro — que sigue
    // completo y utilizable, como cuando esta corroboración no existía.
    if (confirmadas === 0 && motivoFallo) {
      avisar(
        `${doc.etapa}: no se pudo corroborar el borrador contra la bibliografía (${motivoFallo}) — el cuadro se generó igual y puedes completar "Documentos relacionados" a mano.`
      );
    }

    if (formatoDesconocido?.length) {
      avisar(
        `${doc.etapa}: la bibliografía respondió en un formato que no se reconoció (campos: ${formatoDesconocido.join(", ")}).`
      );
    }
  }

  async function generarBorrador() {
    setCargando(true);
    try {
      for (const [i, doc] of documentos.entries()) {
        const prefijo = documentos.length > 1 ? `${doc.etapa} (${i + 1} de ${documentos.length}) — ` : "";
        let generadas = 0;
        setBusyLabel(`${prefijo}redactando… (0 de ${doc.parametros.length} parámetros)`);
        try {
          const { filas: filasDeLaEtapa, errores } = await analizarRiesgoConGemini({
            producto: doc.producto,
            etapa: doc.etapa,
            parametros: doc.parametros,
            // Varios lotes de Gemini corren a la vez — se pintan conforme
            // van llegando, en vez de tener el botón congelado varios
            // minutos sin señales de vida. El conteo es de PARÁMETROS, no
            // de lotes: es la cifra que dice de verdad si falta mucho o
            // está por terminar, y evita bajar el Excel a mitad de camino
            // pensando que ya está completo. Un lote que falla (ya
            // reintentado una vez del otro lado) no tira abajo el resto.
            onLote: (filasLote) => {
              generadas += filasLote.length;
              setBusyLabel(`${prefijo}redactando… (${generadas} de ${doc.parametros.length} parámetros)`);
              if (filasLote.length > 0) setFilas((prev) => [...prev, ...filasLote]);
            },
          });
          for (const err of errores) {
            avisar(
              `${doc.etapa}: no se pudo redactar el lote ${err.lote} de ${err.total} (${err.mensaje}) — el resto de la etapa sí se generó; puedes agregar esas filas a mano o volver a generar el borrador.`
            );
          }

          // La corroboración va DESPUÉS de redactar, sobre las filas ya
          // escritas: así el cuadro completo aparece cuanto antes y el cruce
          // con la bibliografía sólo le añade las citas encima.
          if (corroborar) {
            await corroborarConBibliografia(filasDeLaEtapa, doc, prefijo);
          }
        } catch (e) {
          avisar(`${doc.etapa}: ${e.message}`);
        }
      }
    } finally {
      setCargando(false);
      setBusyLabel("");
    }
  }

  function agregarFilaVacia() {
    const etapa = documentos[0]?.etapa || "";
    setFilas((prev) => [...prev, filaVacia({ proceso: etapa, actividad: "" })]);
  }

  function actualizarCampo(i, campo, valor) {
    setFilas((prev) => prev.map((f, idx) => (idx === i ? { ...f, [campo]: valor } : f)));
  }

  function quitarFila(i) {
    setFilas((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function exportar() {
    // El borrador de una etapa con muchos parámetros tarda varios minutos:
    // exportar a mitad de camino es válido (parte del cuadro, revisado, es
    // mejor que nada), pero que sea porque se eligió, no porque no se notó
    // que todavía faltaba.
    if (cargando) {
      const seguir = window.confirm(
        `Todavía se está redactando el borrador (${busyLabel}). ¿Exportar solo lo que ya se generó?`
      );
      if (!seguir) return;
    }
    try {
      const producto = documentos[0]?.producto || "Producto";
      const etapas = [...new Set(documentos.map((d) => d.etapa))].join(" / ");
      const ok = await exportRiesgoToExcel(filas, { producto, etapa: etapas });
      if (!ok) avisar("No hay filas para exportar.");
    } catch (e) {
      avisar(e.message);
    }
  }

  return (
    <div className="riesgo-view">
      <div className="riesgo-view__intro">
        <h1>Análisis de riesgo (AMFE)</h1>
        <p className="muted">
          Sube el Registro de Manufactura de cada etapa —puede ser la plantilla sin llenar, no hace falta un
          lote real— y arma la Matriz de Identificación y Evaluación de Riesgo de Calidad, con un borrador de
          Gemini para empezar y el mismo formato de siempre para exportar. Lo que trabajes se guarda solo:
          queda en el historial y puedes volver a abrirlo o eliminarlo cuando quieras.
        </p>
      </div>

      <section className="riesgo-historial">
        <div className="riesgo-historial__barra">
          <button
            className="btn btn--ghost"
            onClick={() => setHistorialAbierto((v) => !v)}
            aria-expanded={historialAbierto}
          >
            <IconLayers size={14} />
            Historial ({historial.length})
          </button>

          {filas.length > 0 && (
            <>
              <button className="btn btn--ghost" onClick={empezarUnoNuevo}>
                Nuevo análisis
              </button>
              <span className="muted riesgo-historial__estado">
                {guardadoEn ? (
                  <>
                    <IconCheck size={13} /> Guardado {relativeDate(guardadoEn)}
                  </>
                ) : (
                  "Sin guardar todavía"
                )}
              </span>
            </>
          )}
        </div>

        {historialAbierto && (
          <div className="riesgo-historial__lista">
            {historial.length === 0 ? (
              <p className="muted">
                Todavía no hay análisis guardados. En cuanto generes o edites un cuadro, aparecerá aquí solo.
              </p>
            ) : (
              <ul>
                {historial.map((a) => (
                  <li key={a.id} className={a.id === analisisId ? "is-abierto" : ""}>
                    <button
                      className="riesgo-historial__abrir"
                      onClick={() => abrirDelHistorial(a.id)}
                      title="Abrir este análisis"
                    >
                      <strong>{a.nombre || a.producto || "Sin producto"}</strong>
                      <span className="muted">
                        {a.filas_total ?? a.filas?.length ?? 0} filas · {relativeDate(a.actualizado)}
                        {a.id === analisisId ? " · abierto ahora" : ""}
                      </span>
                    </button>
                    <button
                      className="btn btn--ghost btn--icon"
                      onClick={() => eliminarDelHistorial(a.id, a.nombre || a.producto)}
                      title="Eliminar este análisis"
                    >
                      <IconTrash size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <UploadZone
        onFiles={cargarRegistros}
        busy={cargando}
        busyLabel={busyLabel}
        compact={documentos.length > 0}
        title="Registros de Manufactura (PDF) — uno por etapa"
        compactTitle="Agregar otro registro"
        hint="Sirve la plantilla sin llenar: sólo hace falta la estructura de parámetros, no valores de un lote."
      />

      {avisos.length > 0 && (
        <div className="riesgo-avisos">
          {avisos.map((texto, i) => (
            <p key={i} className="protocolo-error">
              <IconAlert size={14} /> {texto}
            </p>
          ))}
          <button className="btn btn--ghost btn--icon" onClick={() => setAvisos([])} title="Descartar avisos">
            Descartar avisos
          </button>
        </div>
      )}

      {documentos.length > 0 && (
        <div className="riesgo-docs">
          {documentos.map((d) => (
            <span key={d.id} className="riesgo-doc-chip">
              <strong>{d.etapa}</strong> · {d.parametros.length} parám. · {d.producto}
              <button onClick={() => quitarDocumento(d.id)} title="Quitar">
                <IconTrash size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="riesgo-acciones">
        <button
          className="btn btn--primary"
          onClick={generarBorrador}
          disabled={cargando || documentos.length === 0}
        >
          {cargando ? busyLabel || "Trabajando…" : "Generar borrador con IA"}
        </button>
        <button className="btn btn--ghost" onClick={agregarFilaVacia}>
          Agregar fila en blanco
        </button>
        <button className="btn btn--ghost" onClick={exportar} disabled={filas.length === 0}>
          <IconDownload size={14} /> Exportar a Excel
        </button>

        <label
          className="riesgo-corroborar"
          title="Cada fila redactada se consulta contra la bibliografía de Consulta PDF; cuando hay respaldo, la cita se escribe en «Documentos relacionados». Lo que no encuentre respaldo se queda tal cual."
        >
          <input
            type="checkbox"
            checked={corroborar}
            onChange={(e) => setCorroborar(e.target.checked)}
            disabled={cargando}
          />
          Corroborar con la bibliografía
        </label>
      </div>

      {filas.length === 0 ? (
        <p className="muted">
          Sin filas todavía. Sube uno o más registros y genera el borrador, o arma el cuadro a mano con
          "Agregar fila en blanco".
        </p>
      ) : (
        <div className="riesgo-tabla-wrap">
          <table className="riesgo-tabla">
            <thead>
              <tr>
                <th>Etapa</th>
                <th>Actividad</th>
                <th>Modo de fallo</th>
                <th>Efecto</th>
                <th>S</th>
                <th>Causa</th>
                <th>O</th>
                <th>Controles existentes</th>
                <th>Documentos relacionados</th>
                <th>D</th>
                <th>IPR</th>
                <th>SRI</th>
                <th>Acciones a tomar</th>
                <th>Responsable(s)</th>
                <th>Plazo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const ipr = calcularIPR(f.severidad, f.ocurrencia, f.deteccion);
                const sri = clasificarSRI(ipr);
                return (
                  <tr key={f.id || i}>
                    <td>
                      <input value={f.proceso} onChange={(e) => actualizarCampo(i, "proceso", e.target.value)} />
                    </td>
                    <td>
                      <input value={f.actividad} onChange={(e) => actualizarCampo(i, "actividad", e.target.value)} />
                    </td>
                    <td>
                      <textarea
                        value={f.modoFallo}
                        onChange={(e) => actualizarCampo(i, "modoFallo", e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea value={f.efecto} onChange={(e) => actualizarCampo(i, "efecto", e.target.value)} />
                    </td>
                    <td className="riesgo-col-num">
                      <select value={f.severidad} onChange={(e) => actualizarCampo(i, "severidad", e.target.value)}>
                        <option value="" />
                        {[1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <textarea value={f.causa} onChange={(e) => actualizarCampo(i, "causa", e.target.value)} />
                    </td>
                    <td className="riesgo-col-num">
                      <select value={f.ocurrencia} onChange={(e) => actualizarCampo(i, "ocurrencia", e.target.value)}>
                        <option value="" />
                        {[1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <textarea
                        value={f.controles}
                        onChange={(e) => actualizarCampo(i, "controles", e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        value={f.documentos}
                        placeholder="POE, instructivo…"
                        onChange={(e) => actualizarCampo(i, "documentos", e.target.value)}
                      />
                    </td>
                    <td className="riesgo-col-num">
                      <select value={f.deteccion} onChange={(e) => actualizarCampo(i, "deteccion", e.target.value)}>
                        <option value="" />
                        {[1, 2, 3, 4, 5].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="riesgo-col-num">
                      <strong>{ipr || ""}</strong>
                    </td>
                    <td className="riesgo-col-num">
                      {sri && <span className={`riesgo-sri riesgo-sri--${sri.toLowerCase()}`}>{sri}</span>}
                    </td>
                    <td>
                      <textarea
                        value={f.accionesATomar}
                        onChange={(e) => actualizarCampo(i, "accionesATomar", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={f.responsable}
                        placeholder="Nombre"
                        onChange={(e) => actualizarCampo(i, "responsable", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        value={f.plazo}
                        placeholder="AAAA-MM"
                        onChange={(e) => actualizarCampo(i, "plazo", e.target.value)}
                      />
                    </td>
                    <td>
                      <button className="btn btn--ghost btn--icon" onClick={() => quitarFila(i)} title="Quitar fila">
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted riesgo-nota">
        El borrador de Gemini es un punto de partida — revisa y corrige cada modo de fallo, causa y control
        antes de exportar. Conforme subas más registros, este análisis se puede volver a generar y afinar.
        Con la corroboración activada, cada fila se consulta contra la bibliografía y, cuando ésta la
        respalda, la cita aparece en "Documentos relacionados"; lo que no encuentre respaldo se queda tal
        como se redactó.
      </p>
    </div>
  );
}
