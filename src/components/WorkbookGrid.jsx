import { useRef, useState } from "react";
import HojaCalculo from "./HojaCalculo.jsx";
import PestanasHojas from "./PestanasHojas.jsx";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { filasATablero, leerExcel, parseCsv } from "../lib/estadistica/csv.js";
import { IconPlus, IconTrash, IconUpload, IconChevronDown } from "./Icons.jsx";

/**
 * El panel de la hoja de trabajo: su barra de acciones y la hoja.
 *
 * La barra se pliega —queda sólo una tira con el nombre— para dejarle la
 * altura a los datos, que es lo que de verdad se mira: importar un archivo o
 * añadir filas se hace una vez, y después estorba todos los demás minutos.
 */
export default function WorkbookGrid() {
  const agregarColumna = useWorkbookStore((s) => s.agregarColumna);
  const agregarFilas = useWorkbookStore((s) => s.agregarFilas);
  const limpiarHoja = useWorkbookStore((s) => s.limpiarHoja);
  const cargarHoja = useWorkbookStore((s) => s.cargarHoja);
  const inputArchivoRef = useRef(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [barraAbierta, setBarraAbierta] = useState(false);

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
        cargarHoja(columnasNuevas, archivo.name.replace(/\.[^.]+$/, ""));
      }
    } catch (err) {
      setError(`No pude leer el archivo (${err.message}).`);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="wb-grid-panel">
      <div className={`wb-grid-toolbar ${barraAbierta ? "" : "is-plegada"}`}>
        <button
          type="button"
          className="wb-toolbar-tirador"
          onClick={() => setBarraAbierta((v) => !v)}
          aria-expanded={barraAbierta}
          title={barraAbierta ? "Ocultar las acciones de la hoja" : "Mostrar las acciones de la hoja"}
        >
          <IconChevronDown size={13} className={barraAbierta ? "sap-chevron is-open" : "sap-chevron"} />
          Hoja de trabajo
        </button>

        {barraAbierta && (
          <>
            <button type="button" className="btn btn--ghost btn--sm" onClick={agregarColumna}>
              <IconPlus size={13} /> Columna
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => agregarFilas(20)}>
              <IconPlus size={13} /> 20 filas
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => inputArchivoRef.current?.click()}
              disabled={cargando}
            >
              <IconUpload size={13} /> {cargando ? "Importando…" : "Importar CSV / Excel"}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--peligro"
              onClick={() => {
                if (window.confirm("¿Vaciar esta hoja de trabajo? Se pierden sus datos. Las demás hojas y los resultados se quedan.")) limpiarHoja();
              }}
            >
              <IconTrash size={13} /> Vaciar hoja
            </button>
          </>
        )}
        <input ref={inputArchivoRef} type="file" accept=".csv,.xlsx,.xlsm" hidden onChange={alImportar} />
        {error && <span className="wb-grid-error">{error}</span>}
      </div>

      <HojaCalculo />
      <PestanasHojas />
    </div>
  );
}
