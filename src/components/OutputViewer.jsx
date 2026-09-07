import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { descargarGraficoPng, descargarTablaCsv, tablaComoTexto } from "../lib/estadistica/exportar.js";
import { IconAlert, IconMessageSquare, IconDownload, IconCopy, IconCheck, IconClose } from "./Icons.jsx";

function TablaResultado({ contenido }) {
  return (
    <div className="resultado-tabla-wrap">
      <table className="resultado-tabla">
        <thead>
          <tr>
            {contenido.encabezados.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contenido.filas.map((fila, i) => (
            <tr key={i}>
              {fila.map((valor, j) => (
                <td key={j}>{valor}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * El título, que se edita haciendo clic sobre él.
 *
 * En un gráfico no hay barra ni campo: se pincha el título que está dibujado
 * encima del propio gráfico y ahí mismo se escribe, que es como se corrige un
 * título en Minitab. La caja de edición se coloca justo donde estaba el texto
 * para que no salte al abrirse.
 *
 * Importa poder cambiarlo porque es lo que acaba impreso en el protocolo:
 * "Histograma — C1" no dice nada, "Uniformidad de contenido — lote 2074686" sí.
 */
function TituloEditable({ item, tipo, empezarEditando = false, alTerminar }) {
  const renombrarSalida = useWorkbookStore((s) => s.renombrarSalida);
  const [editando, setEditando] = useState(empezarEditando);
  const [borrador, setBorrador] = useState(item.titulo);
  const campoRef = useRef(null);

  useEffect(() => {
    if (editando) campoRef.current?.select();
  }, [editando]);

  function confirmar() {
    const limpio = borrador.trim();
    if (limpio && limpio !== item.titulo) renombrarSalida(tipo, item.id, limpio);
    else setBorrador(item.titulo);
    setEditando(false);
    alTerminar?.();
  }

  if (!editando) {
    return (
      <button
        type="button"
        className="salida-titulo"
        onClick={() => setEditando(true)}
        title="Haz clic para cambiar el título"
      >
        {item.titulo}
      </button>
    );
  }


  return (
    <input
      ref={campoRef}
      className="salida-titulo salida-titulo--editando"
      value={borrador}
      onChange={(e) => setBorrador(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === "Enter") confirmar();
        // Escapar devuelve el título anterior: es la salida sin consecuencias
        // que se espera de un campo que se abrió por un clic.
        if (e.key === "Escape") {
          setBorrador(item.titulo);
          setEditando(false);
          alTerminar?.();
        }
      }}
    />
  );
}

/**
 * El visor principal: muestra en grande lo que esté elegido en el
 * Navegador —una tabla o un gráfico—, igual que la ventana de salida de
 * Minitab, con su barra para renombrarlo, exportarlo o quitarlo.
 */
export default function OutputViewer() {
  const resultados = useWorkbookStore((s) => s.resultados);
  const graficos = useWorkbookStore((s) => s.graficos);
  const seleccionActual = useWorkbookStore((s) => s.seleccionActual);
  const eliminarResultado = useWorkbookStore((s) => s.eliminarResultado);
  const eliminarGrafico = useWorkbookStore((s) => s.eliminarGrafico);

  const [copiado, setCopiado] = useState(false);
  // Qué elemento tiene el título abierto para editar, en vez de un simple
  // "sí/no": así, al cambiar de gráfico en el Navegador, el editor se cierra
  // solo —se deduce de la comparación— sin tener que ir a apagarlo.
  const [tituloEnEdicion, setTituloEnEdicion] = useState(null);
  const graficoRef = useRef(null);

  const item =
    seleccionActual?.tipo === "resultado"
      ? resultados.find((r) => r.id === seleccionActual.id)
      : seleccionActual?.tipo === "grafico"
        ? graficos.find((g) => g.id === seleccionActual.id)
        : null;

  const esGrafico = seleccionActual?.tipo === "grafico";
  const editandoTitulo = Boolean(item) && tituloEnEdicion === item.id;

  // El título de la barra manda sobre el que traía el gráfico al generarse:
  // si no, renombrarlo cambiaría la lista pero no lo que se ve —ni lo que se
  // exporta— encima del dibujo.
  const opciones = useMemo(() => {
    if (!esGrafico || !item) return null;
    // "triggerEvent" es lo que hace que el título responda al clic: sin él
    // ECharts lo dibuja como decorado y no avisa de que lo han pinchado, así
    // que no habría forma de editarlo desde el propio gráfico.
    const titulo = {
      text: item.titulo,
      left: "center",
      top: 6,
      triggerEvent: true,
      textStyle: { color: "#1c1b19", fontSize: 15, fontWeight: 600 },
    };
    // Los gráficos de varios paneles (I-MR, Xbar-R) traen un título por
    // panel: ahí sólo se reemplaza el primero, que es el general.
    if (Array.isArray(item.opciones.title)) {
      const titulos = [...item.opciones.title];
      titulos[0] = { ...titulos[0], ...titulo };
      return { ...item.opciones, title: titulos };
    }
    return { ...item.opciones, title: { ...item.opciones.title, ...titulo } };
  }, [esGrafico, item]);

  async function copiarTabla() {
    try {
      await navigator.clipboard.writeText(tablaComoTexto(item));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // El portapapeles puede estar restringido; el CSV sigue disponible.
    }
  }

  function quitar() {
    if (esGrafico) eliminarGrafico(item.id);
    else eliminarResultado(item.id);
  }

  if (!item) {
    return (
      <section className="output-viewer">
        <div className="results-vacio">
          <IconMessageSquare size={22} />
          <p>Elige columnas en el Asistente y pulsa Ejecutar. Los resultados y gráficos aparecen aquí.</p>
        </div>
      </section>
    );
  }

  // --- gráfico: sin barra, todo el panel es el lienzo ---------------------
  if (esGrafico) {
    return (
      <section className="output-viewer output-viewer--grafico">
        <div className="grafico-lienzo">
          <ReactECharts
            ref={graficoRef}
            option={opciones}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
            notMerge
            lazyUpdate
            // Pinchar el título dibujado abre su edición: no hace falta una
            // barra aparte sólo para poder cambiarlo, y así el gráfico se
            // queda con toda la altura del panel.
            onEvents={{
              click: (params) => {
                if (params?.componentType === "title") setTituloEnEdicion(item.id);
              },
            }}
          />

          {editandoTitulo && (
            <div className="grafico-titulo-editor">
              <TituloEditable
                key={item.id}
                item={item}
                tipo="grafico"
                empezarEditando
                alTerminar={() => setTituloEnEdicion(null)}
              />
            </div>
          )}

          {/* Los botones, dentro del gráfico y sólo como icono: en la esquina
              no le quitan alto al dibujo, que es lo que se viene a mirar. */}
          <div className="grafico-acciones">
            <button
              type="button"
              className="grafico-accion"
              onClick={() => descargarGraficoPng(item.opciones, item.titulo)}
              title="Descargar el gráfico como imagen PNG"
              aria-label="Descargar PNG"
            >
              <IconDownload size={14} />
            </button>
            <button
              type="button"
              className="grafico-accion"
              onClick={quitar}
              title="Quitar este gráfico del análisis"
              aria-label="Quitar"
            >
              <IconClose size={14} />
            </button>
          </div>
        </div>
      </section>
    );
  }

  // --- tabla: una tira fina con el título y lo que se puede hacer con ella --
  return (
    <section className="output-viewer">
      <div className="salida-barra">        <TituloEditable key={item.id} item={item} tipo={seleccionActual.tipo} />

        <div className="salida-barra__acciones">
          <button type="button" className="btn btn--ghost btn--mini" onClick={copiarTabla} title="Copiar la tabla para pegarla en Excel">
            {copiado ? <IconCheck size={13} /> : <IconCopy size={13} />} {copiado ? "Copiado" : "Copiar"}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--mini"
            onClick={() => descargarTablaCsv(item)}
            title="Descargar la tabla como CSV"
          >
            <IconDownload size={13} /> CSV
          </button>
          <button type="button" className="btn btn--ghost btn--mini" onClick={quitar} title="Quitar del análisis">
            <IconClose size={13} />
          </button>
        </div>
      </div>

      <div className="salida-cuerpo">
        {item.advertencias?.length > 0 && (
          <div className="resultado-advertencias">
            {item.advertencias.map((a, i) => (
              <p key={i}>
                <IconAlert size={13} /> {a}
              </p>
            ))}
          </div>
        )}
        <TablaResultado contenido={item.contenido} />
      </div>
    </section>
  );
}
