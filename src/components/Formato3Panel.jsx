import { useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconGrid, IconChevronDown, IconDownload, IconAlert } from "./Icons.jsx";
import { aggregateEquipos } from "../lib/model.js";
import {
  cargarCronogramaLocal,
  guardarCronogramaLocal,
  leerCronograma,
  olvidarCronogramaLocal,
} from "../lib/calificaciones.js";
import { esEquipoCalificable } from "../lib/parsers/equipos.js";
import { exportFormato3ToWord, filasFormato3 } from "../lib/exportFormato3.js";

// Cómo se ve cada estado de las casillas CO y CD. En el documento exportado
// el visto va como "ü" en Wingdings, que es la convención de los formatos de
// la empresa; aquí basta el carácter.
const MARCA = {
  conforme: { texto: "✓", clase: "formato3-marca--ok", titulo: "Calificado y conforme" },
  sin: { texto: "-", clase: "", titulo: "No tiene esta calificación" },
  pendiente: {
    texto: "",
    clase: "",
    titulo: "Tiene la calificación, pero el cronograma no la da por conforme",
  },
};

function Marca({ estado, encontrado }) {
  const m = MARCA[estado] || MARCA.pendiente;
  // Sin ficha en el cronograma la casilla también queda vacía, pero por otro
  // motivo: no hay nada que consultar, no es que no esté conforme.
  const titulo = encontrado ? m.titulo : "El equipo no figura en el cronograma";
  return (
    <td className={`formato3-marca ${m.clase}`} title={titulo}>
      {m.texto}
    </td>
  );
}

/**
 * Formato 3: la calificación de los equipos que intervinieron en el producto.
 *
 * Los equipos salen de la sección 1 de los registros de manufactura ya
 * analizados, de todas las etapas juntas. Su estado, su código de calificación
 * y su fecha salen del cronograma de calificación (el Excel de OQ y PQ), que
 * se actualiza cada cierto tiempo y por eso se sube aquí y se guarda hasta que
 * se suba uno más nuevo.
 *
 * La fecha y el código son los del desempeño (CD) y, en los equipos que no lo
 * tienen, los de la operación (CO) —con la casilla CD marcada con un guion—,
 * que es como están hechos los formatos ya emitidos.
 */
