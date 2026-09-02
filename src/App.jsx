import { useEffect, useMemo, useRef, useState } from "react";
import UploadZone from "./components/UploadZone.jsx";
import ParamTable from "./components/ParamTable.jsx";
import LoadedBatches from "./components/LoadedBatches.jsx";
import ProductLibrary from "./components/ProductLibrary.jsx";
import PersonnelPanel from "./components/PersonnelPanel.jsx";
import ProductImagePicker from "./components/ProductImagePicker.jsx";
import SapPanel from "./components/SapPanel.jsx";
import ProtocoloPanel from "./components/ProtocoloPanel.jsx";
import Formato3Panel from "./components/Formato3Panel.jsx";
import Formato01Panel from "./components/Formato01Panel.jsx";
import RiesgoView from "./components/RiesgoView.jsx";
import BarraProgreso from "./components/BarraProgreso.jsx";
import {
  IconCloud,
  IconDrive,
  IconCopy,
  IconCheck,
  IconDownload,
  IconFlask,
  IconLayers,
  IconAlert,
  IconArrowLeft,
  IconGrid,
  IconFileText,
  IconFilter,
  IconUpload,
  IconChevronDown,
  IconMessageSquare,
} from "./components/Icons.jsx";
import ArchivosOmitidos from "./components/ArchivosOmitidos.jsx";
import ConsultaPdf from "./components/ConsultaPdf.jsx";
import { construirPreguntaValidacion } from "./lib/consultaPdf.js";
import { processPdfFile } from "./lib/parsers/index.js";
import { computeContentHash, findDuplicateDocument } from "./lib/dedupe.js";
import { analisisPrevio, huellaDeArchivo, olvidarAnalisis, recordarAnalisis } from "./lib/analizados.js";
import {
  loadLocalDocuments,
  saveLocalDocuments,
  upsertDocument,
  docKey,
  syncDocumentToSupabase,
  deleteDocumentFromSupabase,
  loadDocumentsFromSupabase,
  marcarEliminados,
  olvidarEliminado,
  purgarEliminados,
  readmitirDocumento,
} from "./lib/storage.js";
import { supabaseEnabled } from "./lib/supabaseClient.js";
import { documentoEsMuestraMedica } from "./lib/muestraMedica.js";
import {
  cargarImagenesLocales,
  guardarImagenesLocales,
  cargarImagenesRemotas,
  guardarImagenRemota,
  borrarImagenRemota,
} from "./lib/productImage.js";
import { exportProductToExcel, tableToClipboardText } from "./lib/exportExcel.js";
import { exportCuadrosToWord } from "./lib/exportCuadros.js";
import {
  aggregatePersonnel,
  buildTable,
  claveLote,
  listProducts,
  listStages,
  summarizeProducts,
  withFamilies,
} from "./lib/model.js";
import "./App.css";

// La URL refleja qué se está viendo (#/ · #/nuevo · #/producto/<nombre>) para
// poder recargar la página, mandar un enlace, o usar atrás/adelante del
// navegador y volver exactamente a donde se estaba.
//
// La sesión en blanco tiene su propia ruta (#/nuevo) a propósito: cuando no la
// tenía, "Nuevo análisis" escribía "#/" —que se lee como la biblioteca— y el
// oyente de hashchange devolvía al usuario a la biblioteca de inmediato. Al
// entrar sin ningún hash (el caso normal) ese primer "#/" sí cambia la URL y
// dispara el evento, de modo que el primer clic se perdía y había que pulsar
// dos veces para poder cargar archivos.
function readRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash === "nuevo") return { view: "product", producto: null, blank: true };
  if (hash === "consulta") return { view: "consulta", producto: null, blank: false };
  if (hash === "riesgo") return { view: "riesgo", producto: null, blank: false };
  if (hash.startsWith("producto/")) {
    return {
      view: "product",
      producto: decodeURIComponent(hash.slice("producto/".length)),
      blank: false,
    };
  }
  return { view: "library", producto: null, blank: false };
}

function routeHash(view, producto, blank) {
  if (view === "consulta") return "#/consulta";
  if (view === "riesgo") return "#/riesgo";
  if (view !== "product") return "#/";
  return blank || !producto ? "#/nuevo" : `#/producto/${encodeURIComponent(producto)}`;
}

function writeRoute(view, producto, blank) {
  const next = routeHash(view, producto, blank);
  if (window.location.hash !== next) window.location.hash = next;
}

/**
 * Cómo llamar a un archivo mientras se analiza. Si quien lo manda sabe a qué
 * lote pertenece —el panel de SAP lo sabe— se usa eso; si no, el nombre del
 * archivo sin la extensión ni los guiones bajos, que se lee mejor.
 */
