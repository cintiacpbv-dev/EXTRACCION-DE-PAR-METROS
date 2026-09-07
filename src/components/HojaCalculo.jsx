import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWorkbookStore, etiquetaColumna, textoDeCelda } from "../lib/estadistica/store.js";
import { continuarSerie } from "../lib/estadistica/relleno.js";
import { esFormula } from "../lib/estadistica/formulas.js";

// La hoja de trabajo, con el comportamiento de una hoja de cálculo: seleccionar
// rangos, copiar, cortar, pegar, borrar, y arrastrar el tirador para rellenar.
//
// Está escrita a mano y no sobre una librería de grillas porque ninguna de las
// que hay resuelve lo que aquí se pide: la que se usaba antes
// (react-data-grid) sólo entiende de una celda a la vez —ni selección
// rectangular, ni copiar un bloque, ni un tirador que reconozca series—, y
// falsear eso desde fuera es más código, y más frágil, que dibujar la tabla.
//
// El acomodo es el de Minitab: la fila de etiquetas fijas (C1, C2, C3…), la
// fila de nombres —que se deja libre para escribir "pH 1", como en el papel—,
// y debajo las filas numeradas.

const ALTO_FILA = 26;
const ANCHO_COLUMNA = 118;
const ANCHO_NUMEROS = 44;
// Cuántas filas de más se dibujan por encima y por debajo de lo que se ve.
// Sin margen, al arrastrar el scroll rápido aparece un hueco en blanco antes
// de que React alcance a dibujar.
const MARGEN_FILAS = 6;

function formatear(valor) {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") {
    return Number.isInteger(valor) ? String(valor) : valor.toLocaleString("es-PE", { maximumFractionDigits: 6 });
  }
  return String(valor);
}

/** El rectángulo que va de una punta a la otra de la selección. */
function rectangulo(ancla, foco) {
  return {
    c1: Math.min(ancla.col, foco.col),
    c2: Math.max(ancla.col, foco.col),
    f1: Math.min(ancla.fila, foco.fila),
    f2: Math.max(ancla.fila, foco.fila),
  };
}

function dentro(rect, col, fila) {
  return col >= rect.c1 && col <= rect.c2 && fila >= rect.f1 && fila <= rect.f2;
}

