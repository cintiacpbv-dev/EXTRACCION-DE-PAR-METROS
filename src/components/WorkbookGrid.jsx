import { useMemo, useRef, useState } from "react";
import { DataGrid } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { filasATablero, leerExcel, parseCsv } from "../lib/estadistica/csv.js";
import { IconPlus, IconTrash, IconUpload } from "./Icons.jsx";

const TIPOS = [
  { value: "numeric", label: "123 Numérico" },
  { value: "text", label: "Abc Texto" },
  { value: "date", label: "📅 Fecha" },
];

/**
 * Cabecera de columna con su nombre editable y su tipo — igual que en
 * Minitab, donde cada columna de la hoja declara su propio tipo de dato,
 * no la hoja entera.
 */
function CabeceraColumna({ columna }) {
  const renombrarColumna = useWorkbookStore((s) => s.renombrarColumna);
  const cambiarTipoColumna = useWorkbookStore((s) => s.cambiarTipoColumna);
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
        <select
          className="wb-cabecera__tipo"
          value={columna.type}
          onChange={(e) => cambiarTipoColumna(columna.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        >
          {TIPOS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
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
  const inputArchivoRef = useRef(null);
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
        renderEditCell: ({ row, onRowChange }) => (
          <input
            className="wb-editor"
            autoFocus
            defaultValue={row[c.id] ?? ""}
            onBlur={(e) => onRowChange({ ...row, [c.id]: e.target.value }, true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRowChange({ ...row, [c.id]: e.currentTarget.value }, true);
            }}
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
      </div>
      <div className="wb-grid-wrap">
        <DataGrid
          columns={rdgColumns}
          rows={rows}
          onRowsChange={alCambiarFilas}
          onCellPaste={alPegar}
          rowKeyGetter={(row) => row.__idx}
          className="rdg-dark"
          headerRowHeight={56}
          style={{ blockSize: "100%" }}
        />
      </div>
    </div>
  );
}
