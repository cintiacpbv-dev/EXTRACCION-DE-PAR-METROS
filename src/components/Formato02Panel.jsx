import { useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconCheck, IconChevronDown, IconDownload, IconAlert } from "./Icons.jsx";
import { processPdfFile } from "../lib/parsers/index.js";
import { leerParametrosDeProtocolo, contarParametros } from "../lib/protocolo/parametros.js";
import {
  ambitoDe,
  cabeceraDeEtapa,
  emparejarEtapa,
  etapasDesdeRegistros,
  resumenDeCobertura,
} from "../lib/protocolo/emparejar.js";
import { exportarFormato02 } from "../lib/exportFormato02.js";

/**
 * Formato 02: la verificación del proceso de manufactura.
 *
 * El cuadro tiene dos mitades y cada una vive en un documento distinto:
 *
 *   - del PROTOCOLO salen la secuencia de operaciones, el modo de
 *     verificación y el rango de cada parámetro;
 *   - del REGISTRO de manufactura sale el resultado de cada uno.
 *
 * Ninguno de los dos es obligatorio, porque el formato sirve en tres momentos
 * distintos del trabajo:
 *
 *   - sólo el protocolo → el cuadro en blanco que se lleva a planta antes de
 *     ejecutar el lote, ya con su secuencia y sus rangos;
 *   - sólo registros → el cuadro armado con las secciones del propio
 *     registro y sus resultados, sin modo de verificación (el registro no
 *     dice con qué instrumento se mide cada cosa);
 *   - los dos → la secuencia del protocolo con el resultado del registro al
 *     lado, que es el documento completo.
 *
 * Los registros pueden venir de los que ya están analizados en la aplicación
 * o subirse aquí mismo, para poder emitir el formato sin montar antes un
 * análisis entero.
 */
export default function Formato02Panel({ documents = [], familia, lote, opcionesEncabezado }) {
  const [abierto, setAbierto] = useState(false);
  const [protocolo, setProtocolo] = useState(null);
  const [subidos, setSubidos] = useState([]);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);

  const delAnalisis = useMemo(
    () => documents.filter((d) => (!familia || d.familia === familia) && d.kind !== "orden"),
    [documents, familia]
  );

  // Los subidos aquí se suman a los del análisis, sin repetir el mismo lote y
  // etapa: si alguien vuelve a cargar un registro que ya estaba, manda el que
  // acaba de subir.
  const registros = useMemo(() => {
    const porClave = new Map();
    for (const d of delAnalisis) porClave.set(`${d.lote}|${d.stage}`, d);
    for (const d of subidos) porClave.set(`${d.lote}|${d.stage}`, d);
    return [...porClave.values()];
  }, [delAnalisis, subidos]);

  /**
   * Lo que va a salir en el documento, calculado aquí para poder enseñarlo
   * antes de descargar nada: quien firma debe ver qué se emparejó y qué no.
   */
  const etapas = useMemo(() => {
    if (protocolo) {
      return protocolo.etapas.map((e) => ({
        etapa: e.etapa,
        cabecera: cabeceraDeEtapa(registros, e.etapa),
        emparejado: emparejarEtapa(e.filas, ambitoDe(registros, e.etapa)),
      }));
    }
    if (registros.length > 0) {
      return etapasDesdeRegistros(registros).map((e) => ({
        ...e,
        cabecera: cabeceraDeEtapa(registros, e.etapa),
      }));
    }
    return null;
  }, [protocolo, registros]);

  const vista = useMemo(
    () => etapas?.map((e) => ({ etapa: e.etapa, ...resumenDeCobertura(e.emparejado) })) ?? null,
    [etapas]
  );

  const cobertura = useMemo(
    () =>
      vista?.reduce(
        (a, v) => ({ total: a.total + v.total, conResultado: a.conResultado + v.conResultado }),
        { total: 0, conResultado: 0 }
      ) ?? null,
    [vista]
  );

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

  async function cargarRegistros(files) {
    setError(null);
    const leidos = [];
    for (const [i, file] of files.entries()) {
      setTrabajando(`Analizando ${file.name} (${i + 1} de ${files.length})…`);
      try {
        const doc = await processPdfFile(file);
        if (doc.kind === "orden") {
          setError(`${file.name} es una Orden de Producción, no un registro de manufactura: no se usó.`);
          continue;
        }
        // El lector devuelve la cabecera dentro de `meta`; el resto de la
        // aplicación espera el producto y el lote también arriba, que es lo
        // que hace App.jsx al guardarlos. Sin esto, un registro subido aquí
        // salía sin lote y sin nombre de producto.
        leidos.push({
          ...doc,
          producto: doc.meta?.producto || "",
          lote: doc.meta?.lote || "",
          familia: doc.meta?.producto || "",
        });
      } catch (err) {
        setError(`No se pudo leer ${file.name}: ${err.message}`);
      }
    }
    setTrabajando("");
    if (leidos.length > 0) setSubidos((previos) => [...previos, ...leidos]);
  }

  async function descargar() {
    if (!etapas) return;
    setError(null);
    setTrabajando("Generando el Formato 02…");
    try {
      await exportarFormato02({
        etapas,
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
    : registros.length > 0
      ? `Sin protocolo: el cuadro sale con las secciones de ${registros.length} registro(s) y sus resultados.`
      : "Sube el protocolo de validación, los registros de manufactura, o los dos.";

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
        <p className="muted protocolo-nota">
          Hace falta al menos uno de los dos. Con el protocolo solo sale el cuadro en blanco para llevar a
          planta, con su secuencia de operaciones y sus rangos. Con registros solos sale con las secciones del
          propio registro y sus resultados, pero sin modo de verificación —eso el registro no lo dice—. Con los
          dos, el documento completo.
        </p>

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

        <div className="upload-row">
          <UploadZone
            onFiles={cargarRegistros}
            busy={!!trabajando}
            busyLabel={trabajando}
            compact={registros.length > 0}
            title="Registros de manufactura (.pdf)"
            compactTitle={
              subidos.length > 0
                ? `Registros subidos aquí: ${subidos.length}${delAnalisis.length > 0 ? ` (+${delAnalisis.length} del análisis)` : ""}`
                : delAnalisis.length > 0
                  ? `Usando ${delAnalisis.length} registro(s) del análisis — agregar más`
                  : "Agregar registros"
            }
            hint="De aquí sale la columna de resultado. Si ya hay registros analizados en la aplicación, se usan esos y no hace falta volver a subirlos."
          />
        </div>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        {vista && (
          <>
            {protocolo && (
              <p className="muted protocolo-nota">
                El resultado de cada parámetro se toma del registro sólo cuando la magnitud y el rango del
                protocolo coinciden con los del registro. Lo que no coincide se queda en blanco para llenarlo en
                planta: una casilla vacía se rellena a mano, un dato puesto en la fila equivocada se firma. La
                columna "Verificado" va siempre en blanco, que es la firma de quien verifica.
              </p>
            )}

            <table className="protocolo-tabla">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Parámetros</th>
                  <th>{protocolo ? "Con resultado del registro" : "Con resultado"}</th>
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

            {protocolo && registros.length === 0 && (
              <p className="muted protocolo-nota">
                Sin registros, el formato sale en blanco —listo para llevar a planta—.
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
