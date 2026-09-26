import { useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconAlert, IconDownload } from "./Icons.jsx";
import { processPdfFile } from "../lib/parsers/index.js";
import { extractPdfText } from "../lib/pdfText.js";
import { numerar } from "../lib/criticidad/orden.js";
import {
  AGREGAR,
  FUERA,
  MANTENER,
  QUITAR,
  colorearRmd,
  enOrdenDeCuadro,
  filasDelRmd,
  nombreDelRmdColoreado,
  pasosDelRmd,
  recomendar,
} from "../lib/criticidad/vobo.js";

/**
 * Descargar el RMD coloreado: en qué operaciones va el V°B°.
 *
 * El PDF del registro hace falta entero —se colorea sobre él—, y los registros
 * que se analizaron en Detección de Parámetros no guardan el PDF, sólo lo que
 * se leyó de él. Por eso sirven los que se subieron en esta sección, y se
 * puede subir aquí el RMD sólo para colorearlo, sin tocar la evaluación.
 */
export default function RmdVoBo({ resultado, producto, subidos = [] }) {
  const [extra, setExtra] = useState([]);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);
  const [ultimo, setUltimo] = useState(null);

  const rmds = useMemo(() => {
    const porNombre = new Map();
    for (const d of [...subidos.filter((d) => d.archivo), ...extra]) porNombre.set(d.fileName, d);
    return [...porNombre.values()];
  }, [subidos, extra]);

  const numeros = useMemo(() => numerar(resultado.filas), [resultado.filas]);

  async function subir(files) {
    setError(null);
    setTrabajando("Leyendo el RMD…");
    try {
      const nuevos = [];
      for (const file of files) {
        const doc = await processPdfFile(file);
        if (doc.kind === "orden") {
          setError(`"${file.name}" es una Orden de Producción, no un registro de manufactura.`);
          continue;
        }
        nuevos.push({ fileName: file.name, stage: doc.stage, meta: doc.meta, archivo: file });
      }
      setExtra((previos) => [...previos.filter((p) => !nuevos.some((n) => n.fileName === p.fileName)), ...nuevos]);
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  async function descargar(rmd) {
    setError(null);
    setTrabajando(`Coloreando ${rmd.fileName}…`);
    try {
      const { pages } = await extractPdfText(rmd.archivo);
      const pasos = pasosDelRmd(pages);
      if (pasos.length === 0) {
        throw new Error("No se reconocieron los pasos del registro (4.4.1.-, 4.4.2.-…): ¿es un RMD con el formato de siempre?");
      }
      const etapa = rmd.stage || rmd.meta?.stage || "";
      const filas = filasDelRmd(resultado.filas, etapa);
      const atributos = filasDelRmd(resultado.atributos, etapa);
      const recomendaciones = recomendar(pasos, { filas, atributos, numeros });

      const sinPasos = filas.length > 0 && filas.every((f) => !f.pasos?.length && !/^\s*\d+\.\d+/.test(f.seccion || ""));
      const bytes = await colorearRmd(await rmd.archivo.arrayBuffer(), {
        recomendaciones,
        titulo: `RM ${etapa || "DE MANUFACTURA"} — ${rmd.meta?.producto || producto || ""}${rmd.meta?.lote ? ` (lote ${rmd.meta.lote})` : ""}`,
        subtitulo:
          "Operaciones que deben llevar V°B° del jefe o supervisor según la evaluación de criticidad (metodología PCP / Clave / No clave)",
      });

      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = nombreDelRmdColoreado(rmd.fileName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      setUltimo({ fileName: rmd.fileName, recomendaciones: enOrdenDeCuadro(recomendaciones), sinPasos, filas: filas.length });
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  const cuenta = (tipo) => ultimo?.recomendaciones.filter((r) => r.recomendacion === tipo).length || 0;

  return (
    <section className="card">
      <h3 className="seccion-titulo">RMD con V°B°</h3>
      <p className="muted">
        Descarga el registro de manufactura coloreado según esta evaluación: en rojo las operaciones con PCP (agregar o
        mantener el V°B° del jefe o supervisor), en ámbar las que hoy llevan V°B° pero sus parámetros son Clave o No clave
        (quitarlo), y punteadas las de despeje de sala. Cada marca lleva su motivo al margen, con el N° del parámetro en la
        evaluación, y la primera página resume todo.
      </p>

      {rmds.length > 0 && (
        <ul className="vobo-lista">
          {rmds.map((r) => (
            <li key={r.fileName}>
              <span>
                <strong>{r.fileName}</strong> <span className="muted">· {r.stage || r.meta?.stage || "etapa sin identificar"}</span>
              </span>
              <button className="btn btn--primary btn--mini" onClick={() => descargar(r)} disabled={!!trabajando}>
                <IconDownload size={14} /> Descargar RMD con V°B°
              </button>
            </li>
          ))}
        </ul>
      )}

      <UploadZone
        onFiles={subir}
        busy={!!trabajando}
        busyLabel={trabajando}
        compact
        title="Subir el RMD (PDF) para colorearlo"
        compactTitle={rmds.length ? "Subir otro RMD para colorearlo" : "Subir el RMD (PDF) para colorearlo"}
        hint="El de fabricación, el de envase o ambos. Sólo se usa para colorearlo: no cambia la evaluación."
      />

      {error && (
        <p className="protocolo-error">
          <IconAlert size={14} /> {error}
        </p>
      )}

      {ultimo && (
        <div className="vobo-resumen">
          <p>
            <strong>{ultimo.fileName}</strong>: {cuenta(AGREGAR)} para agregar V°B° · {cuenta(MANTENER)} para mantener ·{" "}
            {cuenta(QUITAR)} para quitar · {cuenta(FUERA)} fuera de alcance.
          </p>
          {ultimo.sinPasos && (
            <p className="protocolo-error">
              <IconAlert size={14} /> Los parámetros de esta evaluación no traen el número de paso del registro (salieron del
              protocolo y sus operaciones no lo indican), así que no se pudieron ubicar los PCP en el RMD. Para marcarlos,
              evalúa desde los registros de manufactura.
            </p>
          )}
          {ultimo.filas === 0 && (
            <p className="protocolo-error">
              <IconAlert size={14} /> Ningún parámetro de la evaluación corresponde a la etapa de este registro.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
