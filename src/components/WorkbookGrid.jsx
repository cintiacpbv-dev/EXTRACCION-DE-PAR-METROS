import { useMemo, useRef, useState } from "react";
import { DataGrid } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { filasATablero, leerExcel, parseCsv } from "../lib/estadistica/csv.js";
import { IconPlus, IconTrash, IconUpload } from "./Icons.jsx";

const ETIQUETA_TIPO = { numeric: "123 Numérico", text: "Abc Texto", date: "📅 Fecha" };

/**
 * Cabecera de columna con su nombre editable y, debajo, el tipo — ya no se
 * elige a mano: se detecta solo con lo que hay escrito en la columna, como
 * en Minitab (una columna con algún valor que no sea número pasa a texto
 * sola, sin que haya que decírselo).
 */
function CabeceraColumna({ columna }) {
  const renombrarColumna = useWorkbookStore((s) => s.renombrarColumna);
  const eliminarColumna = useWorkbookStore((s) => s.eliminarColumna);
  const totalColumnas = useWorkbookStore((s) => s.columns.length);

  return (
    <div className="wb-cabecera">
      <input
        className="wb-cabecera__nombre"
        value={columna.name}
        onChange={(e) => renombrarColumna(columna.id, e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="wb-cabecera__fila2">
        <span className="wb-cabecera__tipo" title="El tipo se detecta solo, según lo que escribas — como en Minitab.">
          {ETIQUETA_TIPO[columna.type]}
        </span>
        {totalColumnas > 1 && (
          <button
            type="button"
            className="wb-cabecera__quitar"
            title="Eliminar columna"
            onClick={(e) => {
              e.stopPropagation();
              eliminarColumna(columna.id);
            }}
          >
            <IconTrash size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function formatearValor(valor, tipo) {
  if (valor == null) return "";
  if (tipo === "numeric" && typeof valor === "number") {
    return Number.isInteger(valor) ? String(valor) : valor.toLocaleString("es-PE", { maximumFractionDigits: 4 });
  }
  return String(valor);
}

export default function WorkbookGrid() {
  const columns = useWorkbookStore((s) => s.columns);
  const setCelda = useWorkbookStore((s) => s.setCelda);
  const pegarBloque = useWorkbookStore((s) => s.pegarBloque);
  const agregarColumna = useWorkbookStore((s) => s.agregarColumna);
  const agregarFilas = useWorkbookStore((s) => s.agregarFilas);
  const limpiarHoja = useWorkbookStore((s) => s.limpiarHoja);
  const cargarHoja = useWorkbookStore((s) => s.cargarHoja);
  const temaClaro = useWorkbookStore((s) => s.temaClaro);
  const alternarTema = useWorkbookStore((s) => s.alternarTema);
  const inputArchivoRef = useRef(null);
  const gridRef = useRef(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const numFilas = Math.max(0, ...columns.map((c) => c.values.length));

  const rdgColumns = useMemo(
    () =>
      columns.map((c) => ({
        key: c.id,
        name: <CabeceraColumna columna={c} />,
        width: 150,
        resizable: true,
        editable: true,
        renderCell: ({ row }) => <span className={row[c.id] == null ? "wb-celda-vacia" : ""}>{formatearValor(row[c.id], c.type)}</span>,
        // El mismo patrón que trae react-data-grid de fábrica (su propio
        // renderTextEditor): valor controlado + onClose al perder el foco.
        // La versión anterior tenía su propio onKeyDown para Enter, que
        // disparaba el guardado una vez por su cuenta y OTRA VEZ por el
        // manejo interno de la grilla — dos escrituras por un solo Enter.
        renderEditCell: ({ row, column, onRowChange, onClose }) => (
          <input
            className="wb-editor"
            autoFocus
            value={row[column.key] ?? ""}
            onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value })}
            onBlur={() => onClose(true, false)}
          />
        ),
      })),
    [columns]
  );

  const rows = useMemo(() => {
    const filas = [];
    for (let i = 0; i < numFilas; i++) {
      const fila = { __idx: i };
      for (const c of columns) fila[c.id] = c.values[i] ?? null;
      filas.push(fila);
    }
    return filas;
  }, [columns, numFilas]);

  function alCambiarFilas(filasNuevas, { indexes, column }) {
    for (const idx of indexes) {
      setCelda(column.key, filasNuevas[idx].__idx, filasNuevas[idx][column.key]);
    }
  }

  // El paste multi-celda de react-data-grid sólo resuelve una celda a la
  // vez (ver onCellPaste en su propio código): el pegado real de un bloque
  // de Excel se hace aquí, directo sobre el estado, y se devuelve la misma
  // fila sin tocar para que la grilla no intente aplicar nada por su lado.
  function alPegar({ row, column }, event) {
    const texto = event.clipboardData.getData("text/plain");
    if (texto) {
      const bloque = texto
        .replace(/\r/g, "")
        .split("\n")
        .filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""))
        .map((f) => f.split("\t"));
      pegarBloque(column.key, row.__idx, bloque);
    }
    return row;
  }

  // Enter y Delete/Backspace como en Excel y Minitab: Enter confirma y baja
  // una fila en la misma columna (la grilla, por su cuenta, sólo confirma y
  // se queda quieta); Delete/Backspace sobre una celda ya seleccionada —sin
  // estar editándola— la vacía de una vez, sin necesidad de abrir el editor
  // primero y borrar el texto a mano.
  function alTeclaCelda(args, event) {
    if (args.mode === "ACTIVE" && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventGridDefault();
      setCelda(args.column.key, args.rowIdx, "");
      return;
    }

    if (event.key === "Enter") {
      event.preventGridDefault();
      if (args.mode === "EDIT") args.onClose(true);
      const idx = rdgColumns.findIndex((c) => c.key === args.column.key);
      // El foco tiene que moverse con la posición: sin "shouldFocus", la
      // celda de abajo queda marcada como activa pero el teclado se queda
      // donde estaba, y seguir escribiendo de corrido no llegaría ahí.
      requestAnimationFrame(() => {
        gridRef.current?.setActivePosition({ idx, rowIdx: args.rowIdx + 1 }, { shouldFocus: true });
      });
    }
  }

  async function alImportar(e) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    setCargando(true);
    setError("");
    try {
      let columnasNuevas;
      if (/\.(xlsx|xlsm)$/i.test(archivo.name)) {
        columnasNuevas = await leerExcel(await archivo.arrayBuffer());
      } else {
        columnasNuevas = filasATablero(parseCsv(await archivo.text()));
      }
      if (columnasNuevas.length === 0) {
        setError("El archivo no tiene datos que importar.");
      } else {
        cargarHoja(columnasNuevas);
      }
    } catch (err) {
      setError(`No pude leer el archivo (${err.message}).`);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="wb-grid-panel">
      <div className="wb-grid-toolbar">
        <button type="button" className="btn btn--ghost btn--sm" onClick={agregarColumna}>
          <IconPlus size={13} /> Columna
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => agregarFilas(20)}>
          <IconPlus size={13} /> 20 filas
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => inputArchivoRef.current?.click()} disabled={cargando}>
          <IconUpload size={13} /> {cargando ? "Importando…" : "Importar CSV / Excel"}
        </button>
        <input ref={inputArchivoRef} type="file" accept=".csv,.xlsx,.xlsm" hidden onChange={alImportar} />
        <button
          type="button"
          className="btn btn--ghost btn--sm btn--peligro"
          onClick={() => {
            if (window.confirm("¿Vaciar toda la hoja? Se pierden los datos y los resultados de esta sesión.")) limpiarHoja();
          }}
        >
          <IconTrash size={13} /> Vaciar hoja
        </button>
        {error && <span className="wb-grid-error">{error}</span>}
        <button
          type="button"
          className="btn btn--ghost btn--sm wb-toolbar__tema"
          onClick={alternarTema}
          title={temaClaro ? "Cambiar a fondo oscuro" : "Cambiar a fondo claro, como Minitab"}
        >
          {temaClaro ? "🌙 Fondo oscuro" : "☀️ Fondo claro"}
        </button>
      </div>
      <div className="wb-grid-wrap">
        <DataGrid
          ref={gridRef}
          columns={rdgColumns}
          rows={rows}
          onRowsChange={alCambiarFilas}
          onCellPaste={alPegar}
          onCellKeyDown={alTeclaCelda}
          rowKeyGetter={(row) => row.__idx}
          className={temaClaro ? "rdg-light" : "rdg-dark"}
          headerRowHeight={56}
          style={{ blockSize: "100%" }}
        />
      </div>
    </div>
  );
}
