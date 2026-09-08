import { useCallback, useEffect, useRef, useState } from "react";
import Navegador from "./Navegador.jsx";
import WorkbookGrid from "./WorkbookGrid.jsx";
import AnalysisAssistant from "./AnalysisAssistant.jsx";
import OutputViewer from "./OutputViewer.jsx";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { exportarInformeWord } from "../lib/estadistica/exportar.js";
import { IconLayers, IconGrid, IconFlask, IconDownload } from "./Icons.jsx";

// Cuánto espera un panel lateral sin que lo toquen antes de plegarse. Corto
// molesta —se cierra mientras se está pensando qué columna elegir—; largo no
// llega a devolver el sitio nunca. Doce segundos es el tiempo que pasa entre
// pedir un análisis y ponerse a mirar el resultado.
const ESPERA_MS = 12000;

/**
 * Un panel que se pliega solo cuando lleva un rato sin usarse.
 *
 * "Usarse" es tener el ratón encima, o el teclado dentro: mientras se escribe
 * en el Asistente o se recorre la lista del Navegador, el reloj no corre. Y
 * plegado no quiere decir cerrado — queda una pestaña, basta pasar por encima
 * para asomarlo (ver .stat-lateral en App.css).
 */
function usePanelAutoOculto(activo) {
  const [plegado, setPlegado] = useState(false);
  const temporizador = useRef(null);
  const dentro = useRef(false);

  const reiniciar = useCallback(() => {
    clearTimeout(temporizador.current);
    setPlegado(false);
    if (!activo) return;
    temporizador.current = setTimeout(() => {
      // Se comprueba otra vez al vencer el plazo: el ratón pudo entrar
      // mientras corría, y plegarle el panel debajo del cursor a alguien que
      // lo está usando es justo lo que no debe pasar.
      if (!dentro.current) setPlegado(true);
    }, ESPERA_MS);
  }, [activo]);

  // El reloj arranca al montar y cada vez que se apaga o enciende la
  // preferencia. No se despliega nada desde aquí: con la preferencia apagada
  // el panel se ve abierto porque así se calcula abajo, sin tener que
  // corregir el estado desde un efecto.
  useEffect(() => {
    clearTimeout(temporizador.current);
    if (activo) {
      temporizador.current = setTimeout(() => {
        if (!dentro.current) setPlegado(true);
      }, ESPERA_MS);
    }
    return () => clearTimeout(temporizador.current);
  }, [activo]);

  const entrar = () => {
    dentro.current = true;
    clearTimeout(temporizador.current);
  };

  const salir = () => {
    dentro.current = false;
    reiniciar();
  };

  const manejadores = {
    onMouseEnter: entrar,
    onMouseLeave: salir,
    // Al hacer clic dentro, el panel se despliega del todo y recupera su
    // columna: se está trabajando en él, y no debe desaparecer al apartar el
    // ratón un momento.
    onPointerDown: () => {
      setPlegado(false);
      entrar();
    },
    onFocusCapture: entrar,
    onBlurCapture: (e) => {
      // Moverse entre los campos del propio panel no es salir de él.
      if (e.currentTarget.contains(e.relatedTarget)) return;
      salir();
    },
  };

  // Con la preferencia apagada el panel se ve siempre abierto, sin tener que
  // ir a corregir el estado guardado: si se vuelve a encender, el panel
  // recuerda cómo estaba.
  return { plegado: activo && plegado, manejadores };
}

/**
 * La tira que queda en el borde cuando un panel está cerrado del todo.
 *
 * Sin ella, cerrar el Asistente y plegar después la barra de arriba dejaba el
 * panel sin ninguna forma de volver: los dos interruptores vivían en la misma
 * barra. Ahora el panel deja siempre su rótulo en el canto, como los paneles
 * acoplados de Minitab.
 */
function TiraPanel({ nombre, icono, lado, onAbrir }) {
  return (
    <button type="button" className={`stat-tira stat-tira--${lado}`} onClick={onAbrir} title={`Mostrar el ${nombre}`}>
      {icono}
      <span>{nombre}</span>
    </button>
  );
}

/** El panel lateral con su pestaña, para cuando está plegado. */
function Lateral({ nombre, icono, plegado, manejadores, children }) {
  return (
    <div className={`stat-lateral ${plegado ? "is-plegado" : ""}`} {...manejadores}>
      <div className="stat-lateral__pestana" aria-hidden={!plegado}>
        {icono}
        <span>{nombre}</span>
      </div>
      <div className="stat-lateral__contenido">{children}</div>
    </div>
  );
}