function etiquetaDe(file, etiquetas) {
  if (!file) return "";
  return (
    etiquetas?.[file.name] ||
    file.name.replace(/\.pdf$/i, "").replace(/_+/g, " ").trim()
  );
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [view, setView] = useState("library"); // "library" | "product" | "consulta"
  // Pregunta con la que se abre el chat de Consulta PDF al validar contra la
  // bibliografía; null cuando se entra por el enlace de la barra, sin
  // pregunta (se ve la portada, como siempre).
  const [consultaQuery, setConsultaQuery] = useState(null);
  const [producto, setProducto] = useState(null);
  // true entre "Nuevo análisis" y la primera carga exitosa: la vista de
  // producto se muestra en blanco, sin caer sobre uno ya existente.
  const [blank, setBlank] = useState(false);
  const [stage, setStage] = useState(null);
  const [onlyCritical, setOnlyCritical] = useState(true);
  // "etapa": los informes en Word salen enfocados sólo a la etapa activa, sin
  // columnas vacías de las demás. "todas": el informe combinado de siempre.
  const [reportScope, setReportScope] = useState("etapa");
  // Las muestras médicas (descripción con "MM") suelen quedar fuera del
  // estudio; la preferencia se recuerda entre sesiones.
  const [omitirMM, setOmitirMM] = useState(() => localStorage.getItem("deteccion-parametros:omitirMM") === "1");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  // Avance de la tanda en curso: cuántos documentos van, cuántos son y cuál
  // se está analizando. Lo pinta la barra de progreso.
  const [progreso, setProgreso] = useState(null);
  // Qué zona de carga está trabajando, para no anunciar el mismo archivo en
  // las dos a la vez.
  const [busyKind, setBusyKind] = useState(null);
  // Los archivos que se soltaron pero ya se habían analizado. No se leen: se
  // quedan aquí, agrupados por producto, hasta que se pida analizarlos.
  const [omitidos, setOmitidos] = useState([]);
  const [messages, setMessages] = useState([]);
  const [copyState, setCopyState] = useState("idle");
  const [loading, setLoading] = useState(true);
  // Imagen de cada producto (familia → PNG en data URI o enlace) y qué
  // producto tiene abierto el selector. Lo guardado en este navegador se lee
  // ya en el primer render; lo de Supabase llega después.
  const [imagenes, setImagenes] = useState(cargarImagenesLocales);
  const [imagenAbierta, setImagenAbierta] = useState(null);
  const [cargaAbierta, setCargaAbierta] = useState(false);

  // Procesar un PDF es asíncrono y dura varios segundos. Leer los documentos
  // del estado capturado al empezar haría que una segunda carga (o un borrado
  // hecho entretanto) pisara lo recién añadido, así que se consulta siempre
  // la referencia viva.
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  // Los avisos se descartan solos; si el componente se desmonta antes, los
  // temporizadores pendientes se cancelan.
  const timersRef = useRef([]);
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // Las imágenes de Supabase se traen aparte de los documentos: son
  // opcionales y no deben retrasar ni bloquear la carga del análisis.
  useEffect(() => {
    if (!supabaseEnabled) return;
    (async () => {
      const remotas = await cargarImagenesRemotas();
      if (Object.keys(remotas).length === 0) return;
      setImagenes((previas) => {
        const unidas = { ...previas, ...remotas };
        guardarImagenesLocales(unidas);
        return unidas;
      });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      // Primero se resuelven las eliminaciones que quedaron a medias: si no,
      // lo que aún estaba en Supabase se leería como si nunca se hubiera
      // borrado.
      const ocultas = await purgarEliminados();
      const vivo = (d) => !ocultas.has(docKey(d));

      const locales = loadLocalDocuments().filter(vivo);
      let docs = locales;

      if (supabaseEnabled) {
        const remotos = (await loadDocumentsFromSupabase()).filter(vivo);

        // Se unen las dos fuentes en vez de que una pise a la otra. Si un
        // análisis se hizo mientras la app estaba sin conexión a Supabase
        // (por credenciales faltantes, por ejemplo), vive sólo en este
        // navegador: reemplazarlo por lo remoto lo perdería.
        const porClave = new Map(locales.map((d) => [docKey(d), d]));
        for (const doc of remotos) porClave.set(docKey(doc), doc);
        docs = [...porClave.values()];

        // Lo que sólo existía en local se sube, para que quede disponible
        // desde cualquier otra computadora.
        //
        // Salvo lo eliminado: "está aquí y no en la nube" es también el
        // aspecto de un documento que se borró desde otra computadora, y sin
        // esta salvedad esta máquina lo resucitaría para todos.
        const clavesRemotas = new Set(remotos.map(docKey));
        const soloLocales = locales.filter((d) => !clavesRemotas.has(docKey(d)) && vivo(d));

        // La subida NO se espera: con noventa documentos sólo locales tarda
        // minutos, y hasta ahora la pantalla se quedaba en "Cargando…" todo
        // ese rato sin enseñar nada. Se lanza aparte, con su barra de avance,
        // y el análisis se puede consultar mientras tanto.
        if (soloLocales.length > 0) subirPendientes(soloLocales);

        saveLocalDocuments(docs);
      }

      setDocuments(docs);

      const route = readRoute();
      const familias = listProducts(withFamilies(docs));

      if (route.blank) {
        setView("product");
        setBlank(true);
      } else if (route.view === "consulta") {
        setView("consulta");
      } else if (route.view === "riesgo") {
        setView("riesgo");
      } else if (route.view === "product" && route.producto) {
        if (familias.includes(route.producto)) {
          setView("product");
          setProducto(route.producto);
        } else {
          // El enlace apunta a un producto que ya no existe (se eliminó, o se
          // abrió en otro navegador): se limpia la URL sin dejar rastro en el
          // historial, para que no siga contradiciendo lo que se ve.
          window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
        }
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    function onHashChange() {
      // La ruta es la única fuente de verdad: se aplica entera, sin dejar
      // fuera "blank", que es lo que antes hacía que la vista y la URL
      // pudieran contradecirse.
      const route = readRoute();
      setView(route.view);
      setProducto(route.producto);
      setBlank(route.blank);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Las etapas de un mismo lote nombran al producto de forma distinta, así que
  // todo el análisis trabaja sobre la familia de producto, no sobre el código.
  const todosDocs = useMemo(() => withFamilies(documents), [documents]);

  // Con la omisión activa las muestras médicas se apartan de TODO lo que se
  // ve y se exporta, no sólo de las cargas nuevas: las que ya estaban
  // guardadas seguían apareciendo en las tablas y en el FORMATO A09.
  const docs = useMemo(
    () => (omitirMM ? todosDocs.filter((d) => !documentoEsMuestraMedica(d)) : todosDocs),
    [todosDocs, omitirMM]
  );

  const muestrasOcultas = todosDocs.length - docs.length;

  const productos = useMemo(() => listProducts(docs), [docs]);

  // Una imagen elegida cuando la tabla de Supabase todavía no existía —o sin
  // conexión— se guarda sólo en este navegador, y en los demás equipos el
  // producto se queda con el icono genérico para siempre, porque al arrancar
  // sólo se descargan las imágenes, nunca se suben. Aquí se suben las que
  // falten, una vez que se sabe qué productos hay: las de productos ya
  // borrados no se recuperan, para no dejar filas huérfanas.
  const imagenesSincronizadas = useRef(false);
  useEffect(() => {
    if (!supabaseEnabled || imagenesSincronizadas.current || productos.length === 0) return;
    imagenesSincronizadas.current = true;

    (async () => {
      const remotas = await cargarImagenesRemotas();
      for (const familia of productos) {
        const imagen = imagenes[familia];
        if (!imagen || remotas[familia]) continue;
        await guardarImagenRemota(familia, imagen);
      }
    })();
  }, [productos, imagenes]);
  const resumenProductos = useMemo(() => summarizeProducts(docs), [docs]);

  // La selección se resuelve durante el render, salvo en una sesión nueva en
  // blanco: ahí no debe caer sobre el primer producto existente, porque el
  // punto de "Nuevo análisis" es precisamente no mezclarse con lo anterior.
  const productoActivo = blank
    ? null
    : producto && productos.includes(producto)
      ? producto
      : (productos[0] ?? null);

  const stages = useMemo(
    () => (productoActivo ? listStages(docs, productoActivo) : []),
    [docs, productoActivo]
  );
  const stageActiva = stage && stages.includes(stage) ? stage : stages[0] ?? null;

  const table = useMemo(
    () =>
      productoActivo && stageActiva
        ? buildTable(docs, productoActivo, stageActiva, { onlyCritical })
        : null,
    [docs, productoActivo, stageActiva, onlyCritical]
  );

  const personnel = useMemo(
    () => (productoActivo && stageActiva ? aggregatePersonnel(docs, productoActivo, stageActiva) : null),
    [docs, productoActivo, stageActiva]
  );

  // Qué documentos hay ya en el análisis, con la misma clave que usa el
  // ayudante de descargas (lote + etapa + tipo), para no ofrecer analizar
  // dos veces lo mismo. El lote lleva la marca de muestra médica porque un
  // mismo lote y etapa traen a la vez venta y muestra: sin ella, analizar
  // uno daría por analizado al otro y ese documento no se cargaría nunca.
  // Se cuenta sobre TODO lo cargado, incluidas las muestras médicas ocultas:
  // si no, el panel de SAP ofrecería una y otra vez analizar documentos que
  // luego se descartan, y el contador nunca bajaría.
  const analizados = useMemo(
    () => new Set(todosDocs.map((d) => `${claveLote(d)}::${d.stage}::${d.kind || "registro"}`)),
    [todosDocs]
  );

  const productDocs = useMemo(
    () => docs.filter((d) => d.familia === productoActivo),
    [docs, productoActivo]
  );

  // Con el producto ya analizado, lo que se viene a hacer es mirar sus
  // parámetros por etapa; cargar documentos y traer lotes del SAP ya se hizo.
  // Ese bloque se pliega para que la pantalla empiece por el producto.
  const puedePlegarCarga = !blank && productDocs.length > 0;

  function pushMessage(text, type = "info") {
    const id = Date.now() + Math.random();
    setMessages((m) => [...m, { id, text, type }]);
    timersRef.current.push(setTimeout(() => setMessages((m) => m.filter((x) => x.id !== id)), 7000));
  }

  function openProduct(familia) {
    setBlank(false);
    setProducto(familia);
    setView("product");
    writeRoute("product", familia, false);
  }

  function startNew() {
    setBlank(true);
    setProducto(null);
    setStage(null);
    setView("product");
    writeRoute("product", null, true);
  }

  function backToLibrary() {
    setView("library");
    setBlank(false);
    writeRoute("library", null, false);
  }

  function openConsulta(pregunta) {
    setConsultaQuery(pregunta ? { pregunta, nonce: Date.now() } : null);
    setView("consulta");
    writeRoute("consulta", null, false);
  }

  function openRiesgo() {
    setView("riesgo");
    writeRoute("riesgo", null, false);
  }

  /**
   * `etiquetas` permite decir con qué nombre mostrar cada archivo mientras se
   * analiza. Los que vienen de SAP se llaman por el número del documento, que
   * no dice nada; el panel de SAP sí sabe a qué lote y etapa corresponden y
   * lo pasa por aquí. Arrastrando archivos a mano no hay nada mejor que el
   * propio nombre del archivo.
   */
  /**
   * Sube a Supabase los documentos que sólo están en este navegador.
   *
   * Va por su cuenta, sin bloquear la pantalla: es trabajo de puesta al día
   * que no hace falta esperar para empezar a mirar el análisis.
   */
  async function subirPendientes(docs) {
    let subidos = 0;
    for (const [i, doc] of docs.entries()) {
      setProgreso({ hecho: i, total: docs.length, actual: `Subiendo ${doc.lote} · ${doc.stage}` });
      const res = await syncDocumentToSupabase(doc);
      if (res.ok && !res.skipped) subidos++;
    }
    setProgreso(null);
    if (subidos > 0) {
      pushMessage(`Se subieron a Supabase ${subidos} documento(s) que estaban sólo en este navegador.`, "success");
    }
  }

  /**
   * Analiza otra vez archivos que se habían apartado.
   *
   * Se olvida su marca antes de volver a leerlos: si el análisis falla a
   * medias, el archivo queda como nuevo y se puede reintentar, en vez de
   * quedar apartado por un análisis que nunca llegó a completarse.
   */
  async function analizarDeNuevo(apartados) {
    const huellas = apartados.map((a) => a.huella);
    olvidarAnalisis(huellas);
    setOmitidos((previos) => previos.filter((a) => !huellas.includes(a.huella)));
    await handleFiles(
      apartados.map((a) => a.file),
      undefined,
      { forzar: true }
    );
  }

  /** Los quita de la lista sin analizarlos: siguen contando como analizados. */
  function descartarOmitidos(apartados) {
    const huellas = apartados.map((a) => a.huella);
    setOmitidos((previos) => previos.filter((a) => !huellas.includes(a.huella)));
  }

  async function handleFiles(files, expectedKind, { etiquetas, forzar = false } = {}) {
    if (busy) return; // una segunda tanda simultánea pisaría a la primera
    setBusy(true);
    setBusyKind(expectedKind);

    // Antes de abrir ningún PDF se mira si ya se analizó. La huella del
    // archivo se calcula sobre sus bytes, así que cuesta milisegundos frente a
    // los segundos que cuesta leerlo entero. Lo ya visto se aparta —no se
    // analiza— y queda a la vista por si se quiere repetir.
    setBusyLabel("Revisando…");
    setProgreso({ hecho: 0, total: files.length, actual: "Revisando qué hay que analizar…" });

    const porAnalizar = [];
    const apartados = [];
    for (const file of files) {
      const huella = await huellaDeArchivo(file);
      const previo = forzar ? null : analisisPrevio(huella);
      if (previo) apartados.push({ huella, file, previo });
      else porAnalizar.push({ huella, file });
    }

    if (apartados.length > 0) {
      setOmitidos((previos) => {
        const porHuella = new Map(previos.map((a) => [a.huella, a]));
        for (const a of apartados) porHuella.set(a.huella, a);
        return [...porHuella.values()];
      });
      pushMessage(
        `${apartados.length} archivo(s) ya se habían analizado: se apartaron sin volver a leerlos. Están en "Ya analizados" por si quieres repetirlos.`,
        "info"
      );
    }

    if (porAnalizar.length === 0) {
      setBusy(false);
      setBusyLabel("");
      setBusyKind(null);
      setProgreso(null);
      return;
    }

    const huellaDe = new Map(porAnalizar.map((a) => [a.file, a.huella]));
    files = porAnalizar.map((a) => a.file);
    setProgreso({ hecho: 0, total: files.length, actual: etiquetaDe(files[0], etiquetas) });
    let next = documentsRef.current;
    const nuevos = [];
    // Huellas de contenido ya vistas en esta misma tanda de carga, para
    // detectar dos archivos idénticos seleccionados juntos por error.
    const hashesEnEstaTanda = [];

    for (const [indice, file] of files.entries()) {
      setBusyLabel("Analizando…");
      setProgreso({ hecho: indice, total: files.length, actual: etiquetaDe(file, etiquetas) });
      try {
        const result = await processPdfFile(file);

        // Muestra médica: se descarta antes de analizarla, que es lo que
        // ahorra el trabajo, no sólo ocultarla después.
        if (omitirMM && documentoEsMuestraMedica({ producto: result.meta.producto, meta: result.meta, orden: result.orden })) {
          pushMessage(`${file.name}: es muestra médica (MM) — omitida.`, "info");
          continue;
        }

        // La zona de carga es sólo una guía: el tipo real se sigue detectando
        // por el contenido, así que un archivo en la zona equivocada no se
        // pierde, sólo se avisa.
        if (expectedKind && result.kind !== expectedKind) {
          pushMessage(
            `${file.name} es ${result.kind === "orden" ? "una Orden de Producción" : "un RMD"}, no ${
              expectedKind === "orden" ? "una Orden de Producción" : "un RMD"
            } — se procesó igual, según lo que es.`,
            "info"
          );
        }

        // Una orden no tiene parámetros: su huella se calcula sobre lo que sí
        // la identifica, que son sus insumos y el número de orden.
        const contentHash = await computeContentHash(
          result.kind === "orden"
            ? [
                { section: "ORDEN", label: result.meta.orden || "", value: result.meta.lote },
                ...result.orden.insumos.map((i) => ({
                  section: "INSUMO",
                  label: i.codigo,
                  value: `${i.loteMaterial}|${i.consumo}`,
                })),
              ]
            : result.params
        );

        // Un documento ya cargado con el mismo contenido no se vuelve a
        // procesar… salvo que al reprocesarlo aporte algo que la copia
        // guardada no tiene. Es el caso de los análisis hechos antes de que
        // la app detectara el personal: sin esta salvedad, volver a subir el
        // PDF quedaría bloqueado y ese dato nunca se podría completar.
        const yaVisto =
          hashesEnEstaTanda.find((h) => h.hash === contentHash) ||
          (await findDuplicateDocument(next, contentHash));

        if (yaVisto) {
          const cuenta = (d) =>
            (d?.personnel?.operarios?.length || 0) + (d?.personnel?.supervisores?.length || 0);
          const sumaParticipantes = cuenta(result) > 0 && cuenta(yaVisto) === 0;
          const sumaReceta = !!result.meta?.receta && !yaVisto.meta?.receta;
          const sumaInsumos = (result.insumos?.length || 0) > 0 && (yaVisto.insumos?.length || 0) === 0;
          const sumaEquipos = (result.equipos?.length || 0) > 0 && (yaVisto.equipos?.length || 0) === 0;
          // Pedir el análisis a mano manda sobre la comparación: se pide
          // justamente cuando la aplicación ya lee algo que antes no leía, y
          // eso no siempre se nota comparando lo que había.
          const aporta = forzar || sumaParticipantes || sumaReceta || sumaInsumos || sumaEquipos;

          if (!aporta) {
            pushMessage(
              `${file.name}: contenido idéntico a "${yaVisto.fileName}" (lote ${yaVisto.lote}, ${yaVisto.stage}) — se omitió, ya estaba cargado.`,
              "info"
            );
            continue;
          }

          const aportes = [];
          if (sumaParticipantes) aportes.push(`${cuenta(result)} nombres`);
          if (sumaReceta) aportes.push("la receta");
          if (sumaInsumos) aportes.push(`${result.insumos.length} materiales`);
          if (sumaEquipos) aportes.push(`${result.equipos.length} equipos`);
          pushMessage(
            aportes.length > 0
              ? `${file.name}: ya estaba cargado, pero se actualizó con ${aportes.join(" y ")}.`
              : `${file.name}: ya estaba cargado y se volvió a analizar, como pediste.`,
            "success"
          );
        }

        const doc = {
          kind: result.kind,
          producto: result.meta.producto,
          lote: result.meta.lote || "SIN LOTE",
          stage: result.stage,
          fileName: result.fileName,
          meta: result.meta,
          params: result.params,
          personnel: result.personnel,
          insumos: result.insumos || [],
          equipos: result.equipos || [],
          orden: result.orden || null,
          uploadedAt: new Date().toISOString(),
        };
        // Si este documento estaba marcado como eliminado, la marca deja de
        // valer —aquí y en las demás computadoras—: volver a subirlo es la
        // forma de recuperarlo, y sin esto quedaría oculto para siempre.
        await readmitirDocumento(doc);

        next = upsertDocument(next, doc);
        nuevos.push(doc);
        // Queda apuntado para que la próxima vez no haya que volver a leerlo.
        recordarAnalisis(huellaDe.get(file), doc);
        hashesEnEstaTanda.push({ hash: contentHash, fileName: doc.fileName, lote: doc.lote, stage: doc.stage });
        pushMessage(
          doc.kind === "orden"
            ? `${file.name} · Orden ${doc.meta.orden || ""} · ${doc.stage} · lote ${doc.lote} — ${doc.orden.insumos.length} insumos con su lote`
            : `${file.name} · ${doc.stage} · lote ${doc.lote} — ${doc.params.length} parámetros detectados`,
          "success"
        );

        // Un registro maestro todavía sin llenar trae la cabecera en blanco:
        // sirve para conocer el producto y sus parámetros, pero no aporta
        // ninguna lectura que comparar entre lotes.
        if (doc.kind === "registro" && !result.meta.lote) {
          pushMessage(
            `${file.name} no tiene lote asignado: es un registro maestro sin llenar. Se guardó como "SIN LOTE" y no aporta valores que comparar.`,
            "info"
          );
        }
      } catch (err) {
        pushMessage(`${file.name}: ${err.message}`, "error");
      }
    }

    setDocuments(next);
    saveLocalDocuments(next);
    if (nuevos.length > 0) {
      const familiaNueva = withFamilies(next).find((d) => docKey(d) === docKey(nuevos[0]))?.familia;
      setBlank(false);
      setStage(nuevos[0].stage);
      if (familiaNueva) {
        setProducto(familiaNueva);
        writeRoute("product", familiaNueva, false);
      }
    }
    setBusy(false);
    setBusyLabel("");
    setBusyKind(null);

    // La barra se queda al 100 % mientras se sube a la nube en vez de
    // desaparecer al terminar de leer los PDF: subir treinta documentos tarda
    // lo suyo, y sin nada en pantalla parecía que ya había acabado.
    setProgreso({ hecho: files.length, total: files.length, actual: "Guardando…" });

    if (supabaseEnabled) {
      let avisoMigracion = false;
      let avisoReceta = false;
      let avisoTamano = false;
      let avisoEquipos = false;
      for (const doc of nuevos) {
        const res = await syncDocumentToSupabase(doc);
        if (!res.ok && !res.skipped) {
          pushMessage(`No se pudo guardar en Supabase (${doc.stage} lote ${doc.lote}): ${res.error}`, "error");
          continue;
        }

        if (res.equiposWarning && !avisoEquipos) {
          avisoEquipos = true;
          pushMessage(
            "Se guardó todo, pero falta ejecutar supabase_migration_v10.sql para guardar también los equipos de cada etapa (el Formato 3).",
            "info"
          );
        }

        if (res.personnelWarning && !avisoMigracion) {
          avisoMigracion = true;
          pushMessage(
            "Los parámetros se guardaron en Supabase, pero falta ejecutar supabase_migration_v3.sql para guardar también los participantes (operarios/supervisores).",
            "info"
          );
        }

        // Cada columna opcional se avisa por separado (antes una tapaba a la
        // otra): sin la receta, o sin el tamaño de lote, faltan migraciones
        // distintas y conviene decir cuál.
        const faltan = res.columnasFaltantes || [];
        if (faltan.includes("receta") && !avisoReceta) {
          avisoReceta = true;
          pushMessage(
            "Se guardó todo, pero falta ejecutar supabase_migration_v5.sql para que la receta no se pierda al recargar la página.",
            "info"
          );
        }
        if ((faltan.includes("teorico") || faltan.includes("teorico_unidad")) && !avisoTamano) {
          avisoTamano = true;
          pushMessage(
            "Se guardó todo, pero falta ejecutar supabase_migration_v9.sql para separar los productos que se fabrican a más de un tamaño de lote.",
            "info"
          );
        }
      }
    }

    setProgreso(null);
  }

  async function handleRemove(doc) {
    // Se anota antes de tocar nada: si la página se recarga mientras el
    // borrado remoto está en curso, el documento seguirá oculto y el borrado
    // se reintentará al arrancar.
    marcarEliminados([doc]);

    const next = documents.filter((d) => docKey(d) !== docKey(doc));
    setDocuments(next);
    saveLocalDocuments(next);

    if (!supabaseEnabled) return olvidarEliminado(doc);

    const res = await deleteDocumentFromSupabase(doc);
    if (res.ok || res.skipped) olvidarEliminado(doc);
    else pushMessage(`No se pudo borrar de Supabase: ${res.error}. Se reintentará al recargar.`, "error");
  }

  async function handleDeleteProduct(familia) {
    const aBorrar = docs.filter((d) => d.familia === familia);
    if (aBorrar.length === 0) return;

    const lotes = [...new Set(aBorrar.map((d) => d.lote))].length;
    const ok = window.confirm(
      `¿Eliminar "${familia}" por completo? Se borrarán ${lotes} ${lotes === 1 ? "lote" : "lotes"} y ${aBorrar.length} documento(s). Esta acción no se puede deshacer.`
    );
    if (!ok) return;

    // Se anotan todos antes de empezar: el borrado remoto va documento a
    // documento y tarda, así que si se recarga a mitad estos siguen ocultos
    // y lo que falte se reintenta al arrancar.
    marcarEliminados(aBorrar);

    const next = documents.filter((d) => !aBorrar.some((x) => docKey(x) === docKey(d)));
    setDocuments(next);
    saveLocalDocuments(next);

    if (supabaseEnabled) {
      const fallos = [];
      for (const doc of aBorrar) {
        const res = await deleteDocumentFromSupabase(doc);
        if (res.ok || res.skipped) olvidarEliminado(doc);
        else fallos.push(`${doc.stage} lote ${doc.lote}: ${res.error}`);
      }

      if (fallos.length > 0) {
        pushMessage(
          `Quedaron ${fallos.length} documento(s) por borrar en Supabase; se reintentará al recargar. ${fallos[0]}`,
          "error"
        );
      }
    } else {
      for (const doc of aBorrar) olvidarEliminado(doc);
    }

    await handleQuitarImagen(familia);
    pushMessage(`Se eliminó "${familia}".`, "info");
    if (productoActivo === familia) backToLibrary();
  }

  async function handleGuardarImagen(familia, imagen) {
    const siguiente = { ...imagenes, [familia]: imagen };
    setImagenes(siguiente);
    guardarImagenesLocales(siguiente);

    const res = await guardarImagenRemota(familia, imagen);
    if (!res.ok) {
      pushMessage(
        `La imagen se ve en este navegador, pero no se pudo guardar en Supabase: ${res.error}. ¿Falta ejecutar supabase_migration_v7.sql?`,
        "error"
      );
    } else if (!res.skipped) {
      pushMessage(`Imagen actualizada para "${familia}".`, "success");
    }
  }

  async function handleQuitarImagen(familia) {
    const siguiente = { ...imagenes };
    delete siguiente[familia];
    setImagenes(siguiente);
    guardarImagenesLocales(siguiente);
    await borrarImagenRemota(familia);
  }

  async function handleExport() {
    if (!productoActivo) return;
    const ok = await exportProductToExcel(docs, productoActivo, { onlyCritical });
    if (!ok) pushMessage("No hay datos para exportar en este producto.", "error");
  }

  // Con "etapa" el FORMATO A09 sale enfocado sólo a la etapa activa: si de
  // este producto sólo se cargó Acondicionado, no debe mostrar columnas
  // vacías de Fabricación o Envase.
  const stageParaInforme = reportScope === "etapa" ? stageActiva : null;

  async function handleExportFormatoA09() {
    if (!productoActivo) return;
    try {
      await exportCuadrosToWord(docs, productoActivo, { onlyCritical, stage: stageParaInforme });
      pushMessage("FORMATO A09 generado con el formato del reporte de referencia.", "success");
    } catch (err) {
      pushMessage(`No se pudo generar el FORMATO A09: ${err.message}`, "error");
    }
  }

  function handleValidarBibliografia() {
    const pregunta = construirPreguntaValidacion(table, productoActivo, stageActiva);
    if (!pregunta) {
      pushMessage("No hay parámetros con rango para validar contra la bibliografía.", "error");
      return;
    }
    openConsulta(pregunta);
  }

  async function handleCopy() {
    if (!table) return;
    const text = tableToClipboardText(table);
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // La Clipboard API puede estar restringida (permisos, foco, contexto no
      // seguro); se recurre al textarea oculto de toda la vida.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setCopyState(ok ? "copied" : "error");
    setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__start">
          <button className="brand" onClick={backToLibrary} title="Ir a tus análisis">
            <span className="brand__mark">
              <IconFlask size={20} />
            </span>
            <span className="brand__text">
              <strong>Detección de Parámetros</strong>
              <small>Extracción y validación comparativa de registros de manufactura</small>
            </span>
          </button>

          {/* La consulta a la bibliografía vive en su propia aplicación
              —tiene su propia base de datos y sus propias claves de IA—,
              pero se llega a ella desde aquí como una sección más, no como
              un enlace suelto. */}
          <nav className="topnav">
            <button
              className={`topnav__link ${view === "consulta" ? "is-active" : ""}`}
              onClick={() => openConsulta()}
            >
              <IconMessageSquare size={15} /> <span>Consulta PDF</span>
            </button>
            {/* Sección propia, no un panel más de un producto: el registro
                que se sube aquí suele ser la plantilla sin llenar, y no hace
                falta tener ya un análisis cargado para usarla. */}
            <button
              className={`topnav__link ${view === "riesgo" ? "is-active" : ""}`}
              onClick={openRiesgo}
            >
              <IconAlert size={15} /> <span>Análisis de Riesgo</span>
            </button>
          </nav>
        </div>

        <span className={`badge ${supabaseEnabled ? "badge--cloud" : "badge--local"}`}>
          {supabaseEnabled ? <IconCloud size={15} /> : <IconDrive size={15} />}
          {supabaseEnabled ? "Supabase conectado" : "Guardado local"}
        </span>
      </header>

      {/* Sin relleno cuando lo de dentro es Consulta PDF: ese hueco es
          exactamente lo que delataba que había una página metida dentro de
          otra, en vez de ocupar la pantalla entera. */}
      <main className={`main ${view === "consulta" ? "main--consulta" : ""} ${view === "riesgo" ? "main--riesgo" : ""}`}>
        {/* Los avisos viven al nivel de la página, no dentro de la tarjeta de
            carga: cuando estaban ahí, todo lo que se anunciaba desde la
            biblioteca —imagen guardada, producto eliminado— no se llegaba a
            ver nunca. */}
        {messages.length > 0 && (
          <div className="toasts">
            {messages.map((m) => (
              <div key={m.id} className={`toast toast--${m.type}`}>
                {m.type === "success" ? (
                  <IconCheck size={15} />
                ) : m.type === "info" ? (
                  <IconCopy size={15} />
                ) : (
                  <IconAlert size={15} />
                )}
                <span>{m.text}</span>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : view === "consulta" ? (
          <ConsultaPdf query={consultaQuery} />
        ) : view === "riesgo" ? (
          <RiesgoView />
        ) : view === "library" ? (
          <ProductLibrary
            productos={resumenProductos}
            imagenes={imagenes}
            onOpen={openProduct}
            onNew={startNew}
            onDelete={handleDeleteProduct}
            onCambiarImagen={setImagenAbierta}
          />
        ) : (
          <>
            <button className="link-back" onClick={backToLibrary}>
              <IconArrowLeft size={15} /> Todos los productos
            </button>

            {/* Lo primero es saber qué se está mirando: qué producto y qué
                etapa. Antes esto quedaba debajo de tres paneles de
                herramientas plegados y había que buscarlo. */}
            {!blank && productos.length > 0 && (
              <section className="card card--producto">
                <div className="producto-cab">
                  <label className="producto-cab__campo">
                    <span className="rotulo">
                      <IconFlask size={13} /> Producto
                    </span>
                    <select
                      className="producto-cab__select"
                      value={productoActivo || ""}
                      onChange={(e) => openProduct(e.target.value)}
                    >
                      {productos.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="producto-cab__campo">
                    <span className="rotulo">
                      <IconLayers size={13} /> Etapa
                    </span>
                    <div className="tabs">
                      {stages.map((s) => (
                        <button
                          key={s}
                          className={`tab ${stageActiva === s ? "is-active" : ""}`}
                          onClick={() => setStage(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <LoadedBatches documents={productDocs} onRemove={handleRemove} />
              </section>
            )}

            <h2 className="seccion-titulo">Herramientas</h2>

            <section className={`card card--carga ${puedePlegarCarga && !cargaAbierta ? "is-plegada" : ""}`}>
              {/* Con el producto ya analizado, cargar documentos y traer lotes
                  del SAP deja de ser lo que se viene a hacer: se pliega para
                  que la pantalla empiece en el producto y su etapa, que es lo
                  que se consulta. Sigue a un clic para añadir más. */}
              {puedePlegarCarga && !cargaAbierta ? (
                <button
                  className="sap-cabecera sap-cabecera--boton carga-plegada"
                  onClick={() => setCargaAbierta(true)}
                  aria-expanded={false}
                >
                  <span className="sap-icono">
                    <IconUpload size={16} />
                  </span>
                  <div>
                    <strong>Agregar documentos</strong>
                    <p className="muted">
                      Cargar más RMD u órdenes, o traer lotes desde SAP.
                    </p>
                  </div>
                  <IconChevronDown size={16} className="sap-chevron" />
                </button>
              ) : null}

              <div className={puedePlegarCarga && !cargaAbierta ? "carga-oculta" : ""}>
              {puedePlegarCarga && cargaAbierta && (
                <button
                  className="sap-cabecera sap-cabecera--boton carga-plegada"
                  onClick={() => setCargaAbierta(false)}
                  aria-expanded
                >
                  <span className="sap-icono">
                    <IconUpload size={16} />
                  </span>
                  <div>
                    <strong>Agregar documentos</strong>
                    <p className="muted">Ocultar cuando termines.</p>
                  </div>
                  <IconChevronDown size={16} className="sap-chevron is-open" />
                </button>
              )}
              <div className="upload-row">
                <UploadZone
                  onFiles={(files) => handleFiles(files, "registro")}
                  busy={busy}
                  busyLabel={busyKind === "registro" ? busyLabel : ""}
                  compact={!blank && productDocs.length > 0}
                  title="Arrastra aquí los RMD (Registros de Manufactura)"
                  compactTitle="Agregar otro RMD"
                  hint="Cualquier producto y cualquier etapa: Fabricación, Envase, Acondicionado…"
                />
                <UploadZone
                  onFiles={(files) => handleFiles(files, "orden")}
                  busy={busy}
                  busyLabel={busyKind === "orden" ? busyLabel : ""}
                  compact={!blank && productDocs.length > 0}
                  title="Arrastra aquí las Órdenes de Producción / Envase / Acondicionado"
                  compactTitle="Agregar otra orden"
                  hint="Aportan el Lote ME de cada material, el rendimiento oficial y las fechas exactas."
                />
              </div>

              <SapPanel
                onArchivos={(archivos, opciones) => handleFiles(archivos, undefined, opciones)}
                ocupado={busy}
                analizados={analizados}
                omitirMM={omitirMM}
              />

              {/* La barra vive fuera de las zonas de carga a propósito: la
                  tanda puede venir de cualquiera de las dos o de SAP, y el
                  avance es uno solo. */}
              {progreso && <BarraProgreso {...progreso} />}
              </div>
            </section>

            {/* Fuera de la tarjeta de carga: cuando se pliega, lo apartado
                seguiría ahí dentro sin verse, y es justo lo que hay que ver
                para decidir si se analiza otra vez. */}
            <ArchivosOmitidos
              archivos={omitidos}
              onAnalizar={analizarDeNuevo}
              onDescartar={descartarOmitidos}
              ocupado={busy}
            />

            {/* Cada apartado en su propia tarjeta, al mismo nivel: antes
                colgaban dentro de la de carga y se veían como cajas dentro
                de cajas. */}
            {!blank && productDocs.length > 0 && <ProtocoloPanel />}

            {!blank && productDocs.length > 0 && (
              <Formato3Panel documents={docs} familia={productoActivo} />
            )}

            {/* El esquema lee sus propios registros: describe el proceso, no
                un lote, así que no depende de lo que haya cargado el análisis. */}
            <Formato01Panel />

            {!blank && <h2 className="seccion-titulo">Resultados del análisis</h2>}

            {!blank && <PersonnelPanel personnel={personnel} stage={stageActiva} />}

            {!blank && (
              <section className="card card--table">
                <div className="toolbar">
                  {/* Dos grupos: a la izquierda lo que cambia lo que se ve,
                      a la derecha lo que produce un archivo. Sueltos en una
                      sola fila eran ocho controles del mismo peso que se
                      partían por cualquier sitio al estrecharse la ventana. */}
                  <div className="toolbar__grupo">
                  <div className="switch" role="group" aria-label="Alcance de parámetros">
                    <button
                      className={`switch__opt ${onlyCritical ? "is-active" : ""}`}
                      onClick={() => setOnlyCritical(true)}
                    >
                      Parámetros de proceso
                    </button>
                    <button
                      className={`switch__opt ${!onlyCritical ? "is-active" : ""}`}
                      onClick={() => setOnlyCritical(false)}
                    >
                      Todo lo detectado
                    </button>
                  </div>

                  <button
                    className={`btn btn--ghost ${omitirMM ? "btn--activo" : ""}`}
                    onClick={() => {
                      const v = !omitirMM;
                      setOmitirMM(v);
                      localStorage.setItem("deteccion-parametros:omitirMM", v ? "1" : "0");
                      pushMessage(
                        v
                          ? "Las muestras médicas (MM) quedarán fuera del análisis y de las descargas."
                          : "Las muestras médicas (MM) vuelven a incluirse.",
                        "info"
                      );
                    }}
                    title="Las muestras médicas se reconocen por las dos emes mayúsculas de la descripción del producto"
                    aria-pressed={omitirMM}
                  >
                    {omitirMM ? <IconCheck size={16} /> : <IconFilter size={16} />}
                    {omitirMM && muestrasOcultas > 0
                      ? `Muestras médicas fuera (${muestrasOcultas})`
                      : "Omitir muestras médicas"}
                  </button>

                  {table && (
                    <span className="counter">
                      {table.sections.reduce((a, s) => a + s.rows.length, 0)} parámetros ·{" "}
                      {table.lotes.length} {table.lotes.length === 1 ? "lote" : "lotes"}
                    </span>
                  )}

                  </div>

                  <div className="toolbar__grupo toolbar__grupo--fin">
                  <button className="btn btn--ghost" onClick={handleCopy} disabled={!table}>
                    {copyState === "copied" ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    {copyState === "copied" ? "Copiado" : copyState === "error" ? "No se pudo copiar" : "Copiar tabla"}
                  </button>

                  {stages.length > 1 && (
                    <div className="switch" role="group" aria-label="Alcance del FORMATO A09">
                      <button
                        className={`switch__opt ${reportScope === "etapa" ? "is-active" : ""}`}
                        onClick={() => setReportScope("etapa")}
                        title="El FORMATO A09 sale enfocado sólo a esta etapa"
                      >
                        FORMATO A09: solo {stageActiva}
                      </button>
                      <button
                        className={`switch__opt ${reportScope === "todas" ? "is-active" : ""}`}
                        onClick={() => setReportScope("todas")}
                        title="El FORMATO A09 combina todas las etapas cargadas"
                      >
                        Todas las etapas
                      </button>
                    </div>
                  )}

                  <button
                    className="btn btn--ghost"
                    onClick={handleValidarBibliografia}
                    disabled={!table}
                    title="Abre Consulta PDF con una pregunta armada a partir de estos parámetros críticos"
                  >
                    <IconMessageSquare size={16} />
                    Validar contra bibliografía
                  </button>
                  <button className="btn btn--ghost" onClick={handleExportFormatoA09} disabled={!productoActivo}>
                    <IconFileText size={16} />
                    FORMATO A09
                  </button>
                  <button className="btn btn--primary" onClick={handleExport} disabled={!productoActivo}>
                    <IconDownload size={16} />
                    Exportar a Excel
                  </button>
                  </div>
                </div>

                <ParamTable table={table} />
              </section>
            )}
          </>
        )}
      </main>

      {/* Consulta PDF no lleva pie: es lo último que separaba el iframe del
          borde de la pantalla, y la vuelta ya está a un clic en la barra
          de arriba. */}
      {view !== "consulta" && (
        <footer className="footer">
          {view === "product" ? (
            <button className="link-back link-back--footer" onClick={backToLibrary}>
              <IconGrid size={13} /> Volver a tus análisis
            </button>
          ) : (
            "El detector lee la estructura del propio registro, así que admite nuevos productos, etapas y parámetros sin tocar el código."
          )}
        </footer>
      )}

      {imagenAbierta && (
        <ProductImagePicker
          familia={imagenAbierta}
          imagenActual={imagenes[imagenAbierta] || null}
          onGuardar={(imagen) => handleGuardarImagen(imagenAbierta, imagen)}
          onQuitar={() => handleQuitarImagen(imagenAbierta)}
          onCerrar={() => setImagenAbierta(null)}
        />
      )}
    </div>
  );
}
