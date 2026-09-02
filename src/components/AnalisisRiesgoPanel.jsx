import { useMemo, useState } from "react";
import { IconAlert, IconChevronDown, IconDownload, IconFlask } from "./Icons.jsx";
import { calcularIPR, clasificarSRI, filaVacia } from "../lib/riesgo/model.js";
import { analizarRiesgoConGemini } from "../lib/riesgo/analizarConGemini.js";
import { exportRiesgoToExcel } from "../lib/riesgo/exportRiesgo.js";

/**
 * Arma el AMFE (Análisis de Modos de Fallo y Efectos) de la etapa activa.
 *
 * El punto de partida es un borrador que redacta Gemini a partir de los
 * parámetros críticos ya detectados —qué podría fallar en cada uno, por
 * qué, y con qué severidad/ocurrencia/detección—, pero ninguna fila se da
 * por buena sola: queda editable aquí mismo, y sólo se exporta lo que
 * alguien revisó. El cálculo de IPR y SRI no depende de la IA en ningún
 * momento — es aritmética (S×O×D) contra los cortes del procedimiento de
 * Humanova, la misma que lleva el Excel como fórmula.
 */
export default function AnalisisRiesgoPanel({ table, producto, etapa }) {
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const parametros = useMemo(() => {
    if (!table?.sections) return [];
    return table.sections.flatMap((s) =>
      s.rows
        .filter((r) => !r.banda && !r.enBlanco)
        .map((r) => ({ seccion: s.title, label: r.label, setpoint: r.setpoint, unit: r.unit }))
    );
  }, [table]);

  async function generarBorrador() {
    setError(null);
    setCargando(true);
    try {
      const nuevas = await analizarRiesgoConGemini({ producto, etapa, parametros });
      setFilas((prev) => [...prev, ...nuevas]);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  function agregarFilaVacia() {
    setFilas((prev) => [...prev, filaVacia({ proceso: etapa, actividad: "" })]);
  }

  function actualizarCampo(i, campo, valor) {
    setFilas((prev) => prev.map((f, idx) => (idx === i ? { ...f, [campo]: valor } : f)));
  }

  function quitarFila(i) {
    setFilas((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function exportar() {
    setError(null);
    try {
      const filasConProceso = filas.map((f) => ({ ...f, proceso: f.proceso || etapa }));
      const ok = await exportRiesgoToExcel(filasConProceso, { producto, etapa });
      if (!ok) setError("No hay filas para exportar.");
    } catch (e) {
      setError(e.message);
    }
  }

  if (!abierto) {
    return (
      <section className="card sap-panel sap-panel--riesgo sap-panel--cerrado">
        <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(true)}>
          <span className="sap-icono">
            <IconFlask size={16} />
          </span>
          <div>
            <strong>Análisis de riesgo (AMFE)</strong>
            <p className="muted">
              Arma la matriz de riesgo de calidad de la etapa activa, con un borrador de Gemini para empezar.
            </p>
          </div>
          <IconChevronDown size={16} className="sap-chevron" />
        </button>
      </section>
    );
  }

  return (
    <section className="card sap-panel sap-panel--riesgo">
      <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(false)} aria-expanded>
        <span className="sap-icono">
          <IconFlask size={16} />
        </span>
        <div>
          <strong>Análisis de riesgo (AMFE)</strong>
          <p className="muted">
            {etapa
              ? `${producto} · ${etapa} · ${parametros.length} parámetro(s) críticos disponibles`
              : "Elige un producto y una etapa para empezar."}
          </p>
        </div>
        <IconChevronDown size={16} className="sap-chevron is-open" />
      </button>

      <div className="sap-cuerpo">
        <div className="riesgo-acciones">
          <button className="btn btn--primary" onClick={generarBorrador} disabled={cargando || parametros.length === 0}>
            {cargando ? "Redactando con Gemini…" : "Generar borrador con IA"}
          </button>
          <button className="btn btn--ghost" onClick={agregarFilaVacia}>
            Agregar fila en blanco
          </button>
          <button className="btn btn--ghost" onClick={exportar} disabled={filas.length === 0}>
            <IconDownload size={14} /> Exportar a Excel
          </button>
        </div>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        {filas.length === 0 ? (
          <p className="muted">
            Sin filas todavía. El borrador de Gemini es un punto de partida — revisa y corrige cada modo de
            fallo, causa y control antes de exportar; ninguna fila se firma sola.
          </p>
        ) : (
          <div className="riesgo-tabla-wrap">
            <table className="riesgo-tabla">
              <thead>
                <tr>
                  <th>Actividad</th>
                  <th>Modo de fallo</th>
                  <th>Efecto</th>
                  <th>S</th>
                  <th>Causa</th>
                  <th>O</th>
                  <th>Controles existentes</th>
                  <th>D</th>
                  <th>IPR</th>
                  <th>SRI</th>
                  <th>Acciones a tomar</th>
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
      </div>
    </section>
  );
}