/**
 * Análisis Estadístico (estilo Minitab), como sección propia — no depende
 * de nada de Detección de Parámetros ni de Análisis de Riesgo: los datos
 * los trae la propia persona, pegados, tecleados o importados de un CSV o
 * un Excel.
 *
 * El acomodo copia el de Minitab: el Navegador (lista de lo generado) a la
 * izquierda, el resultado elegido en grande arriba, la hoja de trabajo
 * abajo, y a la derecha el Asistente — que en Minitab son los menús con sus
 * cuadros de diálogo, aquí un panel fijo porque no hay equivalente directo.
 *
 * Los tres paneles se pueden cerrar desde la barra de arriba. No es un
 * adorno: en una pantalla de portátil, con los tres abiertos, al gráfico le
 * queda la mitad del ancho, y un gráfico es justo lo que se viene a mirar
 * en grande.
 */
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
  // Qué parte de la altura se lleva el gráfico. Lo mueve la persona con el
  // divisor, y se recuerda: quien mira sobre todo gráficos lo deja arriba, y
  // quien está tecleando datos lo baja.
  const [reparto, setReparto] = useState(() => {
    const guardado = Number(localStorage.getItem("deteccion-parametros:estadistica:reparto"));
    return Number.isFinite(guardado) && guardado >= 0.15 && guardado <= 0.9 ? guardado : 0.58;
  });
  // Con el visor vacío no tiene sentido darle más de media pantalla a un
  // cartel que dice "elige columnas": esa altura es de la hoja, que es donde
  // se está trabajando. En cuanto hay un resultado o un gráfico, el reparto
  // vuelve al que haya puesto la persona con el divisor.
  const hayQueMostrar = seleccionActual != null;
  const repartoEfectivo = hayQueMostrar ? reparto : Math.min(reparto, 0.26);

  const cuerpoRef = useRef(null);
  const arrastrandoRef = useRef(false);
  const total = resultados.length + graficos.length;

  async function exportarTodo() {
    setExportando(true);
    try {
      await exportarInformeWord({ resultados, graficos });
    } finally {
      setExportando(false);
    }
  }

  // El divisor: se arrastra y reparte la altura entre el gráfico y la hoja.
  useEffect(() => {
    function mover(e) {
      if (!arrastrandoRef.current || !cuerpoRef.current) return;
      const caja = cuerpoRef.current.getBoundingClientRect();
      const fraccion = (e.clientY - caja.top) / caja.height;
      // Se acota para que ninguno de los dos pueda desaparecer del todo: para
      // eso está el interruptor de la barra, no el divisor.
      const acotada = Math.min(0.9, Math.max(0.15, fraccion));
      setReparto(acotada);
    }
    function soltar() {
      if (!arrastrandoRef.current) return;
      arrastrandoRef.current = false;
      document.body.classList.remove("esta-redimensionando");
    }
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("deteccion-parametros:estadistica:reparto", String(reparto));
    } catch {
      // Sin memoria del navegador se vuelve al reparto de siempre.
    }
  }, [reparto]);

  const navAuto = usePanelAutoOculto(paneles.auto && paneles.navegador);
  const asisAuto = usePanelAutoOculto(paneles.auto && paneles.asistente);

  // Las columnas de la rejilla se arman con los paneles que estén abiertos:
  // un panel cerrado no deja su hueco vacío, se lo queda el visor. Uno
  // plegado deja sólo el ancho de su pestaña.
  const anchoLateral = (visible, plegado, ancho) => (!visible ? "26px" : plegado ? "30px" : ancho);
  const columnas = [
    anchoLateral(paneles.navegador, navAuto.plegado, "210px"),
    "minmax(0, 1fr)",
    anchoLateral(paneles.asistente, asisAuto.plegado, "290px"),
  ].join(" ");

  return (
    <div className={`stat-shell ${temaClaro ? "stat-body--claro" : ""}`}>
      <div className={`stat-toolbar ${barraAbierta ? "" : "is-plegada"}`}>
        <button
          type="button"
          className="stat-toolbar__tirador"
          onClick={() => setBarraAbierta((v) => !v)}
          aria-expanded={barraAbierta}
          title={barraAbierta ? "Ocultar la barra" : "Mostrar la barra"}
        >
          {barraAbierta ? "▴" : "▾"}
        </button>

        <div className="stat-toolbar__grupo">
          <button
            type="button"
            className={`stat-toggle ${paneles.navegador ? "is-activo" : ""}`}
            onClick={() => alternarPanel("navegador")}
            aria-pressed={paneles.navegador}
            title="Mostrar u ocultar el Navegador"
          >
            <IconLayers size={14} /> Navegador
          </button>
          <button
            type="button"
            className={`stat-toggle ${paneles.hoja ? "is-activo" : ""}`}
            onClick={() => alternarPanel("hoja")}
            aria-pressed={paneles.hoja}
            title="Mostrar u ocultar la hoja de trabajo"
          >
            <IconGrid size={14} /> Hoja de trabajo
          </button>
          <button
            type="button"
            className={`stat-toggle ${paneles.asistente ? "is-activo" : ""}`}
            onClick={() => alternarPanel("asistente")}
            aria-pressed={paneles.asistente}
            title="Mostrar u ocultar el Asistente"
          >
            <IconFlask size={14} /> Asistente
          </button>
        </div>

        <div className="stat-toolbar__grupo stat-toolbar__grupo--fin">
          <button
            type="button"
            className={`stat-toggle ${paneles.auto ? "is-activo" : ""}`}
            onClick={() => alternarPanel("auto")}
            aria-pressed={paneles.auto}
            title="Plegar solos el Navegador y el Asistente cuando lleven un rato sin usarse. Pasa el ratón por su pestaña para asomarlos."
          >
            ⇤⇥ Ocultar solos
          </button>
          <button
            type="button"
            className="stat-toggle"
            onClick={alternarTema}
            aria-pressed={temaClaro}
            title="Cambiar entre fondo claro y oscuro (los gráficos van siempre en claro, para imprimirlos)"
          >
            {temaClaro ? "☀️ Fondo claro" : "🌙 Fondo oscuro"}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--mini"
            onClick={exportarTodo}
            disabled={total === 0 || exportando}
            title="Descarga un Word con todas las tablas y todos los gráficos de esta sesión"
          >
            <IconDownload size={14} />
            {exportando ? "Generando…" : `Exportar todo (${total})`}
          </button>
        </div>
      </div>

      {/* Las columnas van por variable y no como "grid-template-columns" en
          línea: un estilo en línea gana siempre, y en el móvil dejaba las
          tres columnas de escritorio apretadas en 390 px de ancho, sin que la
          media query pudiera apilarlas. */}
      <div className="stat-body" style={{ "--stat-columnas": columnas }}>
        {paneles.navegador ? (
          <Lateral nombre="Navegador" icono={<IconLayers size={14} />} {...navAuto}>
            <Navegador />
          </Lateral>
        ) : (
          <TiraPanel nombre="Navegador" icono={<IconLayers size={13} />} lado="izq" onAbrir={() => alternarPanel("navegador")} />
        )}
        <div className="stat-main" ref={cuerpoRef}>
          <div className="stat-main__salida" style={paneles.hoja ? { flex: `${repartoEfectivo} 1 0` } : undefined}>
            <OutputViewer />
          </div>

          {paneles.hoja && (
            <>
              {/* El divisor: se arrastra para dar más altura al gráfico o a la
                  hoja. Es una línea y no un panel con botones porque lo único
                  que hace es moverse. */}
              <div
                className="stat-divisor"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Ajustar la altura del gráfico y de la hoja"
                onPointerDown={(e) => {
                  e.preventDefault();
                  arrastrandoRef.current = true;
                  document.body.classList.add("esta-redimensionando");
                }}
                onDoubleClick={() => setReparto(0.58)}
                title="Arrastra para repartir la altura. Doble clic para volver al reparto de siempre."
              />
              <div className="stat-main__hoja" style={{ flex: `${1 - repartoEfectivo} 1 0` }}>
                <WorkbookGrid />
              </div>
            </>
          )}
        </div>
        {paneles.asistente ? (
          <Lateral nombre="Asistente" icono={<IconFlask size={14} />} {...asisAuto}>
            <AnalysisAssistant />
          </Lateral>
        ) : (
          <TiraPanel nombre="Asistente" icono={<IconFlask size={13} />} lado="der" onAbrir={() => alternarPanel("asistente")} />
        )}
      </div>
    </div>
  );
}
