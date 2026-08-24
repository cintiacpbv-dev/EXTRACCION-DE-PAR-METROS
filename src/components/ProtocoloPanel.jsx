import { useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconShieldCheck, IconChevronDown, IconDownload, IconAlert, IconCheck } from "./Icons.jsx";
import { extractPdfText } from "../lib/pdfText.js";
import { detectSetpoints } from "../lib/parsers/setpoints.js";
import { leerProtocolo, escribirProtocolo, tituloAntesDe } from "../lib/protocolo/documento.js";
import { compararProtocolo } from "../lib/protocolo/comparar.js";
import { xmlResumen } from "../lib/protocolo/resumen.js";

/**
 * Pone al lado el protocolo de validación anterior y el registro de
 * manufactura vigente, y señala qué setpoints ya no dicen lo mismo.
 *
 * Se piden los dos archivos en vez de reaprovechar los registros ya
 * analizados a propósito: un protocolo se actualiza contra una edición
 * concreta del registro —la 11 de EVACLEAN funde a 70 ºC donde la anterior
 * fundía a 60— y conviene que quede claro cuál se está usando.
 *
 * La aplicación no decide: propone, enseña la frase del registro de donde
 * sale cada propuesta, y sólo escribe en el documento los cambios que se
 * hayan marcado.
 */
