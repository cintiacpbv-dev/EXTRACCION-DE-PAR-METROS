import { useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconCheck, IconChevronDown, IconDownload, IconAlert } from "./Icons.jsx";
import { leerParametrosDeProtocolo, contarParametros } from "../lib/protocolo/parametros.js";
import { ambitoDe, cabeceraDeEtapa, emparejarEtapa, resumenDeCobertura } from "../lib/protocolo/emparejar.js";
import { exportarFormato02 } from "../lib/exportFormato02.js";

/**
 * Formato 02: la verificación del proceso de manufactura.
 *
 * El cuadro tiene dos mitades y cada una viene de un documento distinto: lo
 * que hay que verificar —la secuencia de operaciones, el modo de
 * verificación y el rango— sale del protocolo de validación; el resultado
 * sale del registro de manufactura del lote, de los que ya están analizados
 * en la aplicación.
 *
 * Por eso el protocolo se sube aquí: es el único documento donde está esa
 * mitad. Sin él no hay Formato 02 que valga —el registro no dice con qué
 * instrumento se verifica cada cosa ni en qué orden van las operaciones—, y
 * sin registros el formato sale en blanco, que es como se lleva a planta
 * antes de ejecutar el lote.
 */
export default function Formato02Panel({ documents = [], familia, lote, opcionesEncabezado }) {
  const [abierto, setAbierto] = useState(false);
  const [protocolo, setProtocolo] = useState(null);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);

  const registros = useMemo(
    () => documents.filter((d) => (!familia || d.familia === familia) && d.kind !== "orden"),
    [documents, familia]
  );

  // Lo que va a salir en el documento, calculado aquí para poder enseñarlo
  // antes de descargar nada: quien firma debe ver qué se emparejó y qué no.
  const vista = useMemo(() => {
    if (!protocolo) return null;
    return protocolo.etapas.map((etapa) => {
      const emparejado = emparejarEtapa(etapa.filas, ambitoDe(registros, etapa.etapa));
      return { etapa: etapa.etapa, ...resumenDeCobertura(emparejado) };
    });
  }, [protocolo, registros]);

  const cobertura = useMemo(() => {
    if (!vista) return null;
    return vista.reduce(
      (a, v) => ({ total: a.total + v.total, conResultado: a.conResultado + v.conResultado }),
      { total: 0, conResultado: 0 }
    );
  }, [vista]);

  async function cargarProtocolo(files) {
    setError(null);
    setTrabajando("Leyendo el protocolo…");
    try {
      const leido = await leerParametrosDeProtocolo(files[0]);
      if (leido.etapas.length === 0) {
        setError(
          "En ese documento no hay ninguna tabla de parámetros. El Formato 02 se arma con las tablas " +
            '"Parámetro de Proceso · Modo de verificación · Rango de operación" del protocolo de validación ' +
            "(o con un Formato 9 en blanco, que trae las mismas)."
        );
        setProtocolo(null);
      } else {
        setProtocolo(leido);
      }
    } catch (err) {
      setError(`No se pudo leer el documento: ${err.message}`);
      setProtocolo(null);
    } finally {
      setTrabajando("");
    }
  }

  async function descargar() {
    if (!protocolo) return;
    setError(null);
    setTrabajando("Generando el Formato 02…");
    try {
      const etapas = protocolo.etapas.map((e) => ({
        ...e,
        cabecera: cabeceraDeEtapa(registros, e.etapa),
      }));
      await exportarFormato02({
        etapas,
        documentos: registros,
        producto: familia || registros[0]?.producto || "",
        lote: lote || registros[0]?.lote || "",
        opciones: opcionesEncabezado || {},
      });
    } catch (err) {
      setError(`No se pudo generar el Formato 02: ${err.message}`);
    } finally {
      setTrabajando("");
    }
  }

  const resumen = protocolo
    ? `${protocolo.nombre} · ${protocolo.etapas.length} etapas, ${contarParametros(protocolo.etapas)} parámetros` +
      (cobertura ? ` · ${cobertura.conResultado} con resultado del registro` : "")
    : "Sube el protocolo de validación (o un Formato 9 en blanco) para armar el cuadro de verificación.";

  if (!abierto) {
    return (
      <section className="card sap-panel sap-panel--cerrado">
        <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(true)}>
          <span className="sap-icono">
            <IconCheck size={16} />
          </span>
          <div>
            <strong>Formato 02 · Verificación del proceso</strong>
            <p className="muted">{resumen}</p>
          </div>
          <IconChevronDown size={16} className="sap-chevron" />
        </button>
      </section>
    );
  }

  return (
    <section className="card sap-panel">
      <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(false)} aria-expanded>
        <span className="sap-icono">
          <IconCheck size={16} />
        </span>
        <div>
          <strong>Formato 02 · Verificación del proceso</strong>
          <p className="muted">{trabajando || resumen}</p>
        </div>
        <IconChevronDown size={16} className="sap-chevron is-open" />
      </button>

      <div className="sap-cuerpo">
        <div className="upload-row">
          <UploadZone
            onFiles={cargarProtocolo}
            busy={!!trabajando}
            busyLabel={trabajando}
            compact={!!protocolo}
            title="Protocolo de validación (.docx)"
            compactTitle={protocolo ? `Protocolo: ${protocolo.nombre}` : "Cambiar protocolo"}
            hint="De aquí salen la secuencia de operaciones, el modo de verificación y el rango de cada parámetro. Sirve también un Formato 9 en blanco."
            extensiones={[".docx"]}
            tipos={["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]}
          />
        </div>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        {vista && (
          <>
            <p className="muted protocolo-nota">
              El resultado de cada parámetro se toma del registro sólo cuando la magnitud y el rango del
              protocolo coinciden con los del registro. Lo que no coincide se queda en blanco para llenarlo en
              planta: una casilla vacía se rellena a mano, un dato puesto en la fila equivocada se firma. La
              columna "Verificado" va siempre en blanco, que es la firma de quien verifica.
            </p>

            <table className="protocolo-tabla">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Parámetros</th>
                  <th>Con resultado del registro</th>
                </tr>
              </thead>
              <tbody>
                {vista.map((v) => (
                  <tr key={v.etapa}>
                    <td>{v.etapa}</td>
                    <td>{v.total}</td>
                    <td>{v.conResultado === 0 ? "—" : `${v.conResultado} de ${v.total}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {registros.length === 0 && (
              <p className="muted protocolo-nota">
                No hay registros de manufactura cargados de este producto, así que el formato saldrá en blanco
                —listo para llevar a planta—.
              </p>
            )}

            <button className="btn btn--primary" onClick={descargar} disabled={!!trabajando}>
              <IconDownload size={15} /> Descargar Formato 02 (.docx)
            </button>
          </>
        )}
      </div>
    </section>
  );
}
