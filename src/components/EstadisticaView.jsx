import { useCallback, useEffect, useRef, useState } from "react";
import Navegador from "./Navegador.jsx";
import WorkbookGrid from "./WorkbookGrid.jsx";
import AnalysisAssistant from "./AnalysisAssistant.jsx";
import OutputViewer from "./OutputViewer.jsx";
import DecisionFlow from "./DecisionFlow.jsx";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { exportarInformeWord } from "../lib/estadistica/exportar.js";
import { IconLayers, IconGrid, IconFlask, IconDownload } from "./Icons.jsx";

const ESPERA_MS = 12000;

function usePanelAutoOculto(activo) {
  const [plegado, setPlegado] = useState(false);
  const temporizador = useRef(null);
  const dentro = useRef(false);
  const reiniciar = useCallback(() => {
    clearTimeout(temporizador.current);
    setPlegado(false);
    if (!activo) return;
    temporizador.current = setTimeout(() => { if (!dentro.current) setPlegado(true); }, ESPERA_MS);
  }, [activo]);
  useEffect(() => {
    clearTimeout(temporizador.current);
    if (activo) temporizador.current = setTimeout(() => { if (!dentro.current) setPlegado(true); }, ESPERA_MS);
    return () => clearTimeout(temporizador.current);
  }, [activo]);
  const entrar = () => { dentro.current = true; clearTimeout(temporizador.current); };
  const salir = () => { dentro.current = false; reiniciar(); };
  return { plegado: activo && plegado, manejadores: { onMouseEnter: entrar, onMouseLeave: salir, onPointerDown: () => { setPlegado(false); entrar(); }, onFocusCapture: entrar, onBlurCapture: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) salir(); } } };
}

function TiraPanel({ nombre, icono, lado, onAbrir }) {
  return <button type="button" className={`stat-tira stat-tira--${lado}`} onClick={onAbrir} title={`Mostrar el ${nombre}`}>{icono}<span>{nombre}</span></button>;
}
function Lateral({ nombre, icono, plegado, manejadores, children }) {
  return <div className={`stat-lateral ${plegado ? "is-plegado" : ""}`} {...manejadores}><div className="stat-lateral__pestana" aria-hidden={!plegado}>{icono}<span>{nombre}</span></div><div className="stat-lateral__contenido">{children}</div></div>;
}

