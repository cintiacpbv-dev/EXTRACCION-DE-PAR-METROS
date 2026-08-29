import { useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconFileText, IconChevronDown, IconDownload, IconAlert } from "./Icons.jsx";
import { extractPdfText } from "../lib/pdfText.js";
import { esquemaDeRegistro, ordenarEtapas } from "../lib/esquema/modelo.js";
import { exportEsquemaToWord } from "../lib/exportEsquema.js";

/**
 * Formato 01: el esquema del proceso, dibujado a partir de los registros.
 *
 * Se suben los registros del producto —uno por etapa— y sale el diagrama de
 * flujo: cada operación en su caja con el tiempo, la temperatura, la velocidad
 * y el equipo que usa, unidas por flechas, con los insumos dispensados a un
 * lado y los controles en proceso al otro.
 *
 * Los registros se leen aquí y no se guardan: el esquema describe el proceso,
 * no un lote, así que da igual de qué lote sea el registro que se suba y no
 * tiene sentido acumularlos en el análisis.
 */
export default function Formato01Panel() {
  const [abierto, setAbierto] = useState(false);
  const [esquemas, setEsquemas] = useState([]);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);

  async function cargar(files) {
    setError(null);
    const nuevos = [];
    try {
      for (const [i, file] of files.entries()) {
        setTrabajando(`Leyendo ${i + 1} de ${files.length}…`);
        const { pages } = await extractPdfText(file);
        const esquema = esquemaDeRegistro(pages);
        if (esquema.operaciones.length === 0) {
          setError(`En "${file.name}" no se reconoció ninguna operación del proceso.`);
          continue;
        }
        nuevos.push({ ...esquema, fileName: file.name });
      }

      // Un registro por etapa: si se vuelve a subir la misma, manda el último.
      setEsquemas((previos) => {
        const porEtapa = new Map(previos.map((e) => [e.etapa, e]));
        for (const e of nuevos) porEtapa.set(e.etapa, e);
        return ordenarEtapas([...porEtapa.values()]);
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  async function descargar() {
    setTrabajando("Dibujando el esquema…");
    try {
      await exportEsquemaToWord(esquemas, { producto: esquemas[0]?.producto || "" });
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  const resumen =
    esquemas.length === 0
      ? "Sube los registros de manufactura del producto y sale el diagrama del proceso."
      : `${esquemas.length} ${esquemas.length === 1 ? "etapa" : "etapas"}: ${esquemas
          .map((e) => e.etapa)
          .join(" · ")}`;

  if (!abierto) {
    return (
      <section className="card sap-panel sap-panel--esquema sap-panel--cerrado">
        <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(true)}>
          <span className="sap-icono">
            <IconFileText size={16} />
          </span>
          <div>
            <strong>Formato 01 · Esquema del proceso</strong>
            <p className="muted">{resumen}</p>
          </div>
          <IconChevronDown size={16} className="sap-chevron" />
        </button>
      </section>
    );
  }

  return (
    <section className="card sap-panel sap-panel--esquema">
      <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(false)} aria-expanded>
        <span className="sap-icono">
          <IconFileText size={16} />
        </span>
        <div>
          <strong>Formato 01 · Esquema del proceso</strong>
          <p className="muted">{trabajando || resumen}</p>
        </div>
        <IconChevronDown size={16} className="sap-chevron is-open" />
      </button>

      <div className="sap-cuerpo">
        <div className="upload-row">
          <UploadZone
            onFiles={cargar}
            busy={!!trabajando}
            busyLabel={trabajando}
            compact={esquemas.length > 0}
            title="Registros de manufactura del producto"
            compactTitle="Agregar otra etapa"
            hint="Uno por etapa: fabricación, recubrimiento, envase, acondicionado. Con uno solo sale el esquema de esa etapa."
          />
        </div>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        {esquemas.length > 0 && (
          <>
            <div className="esquema-etapas">
              {esquemas.map((e) => (
                <div key={e.etapa} className="esquema-etapa">
                  <div className="esquema-etapa__cabecera">
                    <strong>{e.etapa}</strong>
                    <span className="muted">
                      {e.operaciones.length} {e.operaciones.length === 1 ? "operación" : "operaciones"}
                    </span>
                  </div>
                  <ol className="esquema-lista">
                    {e.operaciones.map((op) => (
                      <li key={op.seccion}>
                        <strong>{op.titulo}</strong>
                        {op.lineas.length > 0 && <span className="muted"> · {op.lineas.join(" · ")}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>

            <button className="btn btn--primary" onClick={descargar} disabled={!!trabajando}>
              <IconDownload size={15} /> Descargar Formato 01 (.docx)
            </button>

            <p className="muted protocolo-nota">
              El diagrama sale con formas de Word, así que puedes mover las cajas y ajustar el dibujo. Lo que no
              está en el registro —el orden en que se agrupan las operaciones o una nota al margen— se añade
              encima.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
