import { useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconAlert, IconDownload, IconCheck, IconLayers } from "./Icons.jsx";
import { processPdfFile } from "../lib/parsers/index.js";
import { separarLecturas } from "../lib/atributos/modelo.js";
import { clasificar } from "../lib/atributos/clasificar.js";
import { atributosDelProtocolo } from "../lib/atributos/protocolo.js";
import {
  atributosComoLineas,
  exportarClasificacionExcel,
  exportarClasificacionWord,
  fuenteLegible,
  resumenDe,
  veredicto,
} from "../lib/exportClasificacion.js";

/**
 * Clasificación de parámetros: a qué atributos de calidad afecta cada uno.
 *
 * De dónde salen los documentos: por defecto, de los registros que ya se
 * cargaron en Detección de Parámetros. No hay que volver a subir nada. La
 * zona de carga está para cuando se quiere clasificar un producto que no está
 * analizado, o para añadir el protocolo —que es opcional: aporta los
 * atributos con su especificación, pero sin él la sección funciona igual,
 * porque los atributos también se leen del propio registro.
 *
 * Cómo se resuelve cada fila, en este orden: el criterio impreso en el
 * registro, el protocolo si se subió, la bibliografía (Consulta PDF) con su
 * cita, y por último la IA para lo que ninguno resolvió. Cada fila dice de
 * cuál salió, porque no es lo mismo una relación impresa en el registro que
 * una redactada por un modelo.
 */