export default function EstadisticaView() {
  const temaClaro = useWorkbookStore((s) => s.temaClaro);
  const alternarTema = useWorkbookStore((s) => s.alternarTema);
  const paneles = useWorkbookStore((s) => s.paneles);
  const alternarPanel = useWorkbookStore((s) => s.alternarPanel);
  const resultados = useWorkbookStore((s) => s.resultados);
  const graficos = useWorkbookStore((s) => s.graficos);
  const seleccionActual = useWorkbookStore((s) => s.seleccionActual);
  const [exportando, setExportando] = useState(false);
  const [barraAbierta, setBarraAbierta] = useState(true);
  const [reparto, setReparto] = useState(() => { const guardado = Number(localStorage.getItem("deteccion-parametros:estadistica:reparto")); return Number.isFinite(guardado) && guardado >= 0.15 && guardado <= 0.9 ? guardado : 0.58; });
  const hayQueMostrar = seleccionActual != null;
  const repartoEfectivo = hayQueMostrar ? reparto : Math.min(reparto, 0.26);
  const cuerpoRef = useRef(null);
  const arrastrandoRef = useRef(false);
  const total = resultados.length + graficos.length;
  async function exportarTodo() { setExportando(true); try { await exportarInformeWord({ resultados, graficos }); } finally { setExportando(false); } }
  useEffect(() => {
    function mover(e) { if (!arrastrandoRef.current || !cuerpoRef.current) return; const caja = cuerpoRef.current.getBoundingClientRect(); setReparto(Math.min(0.9, Math.max(0.15, (e.clientY - caja.top) / caja.height))); }
    function soltar() { if (!arrastrandoRef.current) return; arrastrandoRef.current = false; document.body.classList.remove("esta-redimensionando"); }
    window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar);
    return () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
  }, []);
  useEffect(() => { try { localStorage.setItem("deteccion-parametros:estadistica:reparto", String(reparto)); } catch {} }, [reparto]);
  const navAuto = usePanelAutoOculto(paneles.auto && paneles.navegador);
  const asisAuto = usePanelAutoOculto(paneles.auto && paneles.asistente);
  const anchoLateral = (visible, plegado, ancho) => (!visible ? "26px" : plegado ? "30px" : ancho);
  const columnas = [anchoLateral(paneles.navegador, navAuto.plegado, "210px"), "minmax(0, 1fr)", anchoLateral(paneles.asistente, asisAuto.plegado, "290px")].join(" ");

  return <div className={`stat-shell ${temaClaro ? "stat-body--claro" : ""}`}>
    <div className={`stat-toolbar ${barraAbierta ? "" : "is-plegada"}`}>
      <button type="button" className="stat-toolbar__tirador" onClick={() => setBarraAbierta((v) => !v)} aria-expanded={barraAbierta}>{barraAbierta ? "▴" : "▾"}</button>
      <div className="stat-toolbar__grupo">
        <button type="button" className={`stat-toggle ${paneles.navegador ? "is-activo" : ""}`} onClick={() => alternarPanel("navegador")}><IconLayers size={14} /> Navegador</button>
        <button type="button" className={`stat-toggle ${paneles.hoja ? "is-activo" : ""}`} onClick={() => alternarPanel("hoja")}><IconGrid size={14} /> Hoja de trabajo</button>
        <button type="button" className={`stat-toggle ${paneles.asistente ? "is-activo" : ""}`} onClick={() => alternarPanel("asistente")}><IconFlask size={14} /> Asistente</button>
      </div>
      <div className="stat-toolbar__grupo stat-toolbar__grupo--fin">
        <button type="button" className={`stat-toggle ${paneles.auto ? "is-activo" : ""}`} onClick={() => alternarPanel("auto")} >⇤⇥ Ocultar solos</button>
        <button type="button" className="stat-toggle" onClick={alternarTema}>{temaClaro ? "☀️ Fondo claro" : "🌙 Fondo oscuro"}</button>
        <button type="button" className="btn btn--primary btn--mini" onClick={exportarTodo} disabled={total === 0 || exportando}><IconDownload size={14} />{exportando ? "Generando…" : `Exportar todo (${total})`}</button>
      </div>
    </div>
    <DecisionFlow />
    <div className="stat-body" style={{ "--stat-columnas": columnas }}>
      {paneles.navegador ? <Lateral nombre="Navegador" icono={<IconLayers size={14} />} {...navAuto}><Navegador /></Lateral> : <TiraPanel nombre="Navegador" icono={<IconLayers size={13} />} lado="izq" onAbrir={() => alternarPanel("navegador")} />}
      <div className="stat-main" ref={cuerpoRef}>
        <div className="stat-main__salida" style={paneles.hoja ? { flex: `${repartoEfectivo} 1 0` } : undefined}><OutputViewer /></div>
        {paneles.hoja && <><div className="stat-divisor" role="separator" aria-orientation="horizontal" aria-label="Ajustar la altura del gráfico y de la hoja" onPointerDown={(e) => { e.preventDefault(); arrastrandoRef.current = true; document.body.classList.add("esta-redimensionando"); }} onDoubleClick={() => setReparto(0.58)} /><div className="stat-main__hoja" style={{ flex: `${1 - repartoEfectivo} 1 0` }}><WorkbookGrid /></div></>}
      </div>
      {paneles.asistente ? <Lateral nombre="Asistente" icono={<IconFlask size={14} />} {...asisAuto}><AnalysisAssistant /></Lateral> : <TiraPanel nombre="Asistente" icono={<IconFlask size={13} />} lado="der" onAbrir={() => alternarPanel("asistente")} />}
    </div>
  </div>;
}
