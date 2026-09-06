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
 * El título del elemento, editable en el sitio.
 *
 * Se edita aquí y no en un cuadro de diálogo aparte porque es lo que hace
 * Minitab y porque el título es lo que acaba impreso encima del gráfico en el
 * protocolo: "Histograma — C1" no dice nada, "Uniformidad de contenido — lote
 * 2074686" sí.
 */
function TituloEditable({ item, tipo }) {
  const renombrarSalida = useWorkbookStore((s) => s.renombrarSalida);
  const [editando, setEditando] = useState(false);
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
  const graficoRef = useRef(null);

  const item =
    seleccionActual?.tipo === "resultado"
      ? resultados.find((r) => r.id === seleccionActual.id)
      : seleccionActual?.tipo === "grafico"
        ? graficos.find((g) => g.id === seleccionActual.id)
        : null;

  const esGrafico = seleccionActual?.tipo === "grafico";

  // El título de la barra manda sobre el que traía el gráfico al generarse:
  // si no, renombrarlo cambiaría la lista pero no lo que se ve —ni lo que se
  // exporta— encima del dibujo.
  const opciones = useMemo(() => {
    if (!esGrafico || !item) return null;
    const titulo = { text: item.titulo, left: "center", top: 6, textStyle: { color: "#1c1b19", fontSize: 15, fontWeight: 600 } };
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

  return (
    <section className="output-viewer">
      <div className="salida-barra">
        <TituloEditable key={item.id} item={item} tipo={seleccionActual.tipo} />

        <div className="salida-barra__acciones">
          {esGrafico ? (
            <button
              type="button"
              className="btn btn--ghost btn--mini"
              onClick={() => descargarGraficoPng(item.opciones, item.titulo)}
              title="Descargar el gráfico como imagen PNG"
            >
              <IconDownload size={13} /> PNG
            </button>
          ) : (
            <>
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
            </>
          )}
          <button type="button" className="btn btn--ghost btn--mini" onClick={quitar} title="Quitar del análisis">
            <IconClose size={13} />
          </button>
        </div>
      </div>

      <div className="salida-cuerpo">
        {!esGrafico && (
          <>
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
          </>
        )}

        {esGrafico && (
          // El lienzo blanco con marco, como una ventana de gráfico de
          // Minitab. El alto lo pone el contenedor y no un mínimo fijo: con
          // un mínimo, el gráfico se salía por abajo del panel y el eje X
          // —con sus etiquetas— quedaba recortado.
          <div className="grafico-lienzo">
            <ReactECharts
              ref={graficoRef}
              option={opciones}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
              notMerge
              lazyUpdate
            />
          </div>
        )}
      </div>
    </section>
  );
}
