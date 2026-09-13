import { useMemo, useState } from "react";
import { IconFileText, IconChevronDown, IconAlert, IconTrash } from "./Icons.jsx";
import { revisarTanda } from "../lib/aprenderParametros.js";
import { borrarTerminoRemoto, guardarVocabularioLocal, usarVocabulario, vocabularioEnUso } from "../lib/vocabulario.js";

/**
 * Lo que la aplicación aprendió sola sobre los parámetros del proceso.
 *
 * El detector reconoce una magnitud por su nombre, y la lista de nombres está
 * escrita para lo que la planta ya fabrica. Cuando entra un producto de otra
 * familia, sus lecturas quedan sueltas. Este panel es donde se revisa lo que
 * la IA propuso a partir de esas lecturas sueltas: qué término aprendió, de
 * qué etiqueta y de qué registro salió, y qué propuso que se descartó.
 *
 * Aquí se borra un término si no corresponde. Borrarlo devuelve la detección
 * exactamente a como estaba, porque lo aprendido sólo suma: asciende lecturas
 * que quedaban escondidas y nunca quita ni cambia lo que ya se detectaba.
 */
export default function VocabularioPanel({ documents = [], version = 0, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [revisando, setRevisando] = useState("");
  const [ultima, setUltima] = useState(null);
  const [error, setError] = useState(null);

  // El vocabulario vive fuera de React: lo usa el detector, que no es un
  // componente. Se vuelve a leer cuando cambia `version` —el contador que la
  // aplicación sube cada vez que se aprende o se borra algo— en vez de
  // copiarlo a un estado propio, que se quedaría viejo en cuanto la revisión
  // automática aprendiera algo con este panel cerrado.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` es justamente la señal de que hay que releer
  const terminos = useMemo(() => vocabularioEnUso(), [version]);

  async function revisar() {
    setError(null);
    setRevisando("Revisando los registros…");
    try {
      const resultados = await revisarTanda(documents, {
        onAvance: (r) => setRevisando(`${r.producto} · ${r.etapa}…`),
      });
      const hechos = resultados.filter((r) => r.estado !== "omitido");
      const fallos = hechos.filter((r) => r.estado === "error");
      if (fallos.length > 0) setError(fallos[0].motivo);
      setUltima({
        revisados: hechos.length,
        omitidos: resultados.length - hechos.length,
        aprendidos: hechos.flatMap((r) => r.aprendidos || []),
        descartados: hechos.flatMap((r) => r.descartados || []),
      });
      onCambio?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setRevisando("");
    }
  }

  async function borrar(termino) {
    await borrarTerminoRemoto(termino);
    const quedan = vocabularioEnUso().filter((t) => t.termino !== termino);
    usarVocabulario(quedan);
    guardarVocabularioLocal(quedan);
    onCambio?.();
  }

  const resumen =
    terminos.length === 0
      ? "Todavía no ha aprendido ninguna magnitud nueva."
      : `${terminos.length} ${terminos.length === 1 ? "magnitud aprendida" : "magnitudes aprendidas"}: ${terminos
          .slice(0, 4)
          .map((t) => t.termino)
          .join(" · ")}${terminos.length > 4 ? " · …" : ""}`;

  const cabecera = (
    <>
      <span className="sap-icono">
        <IconFileText size={16} />
      </span>
      <div>
        <strong>Parámetros aprendidos</strong>
        <p className="muted">{revisando || resumen}</p>
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
        <p className="muted">
          Cuando entra un producto de una familia nueva, sus magnitudes pueden no estar en el vocabulario del
          detector y sus lecturas quedan fuera del cuadro. La revisión le pasa a la IA sólo esas lecturas
          sueltas —nunca el registro entero— y guarda las magnitudes que resultan. Basta un registro por receta
          y etapa: los demás lotes no enseñan nada distinto.
        </p>

        <button className="btn btn--primary" onClick={revisar} disabled={!!revisando || documents.length === 0}>
          {revisando ? "Revisando…" : "Revisar los registros cargados"}
        </button>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        {ultima && (
          <p className="muted protocolo-nota">
            {ultima.revisados === 0
              ? "No había ninguna receta y etapa sin revisar."
              : `Se revisaron ${ultima.revisados} ${ultima.revisados === 1 ? "registro" : "registros"} (${
                  ultima.omitidos
                } ya estaban revisados). Aprendió ${ultima.aprendidos.length} ${
                  ultima.aprendidos.length === 1 ? "magnitud" : "magnitudes"
                }${ultima.descartados.length > 0 ? ` y descartó ${ultima.descartados.length}` : ""}.`}
          </p>
        )}

        {ultima?.descartados?.length > 0 && (
          <ul className="muted protocolo-nota">
            {ultima.descartados.map((d, i) => (
              <li key={`${d.termino}-${i}`}>
                Descartado «{d.termino}»: {d.motivo}.
              </li>
            ))}
          </ul>
        )}

        {terminos.length > 0 && (
          <table className="protocolo-tabla">
            <thead>
              <tr>
                <th>Magnitud</th>
                <th>Se vio en</th>
                <th>Producto · etapa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {terminos.map((t) => (
                <tr key={t.termino}>
                  <td>
                    <strong>{t.termino}</strong>
                    {t.motivo && <div className="muted">{t.motivo}</div>}
                  </td>
                  <td>{t.etiqueta || "—"}</td>
                  <td className="muted">
                    {[t.producto, t.etapa].filter(Boolean).join(" · ") || "—"}
                    {t.origen === "manual" && " · escrito a mano"}
                  </td>
                  <td>
                    <button
                      className="btn btn--ghost"
                      onClick={() => borrar(t.termino)}
                      title="Quitar esta magnitud del vocabulario"
                    >
                      <IconTrash size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
