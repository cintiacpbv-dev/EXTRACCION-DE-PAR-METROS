import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UploadZone from "./UploadZone.jsx";
import { IconAlert, IconDownload, IconCheck, IconLayers, IconTrash } from "./Icons.jsx";
import { relativeDate } from "../lib/formatDate.js";
import { processPdfFile } from "../lib/parsers/index.js";
import { separarLecturas } from "../lib/atributos/modelo.js";
import { atributosDelProtocolo as atributosDelProtocoloAntiguo } from "../lib/atributos/protocolo.js";
import { atributosDelProtocolo, leerProtocoloParaCriticidad } from "../lib/criticidad/protocolo.js";
import { formaDelProducto, partidaSinConfirmar } from "../lib/criticidad/puntoDePartida.js";
import { correr, pasoEstadistico } from "../lib/criticidad/corrida.js";
import { aplicarAjustesDeVinculo } from "../lib/criticidad/corroborar.js";
import { abrirEvaluacion, borrarEvaluacion, evaluacionDesde, guardarEvaluacion, listarHistorial } from "../lib/criticidad/historial.js";
import { CRITICO, evaluar, nivelDeNpr, npr } from "../lib/criticidad/modelo.js";
import {
  anotarSeveridades,
  guardarSeveridadesLocal,
  guardarSeveridadesRemotas,
  iniciarSeveridades,
  mapaDeSeveridades,
  severidadesEnUso,
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
  // Los vínculos parámetro → atributo que se corrigieron aceptando (o
  // deshaciendo) una sugerencia de la corroboración. Igual que el desempeño:
  // aparte, para reclasificar al vuelo sin perderlos.
  const [vinculos, setVinculos] = useState({});
  // Corroborar con Consulta PDF y con la segunda lectura de la IA. Tarda más
  // —una pregunta a la bibliografía por atributo y por parámetro—, pero deja
  // cada decisión con su cita; se puede apagar para una corrida rápida.
  const [corroborar, setCorroborar] = useState(true);
  const [soloRevisar, setSoloRevisar] = useState(false);
  const [trabajando, setTrabajando] = useState("");
  const [error, setError] = useState(null);
  const [guardado, setGuardado] = useState("");

  // El historial. `meta` es de qué va la evaluación que está en pantalla
  // —producto, forma, lote, de dónde salió—, fijado al evaluarla o al
  // reabrirla: si después se cambia el selector de producto, el Word de esta
  // evaluación tiene que seguir diciendo el producto que se evaluó.
  const [historial, setHistorial] = useState([]);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [evaluacionId, setEvaluacionId] = useState(null);
  const [creado, setCreado] = useState(null);
  const [guardadoEn, setGuardadoEn] = useState(null);
  const [meta, setMeta] = useState(null);
  const [reabierta, setReabierta] = useState(false);
  const [avisoHistorial, setAvisoHistorial] = useState("");

  // El catálogo de severidades es de toda la planta; `severidades` es sólo la
  // parte que esta corrida usa y enseña. Mezclarlos borraba las severidades
  // de los demás productos al evaluar uno nuevo.
  useEffect(() => {
    iniciarSeveridades();
  }, []);

  const enUso = useMemo(() => {
    if (subidos.length > 0) return subidos;
    return documentos.filter((d) => d.kind !== "orden" && (!familia || d.familia === familia));
  }, [subidos, documentos, familia]);

  const previo = useMemo(() => separarLecturas(enUso), [enUso]);
  // Con el análisis de riesgo del protocolo, lo que se evalúa es el producto
  // del protocolo, no el que esté elegido en el selector: la corrida sale
  // entera de ese documento. Sin él, manda lo cargado.
  const producto =
    (protocolo?.analisis?.length && protocolo?.producto) ||
    subidos[0]?.meta?.producto || familia || enUso[0]?.producto || protocolo?.producto || "";
  const lotes = [...new Set(enUso.map((d) => d.lote || d.meta?.lote).filter(Boolean))];
  const lote = lotes.length === 1 ? lotes[0] : "";

  // La reclasificación con las severidades de ahora mismo. Se recalcula al
  // cambiar una severidad, sin llamar a nadie: el Paso 3 es una regla.
  const resultado = useMemo(() => {
    if (!corrida) return null;
    const mapa = mapaDeSeveridades(severidades);
    const screening = aplicarAjustesDeVinculo(corrida.screening, vinculos).map((f) =>
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
    return { filas, fmea, resumen, atributos: conSeveridad, estadistico: pasoEstadistico(severidades, conSeveridad) };
  }, [corrida, severidades, desempeno, vinculos]);

  async function cargar(files) {
    setError(null);
    setTrabajando("Leyendo…");
    const nuevos = [];
    try {
      for (const [i, file] of files.entries()) {
        setTrabajando(`Leyendo ${i + 1} de ${files.length}…`);
        if (/\.docx$/i.test(file.name)) {
          // Del protocolo interesan tres cosas: la especificación del producto
          // terminado (Paso 0), su análisis de riesgo (Paso 2) y, si no trae
          // análisis, los atributos de sus cuadros por etapa, como antes.
          const [leido, antiguo] = await Promise.all([
            leerProtocoloParaCriticidad(file),
            atributosDelProtocoloAntiguo(file).catch(() => ({ atributos: [] })),
          ]);
          setProtocolo({ ...leido, atributosDeEtapas: antiguo.atributos || [] });
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
    // Cada corrida es una evaluación nueva en el historial: la anterior se
    // queda guardada tal como estaba.
    clearTimeout(temporizadorRef.current);
    setEvaluacionId(null);
    setCreado(null);
    setGuardadoEn(null);
    setReabierta(false);
    setTrabajando("Evaluando…");
    try {
      const r = await correr(enUso, {
        producto,
        forma,
        protocolo,
        corroborar,
        atributosExtra: protocolo?.analisis?.length ? [] : protocolo?.atributosDeEtapas || [],
        onAvance: ({ paso, texto }) => setTrabajando(`Paso ${paso} · ${texto}`),
      });
      // El screening se guarda aparte: es lo caro (bibliografía + IA) y es lo
      // que permite reclasificar al vuelo cuando se ajusta una severidad.
      setCorrida({
        screening: r.filas, fmea: r.fmea, atributos: r.atributos, avisos: r.avisos, discrepancias: r.discrepancias,
        corroboracionSeveridad: r.corroboracionSeveridad || {}, corroborada: r.corroborada,
      });
      // Las sugerencias aceptadas y el desempeño corregido eran de la corrida
      // anterior, que sigue en el historial con los suyos.
      setVinculos({});
      setDesempeno({});
      setMeta({ producto, forma, lote, fuente: r.fuente, protocoloNombre: r.fuente === "protocolo" ? protocolo?.nombre || "" : "" });
      // Se anotan en el catálogo, no se sustituye: lo de los demás productos
      // sigue ahí. Y lo que se guarda en el navegador es el catálogo entero.
      const catalogo = anotarSeveridades(r.severidades);
      guardarSeveridadesLocal(catalogo);
      setSeveridades(r.severidades.length > 0 ? r.severidades : catalogo);
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

  /**
   * Acepta (o deshace) lo que la corroboración sugiere para un parámetro:
   * añadir los atributos que faltan y quitar los que sobran.
   *
   * Se aplica a todo su grupo acoplado —los parámetros de la misma etapa con
   * el mismo racional—, porque el Paso 3 les da a todos la unión de sus
   * vínculos: quitar un atributo de uno solo no tendría efecto.
   */
  function aceptarSugerencia(fila, aceptar) {
    const clave = (f) => `${f.etapa}|${String(f.racional || "").replace(/\s+/g, " ").trim().toLowerCase()}`;
    const acoplable = String(fila.racional || "").replace(/\s+/g, " ").trim().length >= 25;
    const grupo = acoplable ? corrida.screening.filter((f) => clave(f) === clave(fila)) : [fila];
    setVinculos((previos) => {
      const siguientes = { ...previos };
      for (const f of grupo) {
        if (!aceptar) {
          delete siguientes[f.id];
          continue;
        }
        const { faltan = [], sobran = [] } = fila.corroboracion || {};
        const base = (f.afecta || []).filter((a) => !sobran.includes(a));
        siguientes[f.id] = [...new Set([...base, ...faltan])];
      }
      return siguientes;
    });
  }

  function ajustarSeveridad(atributo, valor) {
    const n = Number(valor);
    setSeveridades((previas) => {
      const siguientes = previas.map((s) =>
        s.atributo === atributo ? { ...s, severidad: n, origen: "revisada" } : s
      );
      // El cambio entra en el catálogo, y es el catálogo entero lo que se
      // respalda: guardar sólo lo que se ve en pantalla borraría el resto.
      // Sólo la fila que cambió: si esta evaluación se reabrió del historial,
      // las demás son las de entonces y no deben pisar el catálogo de hoy.
      guardarSeveridadesLocal(anotarSeveridades(siguientes.filter((s) => s.atributo === atributo)));
      return siguientes;
    });
    setGuardado("");
  }

  async function guardarSeveridades() {
    setGuardado("Guardando…");
    // Se sube el catálogo entero, no sólo lo de esta corrida: puede haber
    // severidades de otro producto ajustadas sin conexión que nunca llegaron.
    const res = await guardarSeveridadesRemotas(severidadesEnUso());
    setGuardado(res.ok ? (res.skipped ? "Guardado en este navegador." : "Guardado para todos los equipos.") : `No se pudo guardar: ${res.error}`);
  }

  const atributos = useMemo(
    () =>
      protocolo?.analisis?.length
        ? atributosDelProtocolo(protocolo)
        : [...(protocolo?.especificaciones || []), ...previo.atributos, ...(protocolo?.atributosDeEtapas || [])],
    [previo.atributos, protocolo]
  );
  const nombresDeAtributos = useMemo(() => [...new Set(atributos.map((a) => a.nombre))], [atributos]);

  // La clasificación que el protocolo traía, en el esquema anterior. Sólo se
  // enseña cuando la hay: con registros solos no existe.
  const conAnterior = !!resultado?.filas.some((f) => f.clasificacionAnterior);

  // Los parámetros de punto de partida del procedimiento que no quedaron
  // Críticos: es la verificación que el procedimiento pide hacer.
  const sinConfirmar = useMemo(
    () => (resultado ? partidaSinConfirmar(resultado.filas, CRITICO, formaDelProducto(forma, producto)) : []),
    [resultado, forma, producto]
  );

  // Cuántas filas del análisis de riesgo coinciden con la bibliografía y la
  // IA, y cuántas quedan para revisar. Sólo cuando se corroboró.
  const resumenCorroboracion = useMemo(() => {
    const conCorrob = (corrida?.screening || []).filter((f) => f.corroboracion);
    if (conCorrob.length === 0) return null;
    return {
      coinciden: conCorrob.filter((f) => f.corroboracion.estado === "coincide").length,
      revisar: conCorrob.filter((f) => f.corroboracion.estado === "revisar").length,
      aceptadas: conCorrob.filter((f) => f.corroboracion.estado === "revisar" && f.id in vinculos).length,
      sinRevisar: conCorrob.filter((f) => f.corroboracion.estado === "sin revisar").length,
      conBibliografia: conCorrob.filter((f) => f.corroboracion.referencias).length,
    };
  }, [corrida, vinculos]);

  const filasVisibles = useMemo(
    () => (resultado ? (soloRevisar ? resultado.filas.filter((f) => f.corroboracion?.estado === "revisar") : resultado.filas) : []),
    [resultado, soloRevisar]
  );

  // --- el historial ---------------------------------------------------------

  const refrescarHistorial = useCallback(async () => {
    setHistorial(await listarHistorial());
  }, []);

  useEffect(() => {
    refrescarHistorial();
  }, [refrescarHistorial]);

  // Lo que hay en pantalla, para que el guardado automático no tenga que
  // depender de cada cambio y reprogramarse solo.
  const estadoRef = useRef({});
  estadoRef.current = { corrida, severidades, desempeno, vinculos, resultado, meta, evaluacionId, creado };

  /**
   * Guarda la evaluación tal como está: la corrida y lo ajustado a mano
   * encima. La primera vez crea el registro; después lo actualiza.
   *
   * Es automático, como en el Análisis de Riesgo: lo que no se puede perder
   * son los ajustes a mano, y un botón que hay que acordarse de pulsar los
   * perdería igual.
   */
  const guardarAhora = useCallback(async () => {
    const e = estadoRef.current;
    if (!e.corrida || !e.resultado || !e.meta) return;
    const evaluacion = evaluacionDesde({
      id: e.evaluacionId,
      creado: e.creado,
      ...e.meta,
      corrida: e.corrida,
      severidades: e.severidades,
      desempeno: e.desempeno,
      vinculos: e.vinculos,
      resumen: e.resultado.resumen,
    });
    if (!e.evaluacionId) {
      setEvaluacionId(evaluacion.id);
      setCreado(evaluacion.creado);
    }
    const res = await guardarEvaluacion(evaluacion);
    setGuardadoEn(evaluacion.actualizado);
    setAvisoHistorial(
      res.ok ? "" : `La evaluación se guardó en este navegador, pero no en la nube: ${res.error}. ¿Falta ejecutar supabase_migration_v19.sql?`
    );
    refrescarHistorial();
  }, [refrescarHistorial]);

  // Se guarda sola tras cada evaluación y cada ajuste, con una pausa para no
  // escribir en cada clic. Al reabrir una del historial no se guarda: abrirla
  // no es cambiarla, y guardarla la subiría al principio de la lista.
  const temporizadorRef = useRef(null);
  const saltarGuardadoRef = useRef(false);
  useEffect(() => {
    if (!corrida || !meta) return;
    if (saltarGuardadoRef.current) {
      saltarGuardadoRef.current = false;
      return;
    }
    clearTimeout(temporizadorRef.current);
    temporizadorRef.current = setTimeout(guardarAhora, 1500);
    return () => clearTimeout(temporizadorRef.current);
  }, [corrida, severidades, desempeno, vinculos, meta, guardarAhora]);

  async function abrirDelHistorial(id) {
    const evaluacion = await abrirEvaluacion(id);
    const d = evaluacion?.datos;
    if (!d?.corrida) {
      setAvisoHistorial("No se pudo abrir esa evaluación: puede que se haya borrado desde otra computadora.");
      refrescarHistorial();
      return;
    }
    clearTimeout(temporizadorRef.current);
    saltarGuardadoRef.current = true;
    setError(null);
    setGuardado("");
    setAvisoHistorial("");
    setCorrida(d.corrida);
    setSeveridades(d.severidades || []);
    setDesempeno(d.desempeno || {});
    setVinculos(d.vinculos || {});
    setMeta({ producto: d.producto, forma: d.forma, lote: d.lote, fuente: d.fuente, protocoloNombre: d.protocoloNombre });
    setForma(d.forma || "");
    setEvaluacionId(evaluacion.id);
    setCreado(evaluacion.creado);
    setGuardadoEn(evaluacion.actualizado);
    setReabierta(true);
    setSoloRevisar(false);
    setHistorialAbierto(false);
  }

  async function eliminarDelHistorial(id, nombre) {
    if (!window.confirm(`¿Eliminar la evaluación "${nombre}"? Se borra de este navegador y de la nube, y no se puede deshacer.`)) return;
    const res = await borrarEvaluacion(id);
    setAvisoHistorial(res.ok ? "" : `No se pudo borrar de la nube: ${res.error}. Se quitó de este navegador.`);
    // Si era la que estaba en pantalla, se limpia: seguir enseñando una
    // evaluación que ya no existe invita a seguir ajustándola para nada.
    if (id === evaluacionId) nuevaEvaluacion();
    refrescarHistorial();
  }

  function nuevaEvaluacion() {
    clearTimeout(temporizadorRef.current);
    setCorrida(null);
    setSeveridades([]);
    setDesempeno({});
    setVinculos({});
    setMeta(null);
    setEvaluacionId(null);
    setCreado(null);
    setGuardadoEn(null);
    setReabierta(false);
    setGuardado("");
  }

  const datosDelDocumento = resultado && {
    producto: meta?.producto ?? producto,
    forma: meta?.forma ?? forma,
    lote: meta?.lote ?? lote,
    etapas: [...new Set(resultado.filas.map((f) => f.etapa))].map((etapa) => ({
      etapa,
      parametros: resultado.filas.filter((f) => f.etapa === etapa).length,
      atributos: resultado.atributos.filter((a) => a.etapa === etapa).map((a) => a.nombre),
    })),
    atributos: resultado.atributos,
    severidades,
    corroboracionSeveridad: corrida?.corroborada ? corrida.corroboracionSeveridad : null,
    filas: resultado.filas,
    fmea: resultado.fmea,
    estadistico: resultado.estadistico,
    resumen: resultado.resumen,
  };

  return (
    <div className="clasificacion">
      <section className="riesgo-historial">
        <div className="riesgo-historial__barra">
          <button className="btn btn--ghost" onClick={() => setHistorialAbierto((v) => !v)} aria-expanded={historialAbierto}>
            <IconLayers size={14} />
            Historial ({historial.length})
          </button>
          {corrida && (
            <>
              <button className="btn btn--ghost" onClick={nuevaEvaluacion} disabled={!!trabajando}>
                Nueva evaluación
              </button>
              <span className="muted riesgo-historial__estado">
                {guardadoEn ? (
                  <>
                    <IconCheck size={13} /> Guardada {relativeDate(guardadoEn)}
                  </>
                ) : (
                  "Sin guardar todavía"
                )}
              </span>
            </>
          )}
        </div>
        {avisoHistorial && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {avisoHistorial}
          </p>
        )}

        {historialAbierto && (
          <div className="riesgo-historial__lista">
            {historial.length === 0 ? (
              <p className="muted">
                Todavía no hay evaluaciones guardadas. En cuanto evalúes una, aparecerá aquí sola, con lo que ajustes encima.
              </p>
            ) : (
              <ul>
                {historial.map((a) => (
                  <li key={a.id} className={a.id === evaluacionId ? "is-abierto" : ""}>
                    <button className="riesgo-historial__abrir" onClick={() => abrirDelHistorial(a.id)} title="Abrir esta evaluación">
                      <strong>{a.nombre || a.producto || "Sin producto"}</strong>
                      <span className="muted">
                        {resumenCorto(a.resumen)} · {relativeDate(a.actualizado)}
                        {a.id === evaluacionId ? " · abierta ahora" : ""}
                      </span>
                    </button>
                    <button
                      className="btn btn--ghost btn--icon"
                      onClick={() => eliminarDelHistorial(a.id, a.nombre || a.producto)}
                      title="Eliminar esta evaluación"
                    >
                      <IconTrash size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {reabierta && meta && (
        <section className="card">
          <p className="muted">
            <IconCheck size={14} /> Evaluación del historial: <strong>{meta.producto || "sin producto"}</strong>
            {meta.forma ? ` (${meta.forma})` : ""}, evaluada {relativeDate(creado)} desde{" "}
            {meta.fuente === "protocolo" ? `el protocolo${meta.protocoloNombre ? ` ${meta.protocoloNombre}` : ""}` : "los registros"}.
            Se ve tal como quedó, con sus severidades y sus ajustes; lo que cambies se guarda en ella. Para evaluar de nuevo,
            pulsa «Evaluar criticidad»: será una evaluación nueva y ésta queda como está.
          </p>
        </section>
      )}

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
            <IconCheck size={14} /> Protocolo leído: {protocolo.especificaciones.length} atributo(s) de la especificación
            del producto terminado
            {protocolo.analisis.length > 0
              ? ` y su análisis de riesgo: ${protocolo.analisis.length} parámetros en ${
                  new Set(protocolo.analisis.map((f) => f.etapa)).size
                } etapas. Los pasos 0 y 2 salen del protocolo; la IA sólo propone severidades, desempeño y el FMEA.`
              : ". No trae análisis de riesgo: los parámetros salen de los registros."}
            {protocolo.analisis.length > 0 && corroborar &&
              " Con la corroboración activada, cada fila de ese análisis se revisa además contra Consulta PDF y la IA: lo que falte o sobre queda como sugerencia, sin cambiar nada solo."}
          </p>
        )}
        {error && (
          <p className="protocolo-error">
            <IconAlert size={14} /> {error}
          </p>
        )}

        <p className="muted">
          <IconLayers size={14} /> {enUso.length} registro(s) ·{" "}
          {protocolo?.analisis?.length ? `${protocolo.analisis.length} parámetros del protocolo` : `${previo.parametros.length} parámetros`} ·{" "}
          {nombresDeAtributos.length} atributos de calidad
        </p>

        <label className="criticidad-corroborar">
          <input type="checkbox" checked={corroborar} onChange={(e) => setCorroborar(e.target.checked)} disabled={!!trabajando} />
          <span>
            <strong>Corroborar con Consulta PDF y la IA</strong>
            <span className="muted">
              {" "}— cada atributo y cada parámetro se consulta en la bibliografía, y la IA decide con esa evidencia delante
              (y cita la fuente). Tarda más; sin marcarlo, la IA evalúa sola.
            </span>
          </span>
        </label>

        <button className="btn btn--primary" onClick={ejecutar} disabled={!!trabajando || (enUso.length === 0 && !protocolo?.analisis?.length)}>
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
                  {corrida.corroborada && <th>Bibliografía y segunda opinión</th>}
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
                    {corrida.corroborada && (
                      <td>
                        <CorroboracionDeSeveridad
                          c={corrida.corroboracionSeveridad?.[s.atributo]}
                          actual={s.severidad}
                          onUsar={(n) => ajustarSeveridad(s.atributo, n)}
                        />
                      </td>
                    )}
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

            {resumenCorroboracion && (
              <div className="criticidad-resumen-corrob">
                <span>
                  <strong>Corroboración del análisis de riesgo:</strong> {resumenCorroboracion.coinciden} coinciden ·{" "}
                  <strong>{resumenCorroboracion.revisar} para revisar</strong>
                  {resumenCorroboracion.aceptadas > 0 && ` (${resumenCorroboracion.aceptadas} aceptadas)`} ·{" "}
                  {resumenCorroboracion.conBibliografia} con respaldo en la bibliografía
                  {resumenCorroboracion.sinRevisar > 0 && ` · ${resumenCorroboracion.sinRevisar} sin revisar (la IA no respondió)`}
                </span>
                {resumenCorroboracion.revisar > 0 && (
                  <label>
                    <input type="checkbox" checked={soloRevisar} onChange={(e) => setSoloRevisar(e.target.checked)} /> Ver sólo
                    las filas para revisar
                  </label>
                )}
              </div>
            )}

            <table className="protocolo-tabla tabla-parametros">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Parámetro</th>
                  <th>Criterio</th>
                  <th>Atributo vinculado</th>
                  <th>S</th>
                  <th>Vía de resolución</th>
                  <th>¿Afecta al desempeño?</th>
                  {conAnterior && <th>Antes</th>}
                  <th>Clasificación</th>
                  <th>Fuente</th>
                </tr>
              </thead>
              <tbody>
                {filasVisibles.map((f) => (
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
                    {conAnterior && <td className="muted">{f.clasificacionAnterior || "—"}</td>}
                    <td>{f.clasificacion || "Pendiente"}</td>
                    <td className="muted">
                      {fuenteDe(f)}
                      <CorroboracionDeParametro
                        f={f}
                        aceptada={f.id in vinculos}
                        onAceptar={() => aceptarSugerencia(f, true)}
                        onDeshacer={() => aceptarSugerencia(f, false)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {sinConfirmar.length > 0 && (
            <section className="card">
              <p className="protocolo-error">
                <IconAlert size={14} /> {sinConfirmar.length} parámetro(s) que el procedimiento propone como críticos de
                punto de partida no quedaron Críticos. No es un error por sí mismo, pero hay que poder justificarlo:
              </p>
              <ul className="muted">
                {sinConfirmar.map((x, i) => (
                  <li key={i}>
                    <strong>{x.parametro}</strong> ({x.etapa}) salió {x.clasificacion}. {x.motivo} Punto de partida:
                    «{x.partida}» — {x.fundamento}
                  </li>
                ))}
              </ul>
            </section>
          )}

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
                    <th>Etapa</th><th>Parámetro</th><th>Atributo</th><th>S</th><th>P</th><th>D</th><th>NPR</th><th>Nivel de riesgo</th><th>Racional</th>
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
                      <td>
                        {nivelDeNpr(f.npr) ? (
                          <span className={`npr npr--${nivelDeNpr(f.npr).color.toLowerCase()}`}>
                            {nivelDeNpr(f.npr).color} · {nivelDeNpr(f.npr).nivel}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
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

/** Lo que dijeron la bibliografía y la segunda lectura de la IA de una severidad. */
function CorroboracionDeSeveridad({ c, actual, onUsar }) {
  if (!c) return <span className="muted">Sin información en la bibliografía</span>;
  return (
    <div className="corrob">
      {c.severidadSugerida && c.severidadSugerida !== actual ? (
        <>
          <span className="corrob__marca corrob__marca--revisar">Revisar: sugiere {c.severidadSugerida}</span>
          <button type="button" className="btn btn--primary btn--mini" onClick={() => onUsar(c.severidadSugerida)}>
            Usar {c.severidadSugerida}
          </button>
        </>
      ) : (
        <span className="corrob__marca corrob__marca--ok">{c.conEvidencia ? "Propuesta con evidencia" : "Coincide"}</span>
      )}
      {c.motivo && <div className="muted">{c.motivo}</div>}
      {c.referencias && <div className="corrob__cita">{c.referencias}</div>}
    </div>
  );
}

/** Lo mismo para un parámetro del análisis de riesgo del protocolo. */
function CorroboracionDeParametro({ f, aceptada, onAceptar, onDeshacer }) {
  const c = f.corroboracion;
  if (!c) return null;
  return (
    <div className="corrob">
      {c.estado === "revisar" ? (
        <>
          <span className={`corrob__marca ${aceptada ? "corrob__marca--ok" : "corrob__marca--revisar"}`}>
            {aceptada ? "Sugerencia aplicada" : "Revisar"}
          </span>
          {aceptada ? (
            <button type="button" className="btn btn--ghost btn--mini" onClick={onDeshacer}>Deshacer</button>
          ) : (
            <button type="button" className="btn btn--primary btn--mini" onClick={onAceptar}>Aplicar</button>
          )}
        </>
      ) : aceptada ? (
        // Acoplado a una fila cuya sugerencia se aceptó: cambió con su grupo.
        <span className="corrob__marca corrob__marca--revisar">Ajustado con su grupo acoplado</span>
      ) : c.estado === "coincide" ? (
        <span className="corrob__marca corrob__marca--ok">Corroborado</span>
      ) : (
        <span className="muted">Sin revisar</span>
      )}
      {c.estado === "revisar" && (
        <div className="corrob__cambio">
          {[c.faltan.length ? `Añadir: ${c.faltan.join(", ")}` : "", c.sobran.length ? `Quitar: ${c.sobran.join(", ")}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {c.motivo && <div className="muted">{c.motivo}</div>}
      {c.referencias && <div className="corrob__cita">{c.referencias}</div>}
    </div>
  );
}

/** "112 parámetros · 35 Críticos · 11 Clave · 29 No Clave", para la lista. */
function resumenCorto(r) {
  if (!r || !r.total) return "sin resumen";
  return `${r.total} parámetros · ${r.criticos} Críticos · ${r.claves} Clave · ${r.noClaves} No Clave`;
}
