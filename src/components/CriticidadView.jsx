import { useEffect, useMemo, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconAlert, IconDownload, IconCheck, IconLayers } from "./Icons.jsx";
import { processPdfFile } from "../lib/parsers/index.js";
import { separarLecturas } from "../lib/atributos/modelo.js";
import { atributosDelProtocolo } from "../lib/atributos/protocolo.js";
import { correr, pasoEstadistico } from "../lib/criticidad/corrida.js";
import { CRITICO, evaluar, npr } from "../lib/criticidad/modelo.js";
import {
  guardarSeveridadesLocal,
  guardarSeveridadesRemotas,
  iniciarSeveridades,
  mapaDeSeveridades,
  severidadesEnUso,
  usarSeveridades,
} from "../lib/criticidad/severidad.js";
import {
  TODOS_LOS_PASOS,
  exportarCriticidadExcel,
  exportarCriticidadWord,
  fuenteDe,
} from "../lib/exportCriticidad.js";

const NOMBRES_DE_PASO = [
  "Atributos de calidad",
  "Severidad por atributo",
  "Causa-efecto",
  "Clasificación",
  "FMEA de los Críticos",
  "Vínculo estadístico",
  "Plan de reevaluación",
];

/**
 * Evaluación de Criticidad y Riesgo: los 7 pasos del procedimiento.
 *
 * Los registros salen por defecto de lo ya cargado en Detección de
 * Parámetros; la zona de carga está para un producto sin analizar y para el
 * protocolo, que es opcional.
 *
 * Lo que hace esta pantalla y no hace el documento: dejar ajustar la
 * severidad. Es la pieza que decide toda la clasificación, así que la IA la
 * propone y quien valida la corrige — y al corregirla, la reclasificación es
 * INSTANTÁNEA, sin volver a preguntarle a nadie, porque el Paso 3 es una
 * regla y no una consulta. Lo corregido se guarda por atributo y vale para
 * los siguientes productos.
 */
