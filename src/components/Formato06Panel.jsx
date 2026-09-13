import { useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconFileText, IconChevronDown, IconDownload, IconAlert } from "./Icons.jsx";
import { processPdfFile } from "../lib/parsers/index.js";
import { loteComun, materialesDe } from "../lib/materiales.js";
import { exportarFormato06 } from "../lib/exportFormato06.js";

/**
 * Formato 6: la verificación de la calificación de los proveedores.
 *
 * El cuadro es una fila por material, con su código y su descripción. De
 * dónde salen: de las Órdenes de Producción que se suban aquí; si no se sube
 * ninguna, de lo que ya esté cargado en el análisis —las órdenes primero y
 * los registros después—, así que con los registros de siempre el formato ya
 * sale, y subir las órdenes sólo lo mejora.
 *
 * Por qué mejora. El mismo material se llama distinto en cada documento: la
 * orden trae la descripción completa del maestro ("ALUMINIO 174mm DOLORAL CB
 * 400mg CAP BLA") y el registro la abreviada de su tabla de insumos ("ALU
 * 174mm…"). El formato de la empresa usa la larga.
 *
 * Las columnas de proveedor y código de calificación salen en blanco: ese
 * dato no está en ninguno de los dos documentos.
 */
export default function Formato06Panel({ documents = [], familia, lote }) {
  const [abierto, setAbierto] = useState(false);
  const [ordenes, setOrdenes] = useState([]);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);

  // Sólo los documentos del producto que se está mirando: el Formato 6 es de
  // un producto y un lote, no de todo lo que haya cargado la aplicación.
  const delProducto = useMemo(
    () => documents.filter((d) => !familia || d.familia === familia),
    [documents, familia]
  );

  const materiales = useMemo(() => materialesDe(delProducto, ordenes), [delProducto, ordenes]);

  // El producto y el lote se toman de lo que haya: de las órdenes subidas
  // aquí, y si no, del análisis. Con varios lotes cargados se deja en blanco
  // en vez de elegir uno — el formato es de un lote, y adivinar cuál sería
  // peor que dejar la línea para escribirla.
  const producto = familia || ordenes[0]?.meta?.producto || delProducto[0]?.producto || "";
  const loteDelFormato = lote || loteComun([...ordenes, ...delProducto]);

  async function cargar(files) {
    setError(null);
    const nuevas = [];
    try {
      for (const [i, file] of files.entries()) {
        setTrabajando(`Leyendo ${i + 1} de ${files.length}…`);
        const doc = await processPdfFile(file);
        if (doc.kind !== "orden") {
          setError(`"${file.name}" no es una Orden de Producción. Si es un registro, cárgalo en el análisis y sus materiales entran igual.`);
          continue;
        }
        nuevas.push({ ...doc, fileName: file.name });
      }

      // Una orden por lote y etapa: si se vuelve a subir la misma, manda la última.
      setOrdenes((previas) => {
        const porClave = new Map(previas.map((o) => [`${o.meta?.orden || o.fileName}`, o]));
        for (const o of nuevas) porClave.set(`${o.meta?.orden || o.fileName}`, o);
        return [...porClave.values()];
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  async function descargar() {
    setTrabajando("Armando el Formato 6…");
    try {
      await exportarFormato06({ materiales, producto, lote: loteDelFormato });
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  const deOrden = materiales.filter((m) => m.deOrden).length;
  const resumen =
    materiales.length === 0
      ? "Sube las Órdenes de Producción, o carga los registros en el análisis y los materiales salen de ahí."
      : `${materiales.length} ${materiales.length === 1 ? "material" : "materiales"}` +
        (ordenes.length > 0 ? ` · ${ordenes.length} ${ordenes.length === 1 ? "orden subida" : "órdenes subidas"}` : "") +
        ` · ${deOrden} de orden, ${materiales.length - deOrden} de registro`;

  const cabecera = (
    <>
      <span className="sap-icono">
        <IconFileText size={16} />
      </span>
      <div>
        <strong>Formato 6 · Verificación de proveedores</strong>
        <p className="muted">{trabajando || resumen}</p>
      </div>
      <IconChevronDown size={16} className={`sap-chevron${abierto ? " is-open" : ""}`} />
    </>
  );

  if (!abierto) {
    return (
      <section className="card sap-panel sap-panel--cerrado">
        <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(true)}>
          {cabecera}
        </button>
      </section>
    );
  }

  return (
    <section className="card sap-panel">
      <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(false)} aria-expanded>
        {cabecera}
      </button>

      <div className="sap-cuerpo">
        <div className="upload-row">
          <UploadZone
            onFiles={cargar}
            busy={!!trabajando}
            busyLabel={trabajando}
            compact={ordenes.length > 0}
            title="Órdenes de Producción (opcional)"
            compactTitle="Agregar otra orden"
            hint="Si no subes ninguna, los materiales salen de los registros ya cargados. La orden trae la descripción completa del material; el registro, la abreviada."
          />
        </div>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        {materiales.length > 0 && (
          <>
            <table className="protocolo-tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción del material</th>
                  <th>Etapa</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {materiales.map((m) => (
                  <tr key={m.codigo}>
                    <td>{m.codigo}</td>
                    <td>{m.descripcion}</td>
                    <td className="muted">{m.etapas.join(" · ") || "—"}</td>
                    <td className="muted">{m.deOrden ? "Orden" : "Registro"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button className="btn btn--primary" onClick={descargar} disabled={!!trabajando}>
              <IconDownload size={15} /> Descargar Formato 6 (.docx)
            </button>
          </>
        )}

        <p className="muted protocolo-nota">
          Las columnas «Proveedor / Fabricante» y «Código de calificación» salen en blanco: ese dato no está ni en
          la orden ni en el registro —vive en el listado de proveedores calificados—, así que se escribe en Word.
        </p>
      </div>
    </section>
  );
}