export default function Formato3Panel({ documents, familia, opcionesEncabezado }) {
  const [abierto, setAbierto] = useState(false);
  const [cronograma, setCronograma] = useState(() => cargarCronogramaLocal());
  const [soloCalificables, setSoloCalificables] = useState(true);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const equipos = useMemo(() => aggregateEquipos(documents, familia), [documents, familia]);
  const calificables = useMemo(() => equipos.filter(esEquipoCalificable), [equipos]);
  const filas = useMemo(
    () => filasFormato3(equipos, cronograma, { soloCalificables }),
    [equipos, cronograma, soloCalificables]
  );

  const sinEncontrar = filas.filter((f) => !f.encontrado);
  const conProblema = filas.filter(
    (f) => f.encontrado && f.estadoGeneral && !/CALIFICADO/i.test(f.estadoGeneral)
  );

  // Los equipos se leen del registro de manufactura al analizarlo. Un producto
  // analizado antes de que existiera esta lectura no los tiene guardados: el
  // panel no se esconde —eso deja a quien lo busca sin saber por qué no está—
  // sino que explica qué hacer para tenerlos.
  const sinEquipos = equipos.length === 0;

  async function cargarExcel(files) {
    setError(null);
    setAviso(null);
    setTrabajando("Leyendo el cronograma…");
    try {
      const buffer = await files[0].arrayBuffer();
      const res = await leerCronograma(buffer, { fileName: files[0].name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCronograma(res.cronograma);
      if (!guardarCronogramaLocal(res.cronograma)) {
        setAviso("El cronograma no cupo en la memoria del navegador: habrá que volver a subirlo la próxima vez.");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  function quitarExcel() {
    olvidarCronogramaLocal();
    setCronograma(null);
    setAviso(null);
  }

  async function descargar() {
    setTrabajando("Generando el Formato 3…");
    try {
      await exportFormato3ToWord(filas, { producto: familia, ...opcionesEncabezado });
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  const resumen = sinEquipos
    ? "Vuelve a subir los RMD de este producto para leer sus equipos."
    : cronograma
      ? `${cronograma.fileName || "cronograma"} · ${cronograma.filas.length} equipos en el cronograma`
      : "Sube el cronograma de calificación (OQ y PQ) para completar estado, código y fecha.";

  if (!abierto) {
    return (
      <section className="card sap-panel sap-panel--formato3 sap-panel--cerrado">
        <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(true)}>
          <span className="sap-icono">
            <IconGrid size={16} />
          </span>
          <div>
            <strong>Formato 3 · Calificación de equipos</strong>
            <p className="muted">
              {sinEquipos ? resumen : `${calificables.length} equipos calificables en ${familia}. ${resumen}`}
            </p>
          </div>
          <IconChevronDown size={16} className="sap-chevron" />
        </button>
      </section>
    );
  }

  return (
    <section className="card sap-panel sap-panel--formato3">
      <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(false)} aria-expanded>
        <span className="sap-icono">
          <IconGrid size={16} />
        </span>
        <div>
          <strong>Formato 3 · Calificación de equipos</strong>
          <p className="muted">{trabajando || resumen}</p>
        </div>
        <IconChevronDown size={16} className="sap-chevron is-open" />
      </button>

      <div className="sap-cuerpo">
        {sinEquipos && (
          <p className="muted protocolo-nota">
            Los equipos se leen de la sección "EQUIPOS / INSTRUMENTOS / MATERIALES" del registro de manufactura.
            Los lotes de {familia} se analizaron antes de que la aplicación leyera esa sección: vuelve a subir sus
            RMD —o tráelos de nuevo desde SAP— y aparecerán aquí. El cronograma sí puedes cargarlo ya.
          </p>
        )}

        <div className="upload-row">
          <UploadZone
            onFiles={cargarExcel}
            busy={!!trabajando}
            busyLabel={trabajando}
            compact={!!cronograma}
            title="Cronograma de calificación (.xlsx)"
            compactTitle={cronograma ? `Cronograma: ${cronograma.fileName}` : "Cambiar cronograma"}
            hint="El registro de áreas, sistemas y equipos a calificar (OQ y PQ). Súbelo de nuevo cada vez que se actualice."
            extensiones={[".xlsx", ".xlsm"]}
            tipos={["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]}
          />
        </div>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}
        {aviso && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {aviso}
          </p>
        )}

        {!sinEquipos && (
          <>
            <div className="protocolo-resumen">
              <span className="sap-pastilla sap-pastilla--ok">
                {filas.length - sinEncontrar.length} con calificación
              </span>
              {sinEncontrar.length > 0 && (
                <span className="sap-pastilla sap-pastilla--falta">
                  {sinEncontrar.length} sin ficha en el cronograma
                </span>
              )}
              {conProblema.length > 0 && (
                <span className="sap-pastilla sap-pastilla--falta">{conProblema.length} no calificados</span>
              )}
              <label className="formato3-filtro">
                <input
                  type="checkbox"
                  checked={soloCalificables}
                  onChange={(e) => setSoloCalificables(e.target.checked)}
                />
                Sólo equipos calificables ({calificables.length} de {equipos.length})
              </label>
              {cronograma && (
                <button className="btn btn--ghost" onClick={quitarExcel}>
                  Quitar cronograma
                </button>
              )}
            </div>

            <div className="sap-tabla-scroll">
              <table className="protocolo-tabla formato3-tabla">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Código SAP</th>
                    <th>Descripción</th>
                    <th>Etapas</th>
                    <th>Código de calificación</th>
                    <th>Fecha</th>
                    <th>CO</th>
                    <th>CD</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.codigoSap || f.codigoMif || f.descripcion} className={f.encontrado ? "" : "is-falta"}>
                      <td>{f.codigoMif}</td>
                      <td>{f.codigoSap}</td>
                      <td>{f.descripcion}</td>
                      <td className="muted">{f.etapas.join(", ")}</td>
                      <td>{f.codigoCalificacion}</td>
                      <td>
                        {f.fecha}
                        {f.origenFecha && <span className="muted formato3-origen"> ({f.origenFecha})</span>}
                      </td>
                      <Marca estado={f.co} encontrado={f.encontrado} />
                      <Marca estado={f.cd} encontrado={f.encontrado} />
                      <td className={f.encontrado ? "" : "muted"}>
                        {f.encontrado ? f.estadoGeneral || f.estado : "no está en el cronograma"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {conProblema.length > 0 && (
              <details className="protocolo-detalle">
                <summary>{conProblema.length} equipos con observaciones en el cronograma</summary>
                <ul className="protocolo-lista">
                  {conProblema.map((f) => (
                    <li key={`obs-${f.codigoSap || f.codigoMif}`}>
                      <strong>{f.codigoMif || f.codigoSap}</strong> — {f.estadoGeneral}
                      {f.observaciones ? `: ${f.observaciones}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <button className="btn btn--primary" onClick={descargar} disabled={!!trabajando || filas.length === 0}>
              <IconDownload size={15} /> Descargar Formato 3 (.docx)
            </button>

            <p className="muted protocolo-nota">
              Las casillas de verificación y la de "Verificado por / Fecha" van en blanco: se firman a mano. Un guion
              en CO o CD significa que esa calificación no consta en el cronograma.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