export default function ProtocoloPanel() {
  const [abierto, setAbierto] = useState(false);
  const [protocolo, setProtocolo] = useState(null);
  const [registros, setRegistros] = useState([]);
  const [setpoints, setSetpoints] = useState([]);
  const [entradas, setEntradas] = useState(null);
  const [aceptados, setAceptados] = useState(() => new Set());
  const [editados, setEditados] = useState({});
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);

  const distintos = useMemo(() => (entradas || []).filter((e) => e.estado === "distinto"), [entradas]);
  const iguales = useMemo(() => (entradas || []).filter((e) => e.estado === "igual"), [entradas]);
  const sinEvidencia = useMemo(
    () => (entradas || []).filter((e) => e.estado === "sin-evidencia"),
    [entradas]
  );

  function reiniciarComparacion() {
    setEntradas(null);
    setAceptados(new Set());
    setEditados({});
  }

  async function cargarProtocolo(files) {
    setError(null);
    setTrabajando("Leyendo el protocolo…");
    try {
      setProtocolo(await leerProtocolo(files[0]));
      reiniciarComparacion();
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  async function cargarRegistros(files) {
    setError(null);
    try {
      const nuevos = [];
      const sp = [];
      for (const [i, file] of files.entries()) {
        setTrabajando(`Leyendo registro ${i + 1} de ${files.length}…`);
        const { pages } = await extractPdfText(file);
        nuevos.push(file.name);
        sp.push(...detectSetpoints(pages));
      }
      setRegistros((prev) => [...prev, ...nuevos]);
      setSetpoints((prev) => [...prev, ...sp]);
      reiniciarComparacion();
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  function comparar() {
    setError(null);
    const titulos = {};
    for (const t of protocolo.tablas) titulos[t.indice] = tituloAntesDe(protocolo.xml, t.inicio);

    // Las tablas de parámetros del protocolo son las que abren con la
    // columna "Parámetros"; las demás (fórmula, equipos, firmas) no llevan
    // setpoint que contrastar.
    const conSetpoint = protocolo.tablas.filter((t) =>
      /^par[áa]metros?/i.test(t.filas[0]?.celdas[0]?.texto || "")
    );

    const res = compararProtocolo(conSetpoint, setpoints, { titulos });
    setEntradas(res);
    // Lo que difiere viene marcado: es lo que se venía a arreglar. Cada fila
    // enseña la frase del registro para poder desmarcarla si no encaja.
    setAceptados(new Set(res.map((e, i) => (e.estado === "distinto" ? i : -1)).filter((i) => i >= 0)));
  }

  async function descargar() {
    setError(null);
    setTrabajando("Escribiendo el protocolo…");
    try {
      const cambios = [...aceptados].map((i) => ({
        celda: entradas[i].celda,
        textoNuevo: editados[i] ?? entradas[i].propuesta,
      }));

      // El protocolo sale con su propio registro de cambios al final: qué se
      // actualizó, contra qué registro, de qué paso sale cada valor y qué
      // queda por mirar a mano. Sin eso, quien lo revise tiene que volver a
      // comparar los dos documentos para saber qué se tocó.
      const resumen = xmlResumen({
        registros,
        aplicados: [...aceptados].map((i) => ({
          ...entradas[i],
          textoNuevo: editados[i] ?? entradas[i].propuesta,
        })),
        noAplicados: entradas.filter((e, i) => e.estado === "distinto" && !aceptados.has(i)),
        iguales,
        sinEvidencia,
      });

      const { blob, aplicados } = await escribirProtocolo(protocolo, cambios, { resumen });

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = protocolo.nombre.replace(/\.docx$/i, "") + " — actualizado.docx";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 2000);
      setTrabajando(`Descargado con ${aplicados} cambio(s).`);
      setTimeout(() => setTrabajando(""), 4000);
    } catch (e) {
      setError(e.message);
      setTrabajando("");
    }
  }

  function alternar(i) {
    setAceptados((prev) => {
      const s = new Set(prev);
      if (s.has(i)) s.delete(i);
      else s.add(i);
      return s;
    });
  }

  if (!abierto) {
    return (
      <section className="card sap-panel sap-panel--cerrado">
        <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(true)}>
          <span className="sap-icono">
            <IconShieldCheck size={16} />
          </span>
          <div>
            <strong>Actualizar un protocolo de validación</strong>
            <p className="muted">
              Compara tu protocolo anterior con el registro de manufactura vigente y marca lo que cambió.
            </p>
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
          <IconShieldCheck size={16} />
        </span>
        <div>
          <strong>Actualizar un protocolo de validación</strong>
          <p className="muted">{trabajando || "Sube el protocolo de referencia y los registros vigentes."}</p>
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
            title="Protocolo de referencia (.docx)"
            compactTitle={protocolo ? `Protocolo: ${protocolo.nombre}` : "Cambiar protocolo"}
            hint="El protocolo de validación anterior, el que hay que poner al día."
            extensiones={[".docx"]}
            tipos={["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]}
          />
          <UploadZone
            onFiles={cargarRegistros}
            busy={!!trabajando}
            busyLabel={trabajando}
            compact={registros.length > 0}
            title="Registros de manufactura vigentes (PDF)"
            compactTitle={`${registros.length} registro(s) · agregar otro`}
            hint="Los RMD de la edición en vigor, uno por etapa: fabricación, envase, acondicionado."
          />
        </div>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        {protocolo && registros.length > 0 && !entradas && (
          <button className="btn btn--primary" onClick={comparar} disabled={!!trabajando}>
            Comparar {protocolo.tablas.length} tablas contra {setpoints.length} valores del registro
          </button>
        )}

        {entradas && (
          <>
            <div className="protocolo-resumen">
              <span className="sap-pastilla sap-pastilla--falta">{distintos.length} difieren</span>
              <span className="sap-pastilla sap-pastilla--ok">{iguales.length} coinciden</span>
              <span className="sap-pastilla">{sinEvidencia.length} sin evidencia</span>
            </div>

            {distintos.length === 0 ? (
              <p className="muted">
                Ningún setpoint del protocolo contradice al registro vigente entre los que se pudieron
                contrastar.
              </p>
            ) : (
              <table className="protocolo-tabla">
                <thead>
                  <tr>
                    <th />
                    <th>Parámetro</th>
                    <th>Dice el protocolo</th>
                    <th>Dice el registro</th>
                    <th>De dónde sale</th>
                  </tr>
                </thead>
                <tbody>
                  {entradas.map((e, i) =>
                    e.estado !== "distinto" ? null : (
                      <tr key={i} className={aceptados.has(i) ? "is-aceptado" : ""}>
                        <td>
                          <input type="checkbox" checked={aceptados.has(i)} onChange={() => alternar(i)} />
                        </td>
                        <td>
                          <strong>{e.parametro}</strong>
                          <span className="muted protocolo-contexto">{e.contexto}</span>
                        </td>
                        <td className="protocolo-antes">{e.actual}</td>
                        <td>
                          <input
                            className="protocolo-valor"
                            value={editados[i] ?? e.propuesta}
                            onChange={(ev) => setEditados((p) => ({ ...p, [i]: ev.target.value }))}
                          />
                        </td>
                        <td className="protocolo-evidencia">{e.evidencia}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}

            <details className="protocolo-detalle">
              <summary>
                Ver los {iguales.length} que coinciden y los {sinEvidencia.length} sin evidencia
              </summary>
              <ul className="protocolo-lista">
                {iguales.map((e, i) => (
                  <li key={`ig${i}`}>
                    <IconCheck size={12} /> <strong>{e.parametro}</strong>: {e.actual}
                  </li>
                ))}
                {sinEvidencia.map((e, i) => (
                  <li key={`se${i}`} className="muted">
                    <strong>{e.parametro}</strong>: {e.actual} — no se encontró en el registro una frase
                    que fije este valor; hay que revisarlo a mano.
                  </li>
                ))}
              </ul>
            </details>

            <button className="btn btn--primary" onClick={descargar} disabled={!!trabajando}>
              <IconDownload size={14} /> Descargar protocolo actualizado ({aceptados.size} cambio
              {aceptados.size === 1 ? "" : "s"})
            </button>
            <p className="muted protocolo-nota">
              Sale el mismo documento con las celdas marcadas reescritas y resaltadas en amarillo, para
              revisarlas de un vistazo. Todo lo demás —portada, firmas, redacción, numeración— queda igual.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
