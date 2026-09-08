import { useMemo, useState } from "react";
import "./DecisionFlow.css";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { estadisticaDescriptiva } from "../lib/estadistica/descriptiva.js";
import { pruebaNormalidad } from "../lib/estadistica/normalidad.js";
import { graficaIndividuosMR, capacidadProceso } from "../lib/estadistica/spc.js";
import { detectarOutliers } from "../lib/estadistica/outliers.js";
import { evaluarCalidadDatos } from "../lib/estadistica/calidadDatos.js";
import { compararLotes } from "../lib/estadistica/comparacion.js";
import { regresionLinealSimple, regresionLinealMultiple } from "../lib/estadistica/regresion.js";

const PASOS = [["datos", "Datos"], ["calidad", "Calidad de datos"], ["descriptivos", "Descriptivos"], ["distribucion", "Distribución"], ["outliers", "Outliers"], ["medicion", "Sistema de medición"], ["estabilidad", "Estabilidad"], ["capacidad", "Capacidad"], ["lotes", "Comparación de lotes"], ["correlacion", "Correlación / regresión"], ["criticas", "Variables críticas / DOE"], ["conclusion", "Conclusión"], ["informe", "Informe"]];
const estadoClase = { FAVORABLE: "ok", "REQUIERE REVISIÓN": "warn", "NO FAVORABLE": "bad", "NO APTO": "bad", "NO EVALUADO": "idle" };
function numero(x) { return x == null || Number.isNaN(x) ? "—" : Number(x.toFixed(4)).toLocaleString("es-PE", { maximumFractionDigits: 4 }); }

