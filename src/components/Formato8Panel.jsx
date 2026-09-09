import { useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconUser, IconChevronDown, IconDownload, IconAlert } from "./Icons.jsx";
import {
  ANIOS_VIGENCIA,
  cargarPersonalLocal,
  guardarPersonalLocal,
  leerPersonal,
  olvidarPersonalLocal,
  rolesDe,
  seccionDe,
  vigenciaDe,
} from "../lib/personal.js";
import { exportarFormato8 } from "../lib/exportFormato8.js";

const ETIQUETA = {
  vigente: { texto: "Vigente", clase: "f8-estado--ok" },
  vencida: { texto: "Vencida", clase: "f8-estado--vencida" },
  "sin-fecha": { texto: "Sin fecha", clase: "f8-estado--sin" },
};

/**
 * Formato 8: la calificación del personal de la sección.
 *
 * El consolidado de calificaciones trae una hoja por sección y, dentro, una
 * fila por persona y rol. De ahí sale el cuadro: nombre, etapa donde
 * interviene y fecha en que se calificó para ella.
 *
 * La sección se propone sola a partir de los equipos del registro —sus
 * códigos MIF llevan el prefijo de la sección, "CBL-E010"— pero se puede
 * cambiar: el consolidado es uno solo para toda la planta y a veces hace
 * falta mirar otra.
 *
 * Qué se considera vencido no lo dice el consolidado en ninguna columna, así
 * que los años de vigencia son un ajuste a la vista y no una constante
 * escondida: se cambian aquí y el cuadro se recalcula.
 */