export default function ClasificacionView({ documentos = [], productos = [] }) {
  const [familia, setFamilia] = useState(productos[0] || "");
  const [subidos, setSubidos] = useState([]);
  const [protocolo, setProtocolo] = useState(null);
  const [filas, setFilas] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);

  // Lo subido aquí manda; si no hay nada subido, lo que ya esté analizado.
  const enUso = useMemo(() => {
    if (subidos.length > 0) return subidos;
    return documentos.filter((d) => d.kind !== "orden" && (!familia || d.familia === familia));
  }, [subidos, documentos, familia]);

  const previo = useMemo(() => separarLecturas(enUso), [enUso]);
  const producto = subidos[0]?.meta?.producto || familia || enUso[0]?.producto || "";
  const lotes = [...new Set(enUso.map((d) => d.lote || d.meta?.lote).filter(Boolean))];
  const lote = lotes.length === 1 ? lotes[0] : "";

  async function cargar(files) {
    setError(null);
    setTrabajando("Leyendo…");
    const nuevos = [];
    try {
      for (const [i, file] of files.entries()) {
        setTrabajando(`Leyendo ${i + 1} de ${files.length}…`);
        if (/\.docx$/i.test(file.name)) {
          const leido = await atributosDelProtocolo(file);
          setProtocolo(leido);
          continue;
        }
        const doc = await processPdfFile(file);
        if (doc.kind === "orden") {
          setError(`"${file.name}" es una Orden de Producción: no trae parámetros que clasificar.`);
          continue;
        }
        nuevos.push({
          ...doc,
          producto: doc.meta.producto,
          lote: doc.meta.lote,
          familia: doc.meta.producto,
          fileName: file.name,
        });
      }
      if (nuevos.length > 0) {
        setSubidos((previos) => {
          const porClave = new Map(previos.map((d) => [`${d.stage}|${d.lote}`, d]));
          for (const d of nuevos) porClave.set(`${d.stage}|${d.lote}`, d);
          return [...porClave.values()];
        });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  async function ejecutar() {
    setError(null);
    setAvisos([]);
    setTrabajando("Clasificando…");
    try {
      const { filas: nuevas, avisos: nuevosAvisos } = await clasificar(enUso, {
        producto,
        atributosExtra: protocolo?.atributos || [],
        onAvance: ({ etapa, fase, hechos, total }) =>
          setTrabajando(`${etapa} · ${fase} · ${hechos} de ${total}…`),
      });
      setFilas(nuevas);
      setAvisos(nuevosAvisos);
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  const resumen = resumenDe(filas);
  const atributos = useMemo(
    () => [...previo.atributos, ...(protocolo?.atributos || [])],
    [previo.atributos, protocolo]
  );

  // Al nombrarlos, una vez cada uno: el rendimiento y el peso promedio se
  // miden en varias etapas y la lista los repetía. En el cuadro siguen yendo
  // por etapa, que es donde cada uno tiene su criterio.
  const nombresDeAtributos = useMemo(
    () => [...new Set(atributos.map((a) => a.nombre))],
    [atributos]
  );

  return (
    <div className="clasificacion">
      <section className="card">
        <h2 className="seccion-titulo">Clasificación de parámetros</h2>
        <p className="muted">
          A qué atributos de calidad afecta cada parámetro de proceso, con qué impacto, y si eso lo convierte en
          Parámetro Crítico de Proceso. Se resuelve por orden: el criterio impreso en el registro, el protocolo si
          lo subes, la bibliografía de Consulta PDF con su cita, y sólo para lo que quede, la IA.
        </p>

        {productos.length > 0 && subidos.length === 0 && (
          <label className="f8-campo">
            <span className="muted">Producto analizado</span>
            <select value={familia} onChange={(e) => setFamilia(e.target.value)}>
              <option value="">Todos</option>
              {productos.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="upload-row">
          <UploadZone
            onFiles={cargar}
            busy={!!trabajando}
            busyLabel={trabajando}
            compact={subidos.length > 0 || !!protocolo}
            title="Registros o protocolo (opcional)"
            compactTitle="Agregar otro documento"
            hint="Si no subes nada se usan los registros ya cargados en Detección de Parámetros. El protocolo (.docx) añade los atributos con su especificación."
          />
        </div>

        {protocolo && (
          <p className="muted">
            <IconCheck size={14} /> Protocolo leído: {protocolo.atributos.length} atributo(s) con especificación.
          </p>
        )}

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        <p className="muted">
          <IconLayers size={14} /> {enUso.length} registro(s) · {previo.parametros.length} parámetros ·{" "}
          {nombresDeAtributos.length} atributos de calidad
          {nombresDeAtributos.length > 0 && `: ${nombresDeAtributos.join(", ")}`}
        </p>

        <button className="btn btn--primary" onClick={ejecutar} disabled={!!trabajando || enUso.length === 0}>
          {trabajando || "Clasificar"}
        </button>
      </section>

      {avisos.length > 0 && (
        <section className="card">
          {avisos.map((a, i) => (
            <p key={i} className="protocolo-error">
              <IconAlert size={14} /> {a}
            </p>
          ))}
        </section>
      )}

      {filas.length > 0 && (
        <section className="card card--table">
          <div className="toolbar">
            <span className="muted">
              {resumen.total} parámetros · <strong>{resumen.criticos} críticos</strong> ·{" "}
              {resumen.respaldadas} con respaldo bibliográfico citado · {resumen.soloIA} sólo propuestos por la IA
            </span>
            <span className="toolbar__spacer" />
              <button
                className="btn"
                onClick={() => exportarClasificacionWord({ filas, atributos, producto, lote })}
              >
                <IconDownload size={15} /> Word
              </button>
              <button
                className="btn btn--primary"
                onClick={() => exportarClasificacionExcel({ filas, producto, lote })}
              >
                <IconDownload size={15} /> Excel
              </button>
          </div>

          <table className="protocolo-tabla">
            <thead>
              <tr>
                <th>Etapa</th>
                <th>Operación</th>
                <th>Parámetro</th>
                <th>Criterio</th>
                <th>Atributos que afecta</th>
                <th>Clasificación</th>
                <th>Fuente</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className={f.critico === true ? "es-critico" : undefined}>
                  <td className="muted">{f.etapa}</td>
                  <td className="muted">{f.seccion}</td>
                  <td>
                    <strong>{f.magnitud}</strong>
                  </td>
                  <td>{f.criterios?.join(" ; ") || "—"}</td>
                  <td>
                    {atributosComoLineas(f).map((linea, i) => (
                      <div key={i}>{linea}</div>
                    ))}
                  </td>
                  <td>{veredicto(f)}</td>
                  <td className="muted">{fuenteLegible(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