export default function DecisionFlow() {
  const columns = useWorkbookStore((s) => s.columns);
  const registrarResultado = useWorkbookStore((s) => s.registrarResultado);
  const [lsl, setLsl] = useState(""); const [usl, setUsl] = useState(""); const [target, setTarget] = useState("");
  const [abierto, setAbierto] = useState(true); const [ejecutados, setEjecutados] = useState({});
  const numericas = useMemo(() => columns.filter((c) => c.type === "numeric" && c.values.some((v) => Number.isFinite(v))), [columns]);
  const calidad = useMemo(() => evaluarCalidadDatos(columns), [columns]);
  const principal = numericas[0];

  function ejecutar(id) {
    if (!principal && !["datos", "calidad", "medicion", "informe", "conclusion"].includes(id)) return;
    let resultado;
    if (id === "descriptivos") resultado = numericas.map((c) => ({ variable: c.name, ...estadisticaDescriptiva(c.values) }));
    if (id === "distribucion") resultado = pruebaNormalidad(principal.values);
    if (id === "outliers") resultado = detectarOutliers(principal.values);
    if (id === "estabilidad") resultado = graficaIndividuosMR(principal.values);
    if (id === "capacidad") resultado = capacidadProceso(principal.values, { lsl: lsl === "" ? null : Number(lsl), usl: usl === "" ? null : Number(usl) });
    if (id === "lotes") resultado = compararLotes(numericas);
    if (id === "correlacion") resultado = numericas.length < 2 ? { error: "Hacen falta al menos dos variables numéricas." } : regresionLinealSimple(numericas[0].values, numericas[1].values);
    if (id === "criticas") resultado = numericas.length < 2 ? { error: "Hacen falta al menos dos variables numéricas para evaluar asociación." } : regresionLinealMultiple(numericas.slice(0, Math.min(4, numericas.length - 1)), numericas[Math.min(4, numericas.length - 1)].values);
    if (["datos", "calidad", "medicion", "conclusion", "informe"].includes(id)) resultado = { estado: id === "datos" ? (principal ? "FAVORABLE" : "NO APTO") : id === "calidad" ? calidad.estado : "NO EVALUADO" };
    if (!resultado) return;
    setEjecutados((s) => ({ ...s, [id]: resultado }));
    registrarResultado(`Flujo estadístico — ${PASOS.find((p) => p[0] === id)?.[1] || id}`, { encabezados: ["Método", "Resultado"], filas: [[id, JSON.stringify(resultado)]] }, resultado.error ? [resultado.error] : []);
  }

  const estabilidadEstado = ejecutados.estabilidad ? (ejecutados.estabilidad.error ? "REQUIERE REVISIÓN" : (ejecutados.estabilidad.individuos.puntos.some((p) => p.fuera) || ejecutados.estabilidad.rangoMovil.puntos.some((p) => p.fuera) ? "NO FAVORABLE" : "FAVORABLE")) : "NO EVALUADO";
  const estados = { datos: numericas.length ? "FAVORABLE" : "NO APTO", calidad: calidad.estado, descriptivos: ejecutados.descriptivos ? "FAVORABLE" : "NO EVALUADO", distribucion: ejecutados.distribucion ? (ejecutados.distribucion.error ? "REQUIERE REVISIÓN" : "FAVORABLE") : "NO EVALUADO", outliers: ejecutados.outliers ? (ejecutados.outliers.error ? "REQUIERE REVISIÓN" : ejecutados.outliers.atipicos.length ? "REQUIERE REVISIÓN" : "FAVORABLE") : "NO EVALUADO", medicion: "NO EVALUADO", estabilidad: estabilidadEstado, capacidad: ejecutados.capacidad ? (estabilidadEstado === "NO FAVORABLE" ? "REQUIERE REVISIÓN" : ejecutados.capacidad.error ? "REQUIERE REVISIÓN" : "FAVORABLE") : "NO EVALUADO", lotes: ejecutados.lotes ? "FAVORABLE" : "NO EVALUADO", correlacion: ejecutados.correlacion ? "FAVORABLE" : "NO EVALUADO", criticas: ejecutados.criticas ? "REQUIERE REVISIÓN" : "NO EVALUADO", conclusion: "NO EVALUADO", informe: "NO EVALUADO" };
  const conclusion = useMemo(() => { if (!principal || calidad.estado === "NO APTO") return "NO CONCLUYENTE"; if (estabilidadEstado === "NO FAVORABLE") return "REQUIERE REVISIÓN"; if (ejecutados.capacidad?.error) return "NO CONCLUYENTE"; return ejecutados.descriptivos ? "FAVORABLE" : "NO CONCLUYENTE"; }, [principal, calidad.estado, ejecutados, estabilidadEstado]);

  return <section style={{ margin: "10px 12px 0", border: "1px solid var(--border, #d7dce2)", borderRadius: 12, background: "var(--panel, #fff)", overflow: "hidden" }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderBottom: abierto ? "1px solid var(--border, #d7dce2)" : "none" }}>
      <div><strong>Flujo de decisión estadística</strong><div className="decision-flow-note">Datos → calidad → descriptivos → distribución → estabilidad → capacidad → lotes → conclusión</div></div>
      <button type="button" className="stat-toggle" onClick={() => setAbierto((v) => !v)}>{abierto ? "Ocultar" : "Mostrar"}</button>
    </header>
    {abierto && <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 10 }}>{PASOS.map(([id, nombre]) => <button key={id} type="button" onClick={() => ejecutar(id)} className="stat-toggle decision-flow-step"><span className={`decision-dot decision-dot--${estadoClase[estados[id]]}`}></span>{nombre}<small style={{ marginLeft: 5, opacity: .65 }}>{estados[id]}</small></button>)}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", padding: "0 12px 10px" }}>
        <label style={{ fontSize: 12 }}>LSL<input className="decision-flow-input" value={lsl} onChange={(e) => setLsl(e.target.value)} type="number" /></label>
        <label style={{ fontSize: 12 }}>USL<input className="decision-flow-input" value={usl} onChange={(e) => setUsl(e.target.value)} type="number" /></label>
        <label style={{ fontSize: 12 }}>Target<input className="decision-flow-input" value={target} onChange={(e) => setTarget(e.target.value)} type="number" /></label>
        <div className="decision-flow-note">Variable principal: <b>{principal?.name || "—"}</b> · n={principal ? principal.values.filter(Number.isFinite).length : 0}</div>
      </div>
      <div className="decision-flow-grid">
        <div className="decision-flow-summary"><b>Calidad:</b> {calidad.estado} · variables {calidad.variables.length}</div>
        <div className="decision-flow-summary"><b>Conclusión provisional:</b> {conclusion}. No equivale a “validado”.</div>
        {ejecutados.distribucion && !ejecutados.distribucion.error && <div className="decision-flow-summary"><b>Normalidad:</b> AD={numero(ejecutados.distribucion.ad)} · p={numero(ejecutados.distribucion.valorP)}</div>}
        {ejecutados.outliers && !ejecutados.outliers.error && <div className="decision-flow-summary"><b>Outliers:</b> {ejecutados.outliers.atipicos.length} detectados · revisar, no eliminar automáticamente.</div>}
        {ejecutados.estabilidad && !ejecutados.estabilidad.error && <div className="decision-flow-summary"><b>I-MR:</b> {estabilidadEstado}. Revisar causas especiales antes de interpretar capacidad.</div>}
        {ejecutados.capacidad && !ejecutados.capacidad.error && <div className="decision-flow-summary"><b>Capacidad:</b> Cp={numero(ejecutados.capacidad.cp)} Cpk={numero(ejecutados.capacidad.cpk)} Pp={numero(ejecutados.capacidad.pp)} Ppk={numero(ejecutados.capacidad.ppk)}</div>}
        {ejecutados.lotes && !ejecutados.lotes.error && <div className="decision-flow-summary"><b>Lotes:</b> ANOVA p={numero(ejecutados.lotes.anova?.valorP)} · Welch p={numero(ejecutados.lotes.welch?.valorP)} · Kruskal p={numero(ejecutados.lotes.kruskal?.valorP)}</div>}
        {ejecutados.correlacion && !ejecutados.correlacion.error && <div className="decision-flow-summary"><b>Regresión:</b> R²={numero(ejecutados.correlacion.r2)} · p pendiente={numero(ejecutados.correlacion.p)}</div>}
      </div>
    </>}
  </section>;
}
