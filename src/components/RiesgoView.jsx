import { useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconAlert, IconDownload, IconTrash } from "./Icons.jsx";
import { processPdfFile } from "../lib/parsers/index.js";
import { buildTable } from "../lib/model.js";
import { calcularIPR, clasificarSRI, filaVacia } from "../lib/riesgo/model.js";
import { analizarRiesgoConGemini } from "../lib/riesgo/analizarConGemini.js";
import { exportRiesgoToExcel } from "../lib/riesgo/exportRiesgo.js";

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

  function avisar(texto) {
    setAvisos((prev) => [...prev, texto]);
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

  async function generarBorrador() {
    setCargando(true);
    try {
      for (const [i, doc] of documentos.entries()) {
        const prefijo = documentos.length > 1 ? `${doc.etapa} (${i + 1} de ${documentos.length}) — ` : "";
        setBusyLabel(`${prefijo}redactando…`);
        try {
          const { errores } = await analizarRiesgoConGemini({
            producto: doc.producto,
            etapa: doc.etapa,
            parametros: doc.parametros,
            // Cada lote de Gemini tarda su rato — se pinta apenas llega, en
            // vez de tener el botón congelado varios minutos sin señales de
            // vida. Un lote que falla (ya reintentado una vez del otro lado)
            // no tira abajo el resto: sigue con los siguientes.
            onLote: (filasLote, hecho, total) => {
              setBusyLabel(`${prefijo}redactando… (lote ${hecho} de ${total})`);
              if (filasLote.length > 0) setFilas((prev) => [...prev, ...filasLote]);
            },
          });
          for (const err of errores) {
            avisar(
              `${doc.etapa}: no se pudo redactar el lote ${err.lote} de ${err.total} (${err.mensaje}) — el resto de la etapa sí se generó; puedes agregar esas filas a mano o volver a generar el borrador.`
            );
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
          Gemini para empezar y el mismo formato de siempre para exportar.
        </p>
      </div>

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
      </p>
    </div>
  );
}