export default function HojaCalculo() {
  const columns = useWorkbookStore((s) => s.columns);
  const setCelda = useWorkbookStore((s) => s.setCelda);
  const setCeldas = useWorkbookStore((s) => s.setCeldas);
  const pegarBloque = useWorkbookStore((s) => s.pegarBloque);
  const renombrarColumna = useWorkbookStore((s) => s.renombrarColumna);

  const numFilas = Math.max(1, ...columns.map((c) => c.values.length));

  const [ancla, setAncla] = useState({ col: 0, fila: 0 });
  const [foco, setFoco] = useState({ col: 0, fila: 0 });
  const [editando, setEditando] = useState(null); // { col, fila, texto }
  // Espejo de "editando" que se puede leer y limpiar en el acto. Hace falta
  // porque confirmar una edición devuelve el foco a la hoja, y eso dispara el
  // onBlur del editor: sin esta marca, el manejador de blur —que todavía ve
  // el "editando" de su render— volvía a confirmar y devolvía el cursor a la
  // celda de partida, así que escribir una columna de corrido reescribía
  // siempre la misma celda.
  const edicionRef = useRef(null);
  const [arrastrando, setArrastrando] = useState(null); // "seleccion" | "relleno"
  const [previoRelleno, setPrevioRelleno] = useState(null); // hasta qué fila llega el tirador
  const [scrollTop, setScrollTop] = useState(0);
  const [alto, setAlto] = useState(400);

  const hojaRef = useRef(null);
  const cuerpoRef = useRef(null);
  const editorRef = useRef(null);
  const rect = rectangulo(ancla, foco);

  // Sólo se dibujan las filas que se ven: una hoja importada puede traer
  // miles, y dibujarlas todas deja el desplazamiento a tirones.
  const desde = Math.max(0, Math.floor(scrollTop / ALTO_FILA) - MARGEN_FILAS);
  const hasta = Math.min(numFilas, Math.ceil((scrollTop + alto) / ALTO_FILA) + MARGEN_FILAS);
  const visibles = [];
  for (let i = desde; i < hasta; i++) visibles.push(i);

  useLayoutEffect(() => {
    const el = cuerpoRef.current;
    if (!el) return undefined;
    const medir = () => setAlto(el.clientHeight);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  useEffect(() => {
    if (editando) editorRef.current?.focus();
  }, [editando]);

  const irA = useCallback(
    (col, fila, extender = false) => {
      const c = Math.max(0, Math.min(columns.length - 1, col));
      const f = Math.max(0, Math.min(numFilas - 1, fila));
      setFoco({ col: c, fila: f });
      if (!extender) setAncla({ col: c, fila: f });

      // La celda a la que se va tiene que quedar a la vista: sin esto, bajar
      // con las flechas se sale de la ventana y se escribe a ciegas.
      const el = cuerpoRef.current;
      if (!el) return;
      const arriba = f * ALTO_FILA;
      if (arriba < el.scrollTop) el.scrollTop = arriba;
      else if (arriba + ALTO_FILA > el.scrollTop + el.clientHeight) el.scrollTop = arriba + ALTO_FILA - el.clientHeight;
    },
    [columns.length, numFilas]
  );

  function abrirEditor(col, fila, textoInicial) {
    const edicion = { col, fila, texto: textoInicial ?? textoDeCelda(columns[col], fila) };
    edicionRef.current = edicion;
    setEditando(edicion);
  }

  function confirmarEdicion(mover = { col: 0, fila: 1 }) {
    const edicion = edicionRef.current;
    if (!edicion) return;
    edicionRef.current = null;
    setCelda(edicion.col, edicion.fila, edicion.texto);
    const { col, fila } = edicion;
    setEditando(null);
    irA(col + mover.col, fila + mover.fila);
    // El foco vuelve a la hoja: al desaparecer el editor se quedaba en el
    // aire, y la siguiente tecla —seguir escribiendo la columna de corrido—
    // no llegaba a ninguna parte.
    hojaRef.current?.focus();
  }

  // --- portapapeles --------------------------------------------------------

  const textoDelRango = useCallback(() => {
    const filas = [];
    for (let f = rect.f1; f <= rect.f2; f++) {
      const celdas = [];
      for (let c = rect.c1; c <= rect.c2; c++) celdas.push(textoDeCelda(columns[c], f));
      filas.push(celdas.join("\t"));
    }
    return filas.join("\n");
  }, [columns, rect.c1, rect.c2, rect.f1, rect.f2]);

  const borrarRango = useCallback(() => {
    const cambios = [];
    for (let c = rect.c1; c <= rect.c2; c++) {
      for (let f = rect.f1; f <= rect.f2; f++) cambios.push({ colIdx: c, filaIdx: f, texto: "" });
    }
    setCeldas(cambios);
  }, [rect.c1, rect.c2, rect.f1, rect.f2, setCeldas]);

  // Los eventos de portapapeles se escuchan en el contenedor y no en la
  // ventana: si se escucharan en la ventana, copiar desde el Asistente o
  // desde una tabla de resultados acabaría copiando celdas de la hoja.
  useEffect(() => {
    const el = cuerpoRef.current?.parentElement;
    if (!el) return undefined;

    const copiar = (e) => {
      if (editando) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", textoDelRango());
    };
    const cortar = (e) => {
      if (editando) return;
      copiar(e);
      borrarRango();
    };
    const pegar = (e) => {
      if (editando) return;
      const texto = e.clipboardData.getData("text/plain");
      if (!texto) return;
      e.preventDefault();
      const bloque = texto
        .replace(/\r\n?/g, "\n")
        .replace(/\n$/, "")
        .split("\n")
        .map((f) => f.split("\t"));
      pegarBloque(rect.c1, rect.f1, bloque);
      // La selección abarca lo pegado, como en Excel: deja ver de un vistazo
      // qué entró y desde dónde.
      const alto = bloque.length;
      const ancho = Math.max(...bloque.map((f) => f.length));
      setAncla({ col: rect.c1, fila: rect.f1 });
      setFoco({ col: Math.min(columns.length - 1, rect.c1 + ancho - 1), fila: rect.f1 + alto - 1 });
    };

    el.addEventListener("copy", copiar);
    el.addEventListener("cut", cortar);
    el.addEventListener("paste", pegar);
    return () => {
      el.removeEventListener("copy", copiar);
      el.removeEventListener("cut", cortar);
      el.removeEventListener("paste", pegar);
    };
  }, [editando, textoDelRango, borrarRango, pegarBloque, rect.c1, rect.f1, columns.length]);

  // --- teclado -------------------------------------------------------------

  function alTeclear(e) {
    if (editando) return;
    const ext = e.shiftKey;

    if (e.key === "ArrowDown") return mover(e, 0, 1, ext);
    if (e.key === "ArrowUp") return mover(e, 0, -1, ext);
    if (e.key === "ArrowLeft") return mover(e, -1, 0, ext);
    if (e.key === "ArrowRight") return mover(e, 1, 0, ext);
    if (e.key === "Tab") {
      e.preventDefault();
      return irA(foco.col + (e.shiftKey ? -1 : 1), foco.fila);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      return abrirEditor(foco.col, foco.fila);
    }
    if (e.key === "F2") {
      e.preventDefault();
      return abrirEditor(foco.col, foco.fila);
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return borrarRango();
    }
    if (e.key === "Home") {
      e.preventDefault();
      return irA(0, e.ctrlKey ? 0 : foco.fila, ext);
    }
    if (e.key === "End") {
      e.preventDefault();
      return irA(columns.length - 1, e.ctrlKey ? numFilas - 1 : foco.fila, ext);
    }
    if (e.key === "PageDown") {
      e.preventDefault();
      return irA(foco.col, foco.fila + Math.floor(alto / ALTO_FILA), ext);
    }
    if (e.key === "PageUp") {
      e.preventDefault();
      return irA(foco.col, foco.fila - Math.floor(alto / ALTO_FILA), ext);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setAncla({ col: 0, fila: 0 });
      setFoco({ col: columns.length - 1, fila: numFilas - 1 });
      return undefined;
    }
    // Los atajos del portapapeles los maneja el navegador y llegan como
    // eventos copy/cut/paste; aquí no hay que hacer nada con ellos.
    if (e.ctrlKey || e.metaKey || e.altKey) return undefined;

    // Empezar a escribir reemplaza el contenido, como en Excel.
    if (e.key.length === 1) {
      e.preventDefault();
      return abrirEditor(foco.col, foco.fila, e.key);
    }
    return undefined;
  }

  function mover(e, dc, df, extender) {
    e.preventDefault();
    irA(foco.col + dc, foco.fila + df, extender);
  }

  // --- ratón: selección y tirador de relleno -------------------------------

  /**
   * Rellena desde la selección hasta `hastaFila`, columna por columna.
   *
   * Cada columna decide por su cuenta si lo suyo es una serie o no: se puede
   * arrastrar a la vez una de números correlativos y otra de un texto que se
   * repite, y cada una hace lo que le toca (ver relleno.js).
   */
  function aplicarRelleno(hastaFila) {
    const haciaAtras = hastaFila < rect.f1;
    const cantidad = haciaAtras ? rect.f1 - hastaFila : hastaFila - rect.f2;
    if (cantidad <= 0) return;

    const cambios = [];
    for (let c = rect.c1; c <= rect.c2; c++) {
      const origen = [];
      for (let f = rect.f1; f <= rect.f2; f++) origen.push(textoDeCelda(columns[c], f));

      // Una fórmula no se continúa como número: se copia tal cual, y como sus
      // referencias son de la misma fila, al bajarla ya apunta a la fila nueva
      // —que es justo lo que se espera al arrastrarla—.
      const nuevos = origen.some(esFormula)
        ? Array.from({ length: cantidad }, (_, k) => origen[k % origen.length])
        : continuarSerie(
            origen.map((t, i) => (columns[c].values[rect.f1 + i] !== null ? columns[c].values[rect.f1 + i] : t)),
            cantidad,
            haciaAtras
          );

      nuevos.forEach((valor, k) => {
        const fila = haciaAtras ? rect.f1 - 1 - k : rect.f2 + 1 + k;
        cambios.push({ colIdx: c, filaIdx: fila, texto: valor === null || valor === undefined ? "" : String(valor) });
      });
    }
    setCeldas(cambios);
    setAncla({ col: rect.c1, fila: Math.min(rect.f1, hastaFila) });
    setFoco({ col: rect.c2, fila: Math.max(rect.f2, hastaFila) });
  }

  // Soltar el ratón termina el arrastre, esté donde esté el cursor: se
  // escucha en la ventana porque al rellenar es normal salirse de la hoja.
  useEffect(() => {
    if (!arrastrando) return undefined;
    const soltar = () => {
      if (arrastrando === "relleno" && previoRelleno !== null) aplicarRelleno(previoRelleno);
      setArrastrando(null);
      setPrevioRelleno(null);
    };
    window.addEventListener("pointerup", soltar);
    return () => window.removeEventListener("pointerup", soltar);
  });

  function alBajarEnCelda(e, col, fila) {
    if (e.button !== 0) return;
    if (editando) confirmarEdicion({ col: 0, fila: 0 });
    hojaRef.current?.focus();
    if (e.shiftKey) setFoco({ col, fila });
    else {
      setAncla({ col, fila });
      setFoco({ col, fila });
    }
    setArrastrando("seleccion");
  }

  function alEntrarEnCelda(col, fila) {
    if (arrastrando === "seleccion") setFoco({ col, fila });
    else if (arrastrando === "relleno") setPrevioRelleno(fila);
  }

  const rectPrevio =
    arrastrando === "relleno" && previoRelleno !== null
      ? { c1: rect.c1, c2: rect.c2, f1: Math.min(rect.f1, previoRelleno), f2: Math.max(rect.f2, previoRelleno) }
      : null;

  const anchoTotal = ANCHO_NUMEROS + columns.length * ANCHO_COLUMNA;

  return (
    <div
      ref={hojaRef}
      className="hoja"
      tabIndex={0}
      onKeyDown={alTeclear}
      role="grid"
      aria-label="Hoja de trabajo"
    >
      <div className="hoja-cabecera" style={{ width: anchoTotal }}>
        <div className="hoja-esquina" style={{ width: ANCHO_NUMEROS }} />
        {columns.map((c, i) => (
          <div key={c.id} className={`hoja-etiqueta ${i >= rect.c1 && i <= rect.c2 ? "is-activa" : ""}`} style={{ width: ANCHO_COLUMNA }}>
            {/* La marca del tipo va pegada a la etiqueta, como en Minitab:
                "C2-T" es una columna de texto y "C3-F" una de fecha. Ocupa
                una esquina en vez de una fila entera de la hoja. */}
            {etiquetaColumna(i)}
            {c.type === "text" ? "-T" : c.type === "date" ? "-F" : ""}
          </div>
        ))}
      </div>

      <div className="hoja-nombres" style={{ width: anchoTotal }}>
        <div className="hoja-esquina" style={{ width: ANCHO_NUMEROS }} />
        {columns.map((c) => (
          <input
            key={c.id}
            className="hoja-nombre"
            style={{ width: ANCHO_COLUMNA }}
            value={c.nombre ?? ""}
            placeholder=""
            onChange={(e) => renombrarColumna(c.id, e.target.value)}
            aria-label={`Nombre de la columna ${c.id}`}
          />
        ))}
      </div>

      <div className="hoja-cuerpo" ref={cuerpoRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: numFilas * ALTO_FILA, width: anchoTotal, position: "relative" }}>
          {visibles.map((fila) => (
            <div key={fila} className="hoja-fila" style={{ top: fila * ALTO_FILA, height: ALTO_FILA }}>
              <div className={`hoja-numero ${fila >= rect.f1 && fila <= rect.f2 ? "is-activa" : ""}`} style={{ width: ANCHO_NUMEROS }}>
                {fila + 1}
              </div>
              {columns.map((c, col) => {
                const enRango = dentro(rect, col, fila);
                const esFoco = foco.col === col && foco.fila === fila;
                const enPrevio = rectPrevio && dentro(rectPrevio, col, fila) && !enRango;
                const error = c.errores?.[fila];
                const editandoEsta = editando && editando.col === col && editando.fila === fila;

                return (
                  <div
                    key={c.id}
                    className={`hoja-celda ${enRango ? "is-rango" : ""} ${esFoco ? "is-foco" : ""} ${enPrevio ? "is-previo" : ""} ${
                      error ? "is-error" : ""
                    } ${c.type === "numeric" ? "is-numero" : ""}`}
                    style={{ width: ANCHO_COLUMNA }}
                    onPointerDown={(e) => alBajarEnCelda(e, col, fila)}
                    onPointerEnter={() => alEntrarEnCelda(col, fila)}
                    onDoubleClick={() => abrirEditor(col, fila)}
                    title={error || (c.formulas?.[fila] ? c.formulas[fila] : undefined)}
                  >
                    {editandoEsta ? (
                      <input
                        ref={editorRef}
                        className="hoja-editor"
                        value={editando.texto}
                        onChange={(e) => {
                          const edicion = { ...editando, texto: e.target.value };
                          edicionRef.current = edicion;
                          setEditando(edicion);
                        }}
                        onBlur={() => confirmarEdicion({ col: 0, fila: 0 })}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            confirmarEdicion({ col: 0, fila: 1 });
                          } else if (e.key === "Tab") {
                            e.preventDefault();
                            confirmarEdicion({ col: e.shiftKey ? -1 : 1, fila: 0 });
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            edicionRef.current = null;
                            setEditando(null);
                            hojaRef.current?.focus();
                          }
                        }}
                      />
                    ) : (
                      <span className={c.values[fila] == null && !error ? "hoja-vacia" : ""}>
                        {error ? "#¿?" : formatear(c.values[fila])}
                      </span>
                    )}

                    {/* El tirador, en la esquina de abajo a la derecha de la
                        selección — el mismo sitio y la misma función que en
                        Excel. */}
                    {col === rect.c2 && fila === rect.f2 && !editando && (
                      <span
                        className="hoja-tirador"
                        title="Arrastra para rellenar: si lo seleccionado es una serie, la continúa; si no, lo repite."
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setArrastrando("relleno");
                          setPrevioRelleno(rect.f2);
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