export default function Formato8Panel({ documents = [], familia, lote, opcionesEncabezado }) {
  const [abierto, setAbierto] = useState(false);
  const [libro, setLibro] = useState(() => cargarPersonalLocal());
  const [seccionElegida, setSeccionElegida] = useState(null);
  const [rolesFuera, setRolesFuera] = useState(() => new Set());
  const [anios, setAnios] = useState(ANIOS_VIGENCIA);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);

  const registros = useMemo(
    () => documents.filter((d) => (!familia || d.familia === familia) && d.kind !== "orden"),
    [documents, familia]
  );

  const secciones = useMemo(() => (libro?.secciones || []).filter((s) => !s.cesados), [libro]);

  // La sección del producto analizado, propuesta a partir de los equipos del
  // registro. Se calcula al vuelo en vez de guardarse: así, cuando se carga
  // otro libro o se analiza otro producto, la propuesta se rehace sola y sólo
  // manda lo que la persona haya elegido a mano.
  const seccionPropuesta = useMemo(
    () => (libro ? seccionDe(registros, libro.secciones) || secciones[0]?.seccion || "" : ""),
    [libro, registros, secciones]
  );
  const seccion = seccionElegida ?? seccionPropuesta;

  const activa = useMemo(() => secciones.find((s) => s.seccion === seccion) || null, [secciones, seccion]);
  const roles = useMemo(() => (activa ? rolesDe(activa) : []), [activa]);

  const filas = useMemo(() => {
    if (!activa) return [];
    return activa.personal
      .filter((p) => !rolesFuera.has(p.rol))
      .map((p) => ({ ...p, vigencia: vigenciaDe(p, { anios }) }));
  }, [activa, rolesFuera, anios]);

  const cuenta = useMemo(() => {
    const c = { vigente: 0, vencida: 0, "sin-fecha": 0 };
    for (const f of filas) c[f.vigencia.estado] += 1;
    return c;
  }, [filas]);

  async function cargarExcel(files) {
    setError(null);
    setTrabajando("Leyendo el consolidado…");
    try {
      const leido = await leerPersonal(await files[0].arrayBuffer(), { fileName: files[0].name });
      setLibro(leido);
      setSeccionElegida(null);
      setRolesFuera(new Set());
      if (!guardarPersonalLocal(leido)) {
        setError("Se leyó bien, pero no cupo en el almacenamiento del navegador: habrá que subirlo otra vez la próxima sesión.");
      }
    } catch (err) {
      setError(`No se pudo leer el consolidado: ${err.message}`);
    } finally {
      setTrabajando("");
    }
  }

  function alternarRol(rol) {
    setRolesFuera((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(rol)) siguiente.delete(rol);
      else siguiente.add(rol);
      return siguiente;
    });
  }

  async function descargar() {
    if (filas.length === 0) return;
    setError(null);
    setTrabajando("Generando el Formato 8…");
    try {
      await exportarFormato8({
        personal: filas,
        seccion,
        producto: familia || registros[0]?.producto || "",
        lote: lote || registros[0]?.lote || "",
        anios,
        opciones: opcionesEncabezado || {},
      });
    } catch (err) {
      setError(`No se pudo generar el Formato 8: ${err.message}`);
    } finally {
      setTrabajando("");
    }
  }

  const resumen = libro
    ? `${libro.fileName || "consolidado"} · ${secciones.length} secciones` +
      (activa ? ` · ${seccion}: ${filas.length} filas, ${cuenta.vencida} vencida(s)` : "")
    : "Sube el consolidado de calificación del personal (.xlsx) para armar el cuadro.";

  if (!abierto) {
    return (
      <section className="card sap-panel sap-panel--cerrado">
        <button className="sap-cabecera sap-cabecera--boton" onClick={() => setAbierto(true)}>
          <span className="sap-icono">
            <IconUser size={16} />
          </span>
          <div>
            <strong>Formato 8 · Verificación de personal</strong>
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
          <IconUser size={16} />
        </span>
        <div>
          <strong>Formato 8 · Verificación de personal</strong>
          <p className="muted">{trabajando || resumen}</p>
        </div>
        <IconChevronDown size={16} className="sap-chevron is-open" />
      </button>

      <div className="sap-cuerpo">
        <div className="upload-row">
          <UploadZone
            onFiles={cargarExcel}
            busy={!!trabajando}
            busyLabel={trabajando}
            compact={!!libro}
            title="Consolidado de calificación del personal (.xlsx)"
            compactTitle={libro ? `Consolidado: ${libro.fileName}` : "Cambiar consolidado"}
            hint="Una hoja por sección, con una fila por persona y rol. Queda guardado; súbelo de nuevo cuando se actualice."
            extensiones={[".xlsx", ".xlsm"]}
            tipos={["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]}
          />
        </div>

        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        {libro && (
          <>
            <div className="f8-controles">
              <label className="f8-campo">
                <span>Sección</span>
                <select value={seccion} onChange={(e) => setSeccionElegida(e.target.value)}>
                  {secciones.map((s) => (
                    <option key={s.seccion} value={s.seccion}>
                      {s.seccion} ({new Set(s.personal.map((p) => p.nombre)).size} personas)
                    </option>
                  ))}
                </select>
              </label>

              <label className="f8-campo">
                <span>Vigencia de la calificación</span>
                <select value={anios} onChange={(e) => setAnios(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "año" : "años"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {roles.length > 0 && (
              <div className="f8-roles">
                <span className="muted">Roles a incluir:</span>
                {roles.map((rol) => (
                  <button
                    key={rol}
                    className={`sap-pastilla ${rolesFuera.has(rol) ? "" : "sap-pastilla--ok"}`}
                    onClick={() => alternarRol(rol)}
                    aria-pressed={!rolesFuera.has(rol)}
                    title={rolesFuera.has(rol) ? "Fuera del cuadro — clic para incluirlo" : "En el cuadro — clic para quitarlo"}
                  >
                    {rol}
                  </button>
                ))}
              </div>
            )}

            <p className="muted protocolo-nota">
              Amarillo es calificación vencida: pasaron más de {anios} {anios === 1 ? "año" : "años"} desde que se
              calificó para ese rol. El consolidado no dice en ninguna columna cuánto vale una calificación, así
              que ese plazo se elige aquí. "Sin fecha" no es lo mismo que vencida: es que el consolidado no
              registra cuándo se calificó, y por eso no va en amarillo.
            </p>

            <div className="protocolo-resumen">
              <span className="sap-pastilla sap-pastilla--ok">{cuenta.vigente} vigentes</span>
              <span className="sap-pastilla">{cuenta.vencida} vencidas</span>
              <span className="sap-pastilla">{cuenta["sin-fecha"]} sin fecha</span>
            </div>

            <table className="protocolo-tabla">
              <thead>
                <tr>
                  <th>Nombre del personal</th>
                  <th>Etapa donde interviene</th>
                  <th>Fecha</th>
                  <th>Vence</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => {
                  const e = ETIQUETA[f.vigencia.estado];
                  return (
                    <tr key={`${f.nombre}|${f.rol}|${i}`} className={f.vigencia.estado === "vencida" ? "is-vencida" : ""}>
                      <td>{f.nombre}</td>
                      <td>{f.rol}</td>
                      <td>{f.fecha || "—"}</td>
                      <td>{f.vigencia.vence || "—"}</td>
                      <td className={e.clase}>{e.texto}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="f8-acciones">
              <button className="btn btn--primary" onClick={descargar} disabled={!!trabajando || filas.length === 0}>
                <IconDownload size={15} /> Descargar Formato 8 (.docx)
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => {
                  olvidarPersonalLocal();
                  setLibro(null);
                  setSeccionElegida(null);
                }}
              >
                Olvidar el consolidado
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