export default function CriticidadView({ documentos = [], productos = [] }) {
  const [familia, setFamilia] = useState(productos[0] || "");
  const [forma, setForma] = useState("");
  const [subidos, setSubidos] = useState([]);
  const [protocolo, setProtocolo] = useState(null);
  const [corrida, setCorrida] = useState(null);
  const [severidades, setSeveridades] = useState([]);
  // Las respuestas a la pregunta de desempeño que se han corregido a mano.
  // Se guardan aparte del screening para poder recalcular sin perderlas.
  const [desempeno, setDesempeno] = useState({});
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);
  const [guardado, setGuardado] = useState("");

  useEffect(() => {
    iniciarSeveridades().then((lista) => setSeveridades(lista));
  }, []);

  const enUso = useMemo(() => {
    if (subidos.length > 0) return subidos;
    return documentos.filter((d) => d.kind !== "orden" && (!familia || d.familia === familia));
  }, [subidos, documentos, familia]);

  const previo = useMemo(() => separarLecturas(enUso), [enUso]);
  const producto = subidos[0]?.meta?.producto || familia || enUso[0]?.producto || "";
  const lotes = [...new Set(enUso.map((d) => d.lote || d.meta?.lote).filter(Boolean))];
  const lote = lotes.length === 1 ? lotes[0] : "";

  // La reclasificación con las severidades de ahora mismo. Se recalcula al
  // cambiar una severidad, sin llamar a nadie: el Paso 3 es una regla.
  const resultado = useMemo(() => {
    if (!corrida) return null;
    const mapa = mapaDeSeveridades(severidades);
    const screening = corrida.screening.map((f) =>
      f.id in desempeno ? { ...f, desempeno: desempeno[f.id], desempenoRevisado: true } : f
    );
    const { filas, paraFmea, resumen } = evaluar(screening, mapa);

    // El FMEA ya pedido se vuelve a casar con las filas que siguen siendo
    // críticas: si una deja de serlo al bajar su severidad, su P y su D se
    // quedan guardadas por si vuelve, pero no salen en el cuadro.
    const porId = new Map(corrida.fmea.map((f) => [f.id, f]));
    const fmea = paraFmea.map((f) => {
      const previo = porId.get(f.id);
      return {
        ...f,
        probabilidad: previo?.probabilidad ?? null,
        detectabilidad: previo?.detectabilidad ?? null,
        racionalFmea: previo?.racionalFmea || "",
        npr: npr(f.severidad, previo?.probabilidad, previo?.detectabilidad),
      };
    });

    const conSeveridad = corrida.atributos.map((a) => ({ ...a, severidad: mapa[a.nombre] ?? null }));
    return { filas, fmea, resumen, atributos: conSeveridad, estadistico: pasoEstadistico(severidades) };
  }, [corrida, severidades, desempeno]);

  async function cargar(files) {
    setError(null);
    setTrabajando("Leyendo…");
    const nuevos = [];
    try {
      for (const [i, file] of files.entries()) {
        setTrabajando(`Leyendo ${i + 1} de ${files.length}…`);
        if (/\.docx$/i.test(file.name)) {
          setProtocolo(await atributosDelProtocolo(file));
          continue;
        }
        const doc = await processPdfFile(file);
        if (doc.kind === "orden") {
          setError(`"${file.name}" es una Orden de Producción: no trae parámetros que evaluar.`);
          continue;
        }
        nuevos.push({ ...doc, producto: doc.meta.producto, lote: doc.meta.lote, familia: doc.meta.producto, fileName: file.name });
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
    setGuardado("");
    setTrabajando("Evaluando…");
    try {
      const r = await correr(enUso, {
        producto,
        forma,
        atributosExtra: protocolo?.atributos || [],
        onAvance: ({ paso, texto }) => setTrabajando(`Paso ${paso} · ${texto}`),
      });
      // El screening se guarda aparte: es lo caro (bibliografía + IA) y es lo
      // que permite reclasificar al vuelo cuando se ajusta una severidad.
      setCorrida({ screening: r.filas, fmea: r.fmea, atributos: r.atributos, avisos: r.avisos, discrepancias: r.discrepancias });
      const lista = severidadesEnUso();
      const fusionadas = r.severidades.length > 0 ? r.severidades : lista;
      setSeveridades(fusionadas);
      usarSeveridades(fusionadas);
      guardarSeveridadesLocal(fusionadas);
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  }

  /**
   * La pregunta de desempeño de proceso: ¿afecta al rendimiento, al tiempo o
   * a la consistencia? Decide entre Clave y No Clave para todo lo que no
   * llega a Crítico, así que tiene que poder corregirse: la IA la propone,
   * pero quien conoce la planta sabe si un enfriamiento hace perder tiempo.
   */
  function ajustarDesempeno(id, valor) {
    setDesempeno((previos) => {
      const siguientes = { ...previos };
      if (valor === "") delete siguientes[id];
      else siguientes[id] = valor === "si";
      return siguientes;
    });
  }

  function ajustarSeveridad(atributo, valor) {
    const n = Number(valor);
    setSeveridades((previas) => {
      const siguientes = previas.map((s) =>
        s.atributo === atributo ? { ...s, severidad: n, origen: "revisada" } : s
      );
      usarSeveridades(siguientes);
      guardarSeveridadesLocal(siguientes);
      return siguientes;
    });
    setGuardado("");
  }

  async function guardarSeveridades() {
    setGuardado("Guardando…");
    const res = await guardarSeveridadesRemotas(severidades);
    setGuardado(res.ok ? (res.skipped ? "Guardado en este navegador." : "Guardado para todos los equipos.") : `No se pudo guardar: ${res.error}`);
  }

  const atributos = useMemo(
    () => [...previo.atributos, ...(protocolo?.atributos || [])],
    [previo.atributos, protocolo]
  );
  const nombresDeAtributos = useMemo(() => [...new Set(atributos.map((a) => a.nombre))], [atributos]);

  const datosDelDocumento = resultado && {
    producto, forma, lote,
    etapas: [...new Set(resultado.filas.map((f) => f.etapa))].map((etapa) => ({
      etapa,
      parametros: resultado.filas.filter((f) => f.etapa === etapa).length,
      atributos: resultado.atributos.filter((a) => a.etapa === etapa).map((a) => a.nombre),
    })),
    atributos: resultado.atributos,
    severidades,
    filas: resultado.filas,
    fmea: resultado.fmea,
    estadistico: resultado.estadistico,
    resumen: resultado.resumen,
  };

  return (
    <div className="clasificacion">
      <section className="card">
        <h2 className="seccion-titulo">Evaluación de Criticidad y Riesgo</h2>
        <p className="muted">
          Los siete pasos del procedimiento (ICH Q9(R1), PDA TR60): atributos de calidad, severidad de cada uno,
          causa-efecto por parámetro, clasificación Crítico / Clave / No Clave, FMEA sólo de los Críticos, vínculo
          estadístico con el muestreo del PPQ y plan de reevaluación.
        </p>
        <ol className="criticidad-pasos">
          {NOMBRES_DE_PASO.map((n, i) => (
            <li key={i}>
              <span className="criticidad-pasos__n">{i}</span> {n}
            </li>
          ))}
        </ol>

        <div className="criticidad-campos">
          {productos.length > 0 && subidos.length === 0 && (
            <label className="f8-campo">
              <span>Producto analizado</span>
              <select value={familia} onChange={(e) => setFamilia(e.target.value)}>
                <option value="">Todos</option>
                {productos.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          )}
          <label className="f8-campo">
            <span>Forma farmacéutica (opcional)</span>
            <input
              type="text"
              value={forma}
              onChange={(e) => setForma(e.target.value)}
              placeholder="cápsula blanda, crema, solución inyectable…"
            />
          </label>
        </div>

        <div className="upload-row">
          <UploadZone
            onFiles={cargar}
            busy={!!trabajando}
            busyLabel={trabajando}
            compact={subidos.length > 0 || !!protocolo}
            title="Registros o protocolo (opcional)"
            compactTitle="Agregar otro documento"
            hint="Si no subes nada se usan los registros ya cargados en Detección de Parámetros. El protocolo en Word (.docx) añade los atributos con su especificación."
            // Los registros vienen en PDF y el protocolo en Word. Sin decirlo
            // aquí, la zona de carga descartaba el .docx en el filtro y no
            // llegaba nunca al lector que sí sabe leerlo.
            extensiones={[".pdf", ".docx"]}
            tipos={["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]}
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
        </p>

        <button className="btn btn--primary" onClick={ejecutar} disabled={!!trabajando || enUso.length === 0}>
          {trabajando || "Evaluar criticidad"}
        </button>
      </section>

      {corrida?.avisos?.length > 0 && (
        <section className="card">
          {corrida.avisos.map((a, i) => (
            <p key={i} className="protocolo-error">
              <IconAlert size={14} /> {a}
            </p>
          ))}
        </section>
      )}

      {resultado && (
        <>
          <section className="card">
            <h3 className="seccion-titulo">Paso 1 · Severidad por atributo</h3>
            <p className="muted">
              Es lo que decide toda la clasificación: sólo severidad 4 o 5 puede producir un parámetro Crítico.
              Ajústala y el cuadro de abajo se recalcula al instante — no se vuelve a preguntar a nadie, porque la
              clasificación es una regla. Lo que corrijas queda guardado por atributo y vale para los próximos productos.
            </p>

            {corrida.discrepancias?.length > 0 && (
              <p className="protocolo-error">
                <IconAlert size={14} /> La IA propuso otra severidad para{" "}
                {corrida.discrepancias.map((d) => `${d.atributo} (${d.propuesta} en vez de ${d.guardada})`).join(", ")}.
                Se mantuvo la revisada.
              </p>
            )}

            <table className="protocolo-tabla">
              <thead>
                <tr>
                  <th>Atributo</th>
                  <th>Severidad</th>
                  <th>Decisión</th>
                  <th>Justificación</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {severidades.map((s) => (
                  <tr key={s.atributo} className={s.severidad >= 4 ? "es-critico" : undefined}>
                    <td><strong>{s.atributo}</strong></td>
                    <td>
                      <select value={s.severidad} onChange={(e) => ajustarSeveridad(s.atributo, e.target.value)}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </td>
                    <td className="muted">{s.decision || "—"}</td>
                    <td className="muted">{s.justificacion || "—"}</td>
                    <td className="muted">{s.origen === "revisada" ? "Revisada" : "Propuesta por IA"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button className="btn" onClick={guardarSeveridades} disabled={severidades.length === 0}>
              Guardar severidades
            </button>
            {guardado && <span className="muted"> {guardado}</span>}
          </section>

          <section className="card card--table">
            <div className="toolbar">
              <span className="muted">
                {resultado.resumen.total} parámetros ·{" "}
                <strong>{resultado.resumen.criticos} Críticos</strong> · {resultado.resumen.claves} Clave ·{" "}
                {resultado.resumen.noClaves} No Clave
                {resultado.resumen.pendientes > 0 && ` · ${resultado.resumen.pendientes} pendientes`}
              </span>
              <span className="toolbar__spacer" />
              <button className="btn" onClick={() => exportarCriticidadWord({ ...datosDelDocumento, pasos: [0, 1, 2, 3] })}>
                <IconDownload size={15} /> Word (0-3)
              </button>
              <button className="btn" onClick={() => exportarCriticidadWord({ ...datosDelDocumento, pasos: TODOS_LOS_PASOS })}>
                <IconDownload size={15} /> Word completo
              </button>
              <button className="btn btn--primary" onClick={() => exportarCriticidadExcel(datosDelDocumento)}>
                <IconDownload size={15} /> Excel
              </button>
            </div>

            <table className="protocolo-tabla">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Parámetro</th>
                  <th>Criterio</th>
                  <th>Atributo vinculado</th>
                  <th>S</th>
                  <th>Vía de resolución</th>
                  <th>¿Afecta al desempeño?</th>
                  <th>Clasificación</th>
                  <th>Fuente</th>
                </tr>
              </thead>
              <tbody>
                {resultado.filas.map((f) => (
                  <tr key={f.id} className={f.clasificacion === CRITICO ? "es-critico" : undefined}>
                    <td className="muted">{f.etapa}</td>
                    <td><strong>{f.magnitud}</strong><div className="muted">{f.seccion}</div></td>
                    <td>{f.criterios?.join(" ; ") || "—"}</td>
                    <td>
                      {f.afecta?.join(" / ") || "—"}
                      {f.atributosFueraDeLista?.length > 0 && (
                        <div className="muted">
                          La IA nombró además: {f.atributosFueraDeLista.join(", ")} (no está en el Paso 0)
                        </div>
                      )}
                    </td>
                    <td>{f.severidad ?? "—"}</td>
                    <td className="muted">{f.via}</td>
                    <td>
                      {f.clasificacion === CRITICO ? (
                        <span className="muted">No aplica</span>
                      ) : (
                        <>
                          <select
                            value={f.desempeno === true ? "si" : f.desempeno === false ? "no" : ""}
                            onChange={(e) => ajustarDesempeno(f.id, e.target.value)}
                          >
                            <option value="">Sin responder</option>
                            <option value="si">Sí</option>
                            <option value="no">No</option>
                          </select>
                          {f.desempenoMotivo && <div className="muted">{f.desempenoMotivo}</div>}
                        </>
                      )}
                    </td>
                    <td>{f.clasificacion || "Pendiente"}</td>
                    <td className="muted">{fuenteDe(f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {resultado.fmea.length > 0 && (
            <section className="card card--table">
              <div className="toolbar">
                <span className="muted">
                  Paso 4 · FMEA de los {resultado.fmea.length} parámetros Críticos. El NPR prioriza entre ellos; no
                  cambia la clasificación.
                </span>
              </div>
              <table className="protocolo-tabla">
                <thead>
                  <tr>
                    <th>Etapa</th><th>Parámetro</th><th>Atributo</th><th>S</th><th>P</th><th>D</th><th>NPR</th><th>Racional</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.fmea.map((f) => (
                    <tr key={f.id}>
                      <td className="muted">{f.etapa}</td>
                      <td><strong>{f.magnitud}</strong></td>
                      <td>{f.afecta?.join(" / ") || "—"}</td>
                      <td>{f.severidad ?? "—"}</td>
                      <td>{f.probabilidad ?? "—"}</td>
                      <td>{f.detectabilidad ?? "—"}</td>
                      <td>{f.npr ?? "—"}</td>
                      <td className="muted">{f.racionalFmea || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {resultado.estadistico.length > 0 && (
            <section className="card card--table">
              <div className="toolbar">
                <span className="muted">
                  Paso 5 · lo que la severidad exige al muestreo del PPQ. La confianza la fija el TR60; lo que se
                  ajusta es la cobertura.
                </span>
              </div>
              <table className="protocolo-tabla">
                <thead>
                  <tr><th>Severidad</th><th>Confianza</th><th>Cobertura</th><th>n aprox.</th><th>Atributos</th></tr>
                </thead>
                <tbody>
                  {resultado.estadistico.map((e) => (
                    <tr key={e.etiqueta}>
                      <td>{e.etiqueta}</td>
                      <td>{Math.round(e.confianza * 100)} %</td>
                      <td>{Math.round(e.cobertura * 100)} %</td>
                      <td>≈ {e.n}</td>
                      <td className="muted">{e.atributos.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
