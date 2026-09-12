import { useEffect, useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconUser, IconChevronDown, IconDownload, IconAlert } from "./Icons.jsx";
import {
  ANIOS_VIGENCIA,
  borrarPersonalRemoto,
  cruzarConRegistro,
  cargarPersonalLocal,
  cargarPersonalRemoto,
  guardarPersonalLocal,
  guardarPersonalRemoto,
  leerPersonal,
  olvidarPersonalLocal,
  ordenarPorEtapa,
  rolesDe,
  seccionDe,
  vigenciaDe,
} from "../lib/personal.js";
import { supabaseEnabled } from "../lib/supabaseClient.js";
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
  // null mientras no se haya tocado nada: entonces manda la sección propuesta
  // a partir de los equipos del registro. En cuanto se elige a mano, manda la
  // elección, aunque sea vaciarla.
  const [seccionesElegidas, setSeccionesElegidas] = useState(null);
  const [rolesFuera, setRolesFuera] = useState(() => new Set());
  const [anios, setAnios] = useState(ANIOS_VIGENCIA);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  // Si el consolidado que se está usando es el guardado para todos, o sólo el
  // de este navegador (porque Supabase no está conectado, o porque la subida
  // a la nube falló).
  const [enLaNube, setEnLaNube] = useState(false);

  // El consolidado guardado se trae al abrir y manda sobre el de este
  // navegador: es el que subió quien lo actualizó por última vez, desde donde
  // fuera. Va aparte y sin bloquear nada; sin conexión se sigue con el local,
  // que es lo que había antes.
  useEffect(() => {
    if (!supabaseEnabled) return;
    let vigente = true;
    (async () => {
      const remoto = await cargarPersonalRemoto();
      if (!vigente || !remoto) return;
      setLibro(remoto);
      setEnLaNube(true);
      guardarPersonalLocal(remoto);
    })();
    return () => {
      vigente = false;
    };
  }, []);

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
  // Un producto puede pasar por más de una sección —se fabrica en cápsulas
  // blandas y se acondiciona en otra—, así que se eligen las que hagan falta.
  const elegidas = useMemo(
    () => seccionesElegidas ?? (seccionPropuesta ? [seccionPropuesta] : []),
    [seccionesElegidas, seccionPropuesta]
  );

  const activas = useMemo(
    () => secciones.filter((s) => elegidas.includes(s.seccion)),
    [secciones, elegidas]
  );

  // En el orden del libro, no en el orden en que se fueron pinchando: así el
  // rótulo de arriba y las franjas del cuadro dicen lo mismo.
  const nombresActivos = useMemo(() => activas.map((s) => s.seccion), [activas]);

  // La misma persona puede estar en dos secciones con roles distintos, así que
  // cada fila se queda con la suya: sin eso, dos filas iguales en el cuadro no
  // se sabría de dónde salen.
  const personalElegido = useMemo(
    () => activas.flatMap((s) => s.personal.map((p) => ({ ...p, seccion: s.seccion }))),
    [activas]
  );

  const roles = useMemo(
    () => [...new Set(activas.flatMap((s) => rolesDe(s)))].sort(),
    [activas]
  );

  // Quién de las secciones elegidas firmó los registros del lote, y en qué
  // operación.
  const cruce = useMemo(
    () => cruzarConRegistro(personalElegido, registros),
    [personalElegido, registros]
  );

  // En el mismo orden que el documento —fabricación primero, acondicionado al
  // final— para que lo que se ve en pantalla y lo que se imprime coincidan.
  const filas = useMemo(
    () =>
      ordenarPorEtapa(cruce.filas.filter((p) => !rolesFuera.has(p.rol))).map((p) => ({
        ...p,
        vigencia: vigenciaDe(p, { anios }),
      })),
    [cruce, rolesFuera, anios]
  );

  // El hallazgo que de verdad busca un expediente: quién hizo un trabajo cuya
  // calificación para ese rol no estaba vigente.
  const sinRespaldo = useMemo(
    () => filas.filter((f) => f.intervinoEnElRol && f.vigencia.estado !== "vigente"),
    [filas]
  );

  const cuenta = useMemo(() => {
    const c = { vigente: 0, vencida: 0, "sin-fecha": 0 };
    for (const f of filas) c[f.vigencia.estado] += 1;
    return c;
  }, [filas]);

  async function cargarExcel(files) {
    setError(null);
    setAviso(null);
    setTrabajando("Leyendo el consolidado…");
    try {
      const leido = await leerPersonal(await files[0].arrayBuffer(), { fileName: files[0].name });
      setLibro(leido);
      setSeccionesElegidas(null);
      setRolesFuera(new Set());
      const cupoEnLocal = guardarPersonalLocal(leido);

      // La copia que de verdad importa es la de la nube: es la que sigue ahí
      // al limpiar el navegador y la que ve el resto del equipo. La local pasa
      // a ser sólo un atajo para no esperar a la red al abrir.
      setTrabajando("Guardando el consolidado…");
      const guardado = await guardarPersonalRemoto(leido);
      setEnLaNube(guardado.ok && !guardado.skipped);

      if (!guardado.ok) {
        setAviso(
          `El consolidado se cargó y ya se está usando, pero no se pudo guardar para todos: ${guardado.error}. ¿Falta ejecutar supabase_migration_v15.sql?`
        );
      } else if (guardado.skipped && !cupoEnLocal) {
        setAviso("El consolidado no cupo en la memoria del navegador: habrá que volver a subirlo la próxima vez.");
      }
    } catch (err) {
      setError(`No se pudo leer el consolidado: ${err.message}`);
    } finally {
      setTrabajando("");
    }
  }

  async function quitarExcel() {
    olvidarPersonalLocal();
    setLibro(null);
    setSeccionesElegidas(null);
    setAviso(null);
    setEnLaNube(false);
    // Quitarlo aquí lo quita en todas partes: si sólo se borrara el de este
    // navegador, al recargar volvería el de la nube y parecería que el botón
    // no hizo nada.
    const res = await borrarPersonalRemoto();
    if (!res.ok) setAviso(`Se quitó de este navegador, pero no de la nube: ${res.error}`);
  }

  function alternarSeccion(nombre) {
    setSeccionesElegidas((previas) => {
      const base = previas ?? (seccionPropuesta ? [seccionPropuesta] : []);
      return base.includes(nombre) ? base.filter((s) => s !== nombre) : [...base, nombre];
    });
    // Los roles de la sección que entra no tienen por qué estar apagados
    // porque alguien apagara uno del mismo nombre en otra.
    setRolesFuera(new Set());
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
        sinConsolidado: cruce.sinConsolidado,
        secciones: nombresActivos,
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
      (activas.length > 0
        ? ` · ${nombresActivos.join(", ")}: ${filas.length} filas, ${cuenta.vencida} vencida(s)`
        : " · ninguna sección elegida")
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
        {aviso && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {aviso}
          </p>
        )}
        {libro && (
          <p className="muted protocolo-nota">
            {enLaNube
              ? "Este consolidado está guardado para todos: quien abra la aplicación desde otra computadora lo encuentra puesto."
              : "Este consolidado sólo está en este navegador. Para que lo vea el resto del equipo hace falta la tabla de Supabase (supabase_migration_v15.sql)."}
          </p>
        )}

        {libro && (
          <>
            <div className="f8-controles">
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

            <div className="f8-roles">
              <span className="muted">Secciones:</span>
              {secciones.map((s) => (
                <button
                  key={s.seccion}
                  className={`sap-pastilla ${elegidas.includes(s.seccion) ? "sap-pastilla--ok" : ""}`}
                  onClick={() => alternarSeccion(s.seccion)}
                  aria-pressed={elegidas.includes(s.seccion)}
                  title={`${new Set(s.personal.map((p) => p.nombre)).size} personas`}
                >
                  {s.seccion}
                </button>
              ))}
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

            {activas.length === 0 && (
              <p className="protocolo-error">
                <IconAlert size={14} /> Elige al menos una sección para armar el cuadro.
              </p>
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
              {registros.length > 0 && (
                <span className="sap-pastilla">
                  {filas.filter((f) => f.intervinoEnElRol).length} intervinieron en el lote
                </span>
              )}
            </div>

            {sinRespaldo.length > 0 && (
              <p className="protocolo-error">
                <IconAlert size={14} /> {sinRespaldo.length} rol(es) se ejecutaron en este lote sin calificación
                vigente: {sinRespaldo.map((f) => `${f.nombre} (${f.rol})`).join("; ")}.
              </p>
            )}

            {registros.length > 0 && cruce.sinConsolidado.length > 0 && (
              <p className="muted protocolo-nota">
                Firmaron el registro y no figuran en esta sección del consolidado:{" "}
                <strong>{cruce.sinConsolidado.join(", ")}</strong>. Puede ser personal de otra sección —los
                supervisores a menudo lo son—: lo que consta es que no están en esta hoja, no que no estén
                calificados.
              </p>
            )}

            <table className="protocolo-tabla">
              <thead>
                <tr>
                  {elegidas.length > 1 && <th>Sección</th>}
                  <th>Nombre del personal</th>
                  <th>Etapa donde interviene</th>
                  <th>Fecha</th>
                  <th>Vence</th>
                  <th>Estado</th>
                  {registros.length > 0 && <th>Intervino en el lote</th>}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => {
                  const e = ETIQUETA[f.vigencia.estado];
                  return (
                    <tr key={`${f.seccion}|${f.nombre}|${f.rol}|${i}`} className={f.vigencia.estado === "vencida" ? "is-vencida" : ""}>
                      {elegidas.length > 1 && <td>{f.seccion}</td>}
                      <td>{f.nombre}</td>
                      <td>{f.rol}</td>
                      <td>{f.fecha || "—"}</td>
                      <td>{f.vigencia.vence || "—"}</td>
                      <td className={e.clase}>{e.texto}</td>
                      {registros.length > 0 && (
                        <td className={f.intervinoEnElRol ? "f8-intervino" : "f8-estado--sin"}>
                          {f.intervinoEnElRol
                            ? "Sí, en esta etapa"
                            : f.intervino
                              ? "Sí, en otra etapa"
                              : "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="f8-acciones">
              <button className="btn btn--primary" onClick={descargar} disabled={!!trabajando || filas.length === 0}>
                <IconDownload size={15} /> Descargar Formato 8 (.docx)
              </button>
              <button className="btn btn--ghost" onClick={quitarExcel}>
                Olvidar el consolidado
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
