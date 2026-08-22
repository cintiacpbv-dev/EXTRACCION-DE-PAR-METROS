import { useEffect, useMemo, useState } from "react";
import UploadZone from "./components/UploadZone.jsx";
import ParamTable from "./components/ParamTable.jsx";
import LoadedBatches from "./components/LoadedBatches.jsx";
import ProductLibrary from "./components/ProductLibrary.jsx";
import PersonnelPanel from "./components/PersonnelPanel.jsx";
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
} from "./components/Icons.jsx";
import { processPdfFile } from "./lib/parsers/index.js";
import { computeContentHash, findDuplicateDocument } from "./lib/dedupe.js";
import {
  loadLocalDocuments,
  saveLocalDocuments,
  upsertDocument,
  docKey,
  syncDocumentToSupabase,
  deleteDocumentFromSupabase,
  loadDocumentsFromSupabase,
} from "./lib/storage.js";
import { supabaseEnabled } from "./lib/supabaseClient.js";
import { exportProductToExcel, tableToClipboardText } from "./lib/exportExcel.js";
import { exportCuadrosToWord } from "./lib/exportCuadros.js";
import {
  aggregatePersonnel,
  buildTable,
  listProducts,
  listStages,
  summarizeProducts,
  withFamilies,
} from "./lib/model.js";
import "./App.css";

// La URL refleja qué se está viendo (#/  ·  #/producto/<nombre>) para poder
// recargar la página, mandar un enlace, o usar atrás/adelante del navegador
// y volver exactamente al mismo producto abierto.
function readRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("producto/")) {
    return { view: "product", producto: decodeURIComponent(hash.slice("producto/".length)) };
  }
  return { view: "library", producto: null };
}

function writeRoute(view, producto) {
  const next = view === "product" && producto ? `#/producto/${encodeURIComponent(producto)}` : "#/";
  if (window.location.hash !== next) window.location.hash = next;
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [view, setView] = useState("library"); // "library" | "product"
  const [producto, setProducto] = useState(null);
  // true entre "Nuevo análisis" y la primera carga exitosa: la vista de
  // producto se muestra en blanco, sin caer sobre uno ya existente.
  const [blank, setBlank] = useState(false);
  const [stage, setStage] = useState(null);
  const [onlyCritical, setOnlyCritical] = useState(true);
  // "etapa": los informes en Word salen enfocados sólo a la etapa activa, sin
  // columnas vacías de las demás. "todas": el informe combinado de siempre.
  const [reportScope, setReportScope] = useState("etapa");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [messages, setMessages] = useState([]);
  const [copyState, setCopyState] = useState("idle");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const locales = loadLocalDocuments();
      let docs = locales;

      if (supabaseEnabled) {
        const remotos = await loadDocumentsFromSupabase();

        // Se unen las dos fuentes en vez de que una pise a la otra. Si un
        // análisis se hizo mientras la app estaba sin conexión a Supabase
        // (por credenciales faltantes, por ejemplo), vive sólo en este
        // navegador: reemplazarlo por lo remoto lo perdería.
        const porClave = new Map(locales.map((d) => [docKey(d), d]));
        for (const doc of remotos) porClave.set(docKey(doc), doc);
        docs = [...porClave.values()];

        // Lo que sólo existía en local se sube, para que quede disponible
        // desde cualquier otra computadora.
        const clavesRemotas = new Set(remotos.map(docKey));
        const soloLocales = locales.filter((d) => !clavesRemotas.has(docKey(d)));

        if (soloLocales.length > 0) {
          let subidos = 0;
          for (const doc of soloLocales) {
            const res = await syncDocumentToSupabase(doc);
            if (res.ok && !res.skipped) subidos++;
          }
          if (subidos > 0) {
            pushMessage(
              `Se subieron a Supabase ${subidos} documento(s) que estaban sólo en este navegador.`,
              "success"
            );
          }
        }

        saveLocalDocuments(docs);
      }

      setDocuments(docs);

      const route = readRoute();
      const familias = listProducts(withFamilies(docs));
      if (route.view === "product" && route.producto && familias.includes(route.producto)) {
        setView("product");
        setProducto(route.producto);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    function onHashChange() {
      const route = readRoute();
      setView(route.view);
      if (route.view === "product") {
        setProducto(route.producto);
        setBlank(!route.producto);
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Las etapas de un mismo lote nombran al producto de forma distinta, así que
  // todo el análisis trabaja sobre la familia de producto, no sobre el código.
  const docs = useMemo(() => withFamilies(documents), [documents]);

  const productos = useMemo(() => listProducts(docs), [docs]);
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

  const productDocs = useMemo(
    () => docs.filter((d) => d.familia === productoActivo),
    [docs, productoActivo]
  );

  function pushMessage(text, type = "info") {
    const id = Date.now() + Math.random();
    setMessages((m) => [...m, { id, text, type }]);
    setTimeout(() => setMessages((m) => m.filter((x) => x.id !== id)), 7000);
  }

  function openProduct(familia) {
    setBlank(false);
    setProducto(familia);
    setView("product");
    writeRoute("product", familia);
  }

  function startNew() {
    setBlank(true);
    setProducto(null);
    setStage(null);
    setView("product");
    writeRoute("product", null);
  }

  function backToLibrary() {
    setView("library");
    writeRoute("library", null);
  }

  async function handleFiles(files, expectedKind) {
    setBusy(true);
    let next = documents;
    const nuevos = [];
    // Huellas de contenido ya vistas en esta misma tanda de carga, para
    // detectar dos archivos idénticos seleccionados juntos por error.
    const hashesEnEstaTanda = [];

    for (const file of files) {
      setBusyLabel(`Analizando ${file.name}…`);
      try {
        const result = await processPdfFile(file);

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
          (await findDuplicateDocument(documents, contentHash));

        if (yaVisto) {
          const cuenta = (d) =>
            (d?.personnel?.operarios?.length || 0) + (d?.personnel?.supervisores?.length || 0);
          const aporta = cuenta(result) > 0 && cuenta(yaVisto) === 0;

          if (!aporta) {
            pushMessage(
              `${file.name}: contenido idéntico a "${yaVisto.fileName}" (lote ${yaVisto.lote}, ${yaVisto.stage}) — se omitió, ya estaba cargado.`,
              "info"
            );
            continue;
          }

          pushMessage(
            `${file.name}: ya estaba cargado, pero sin los participantes. Se actualizó con ${cuenta(result)} nombres.`,
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
          orden: result.orden || null,
          uploadedAt: new Date().toISOString(),
        };
        next = upsertDocument(next, doc);
        nuevos.push(doc);
        hashesEnEstaTanda.push({ hash: contentHash, fileName: doc.fileName, lote: doc.lote, stage: doc.stage });
        pushMessage(
          doc.kind === "orden"
            ? `${file.name} · Orden ${doc.meta.orden || ""} · ${doc.stage} · lote ${doc.lote} — ${doc.orden.insumos.length} insumos con su lote`
            : `${file.name} · ${doc.stage} · lote ${doc.lote} — ${doc.params.length} parámetros detectados`,
          "success"
        );
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
        writeRoute("product", familiaNueva);
      }
    }
    setBusy(false);
    setBusyLabel("");

    if (supabaseEnabled) {
      let avisoMigracion = false;
      let avisoReceta = false;
      for (const doc of nuevos) {
        const res = await syncDocumentToSupabase(doc);
        if (!res.ok && !res.skipped) {
          pushMessage(`No se pudo guardar en Supabase (${doc.stage} lote ${doc.lote}): ${res.error}`, "error");
        } else if (res.personnelWarning && !avisoMigracion) {
          avisoMigracion = true;
          pushMessage(
            "Los parámetros se guardaron en Supabase, pero falta ejecutar supabase_migration_v3.sql para guardar también los participantes (operarios/supervisores).",
            "info"
          );
        } else if (res.recetaWarning && !avisoReceta) {
          avisoReceta = true;
          pushMessage(
            "Se guardó todo, pero falta ejecutar supabase_migration_v5.sql para que la receta no se pierda al recargar la página.",
            "info"
          );
        }
      }
    }
  }

  async function handleRemove(doc) {
    const next = documents.filter((d) => docKey(d) !== docKey(doc));
    setDocuments(next);
    saveLocalDocuments(next);
    if (supabaseEnabled) await deleteDocumentFromSupabase(doc);
  }

  async function handleDeleteProduct(familia) {
    const aBorrar = docs.filter((d) => d.familia === familia);
    if (aBorrar.length === 0) return;

    const lotes = [...new Set(aBorrar.map((d) => d.lote))].length;
    const ok = window.confirm(
      `¿Eliminar "${familia}" por completo? Se borrarán ${lotes} ${lotes === 1 ? "lote" : "lotes"} y ${aBorrar.length} documento(s). Esta acción no se puede deshacer.`
    );
    if (!ok) return;

    const next = documents.filter((d) => !aBorrar.some((x) => docKey(x) === docKey(d)));
    setDocuments(next);
    saveLocalDocuments(next);
    if (supabaseEnabled) {
      for (const doc of aBorrar) await deleteDocumentFromSupabase(doc);
    }
    pushMessage(`Se eliminó "${familia}".`, "info");
    if (productoActivo === familia) backToLibrary();
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
        <button className="brand" onClick={backToLibrary} title="Ir a tus análisis">
          <span className="brand__mark">
            <IconFlask size={20} />
          </span>
          <span className="brand__text">
            <strong>Detección de Parámetros</strong>
            <small>Extracción y validación comparativa de registros de manufactura</small>
          </span>
        </button>
        <span className={`badge ${supabaseEnabled ? "badge--cloud" : "badge--local"}`}>
          {supabaseEnabled ? <IconCloud size={15} /> : <IconDrive size={15} />}
          {supabaseEnabled ? "Supabase conectado" : "Guardado local"}
        </span>
      </header>

      <main className="main">
        {loading ? (
          <div className="empty-state">Cargando…</div>
        ) : view === "library" ? (
          <ProductLibrary
            productos={resumenProductos}
            onOpen={openProduct}
            onNew={startNew}
            onDelete={handleDeleteProduct}
          />
        ) : (
          <>
            <button className="link-back" onClick={backToLibrary}>
              <IconArrowLeft size={15} /> Todos los productos
            </button>

            <section className="card">
              <div className="upload-row">
                <UploadZone
                  onFiles={(files) => handleFiles(files, "registro")}
                  busy={busy}
                  busyLabel={busyLabel}
                  compact={!blank && productDocs.length > 0}
                  title="Arrastra aquí los RMD (Registros de Manufactura)"
                  compactTitle="Agregar otro RMD"
                  hint="Cualquier producto y cualquier etapa: Fabricación, Envase, Acondicionado…"
                />
                <UploadZone
                  onFiles={(files) => handleFiles(files, "orden")}
                  busy={busy}
                  busyLabel={busyLabel}
                  compact={!blank && productDocs.length > 0}
                  title="Arrastra aquí las Órdenes de Producción / Envase / Acondicionado"
                  compactTitle="Agregar otra orden"
                  hint="Aportan el Lote ME de cada material, el rendimiento oficial y las fechas exactas."
                />
              </div>

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

              {!blank && productos.length > 0 && (
                <div className="selectors">
                  <label className="field">
                    <span className="field__label">
                      <IconFlask size={14} /> Producto
                    </span>
                    <select value={productoActivo || ""} onChange={(e) => openProduct(e.target.value)}>
                      {productos.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="field">
                    <span className="field__label">
                      <IconLayers size={14} /> Etapa
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
              )}

              {!blank && <LoadedBatches documents={productDocs} onRemove={handleRemove} />}
            </section>

            {!blank && <PersonnelPanel personnel={personnel} stage={stageActiva} />}

            {!blank && (
              <section className="card card--table">
                <div className="toolbar">
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

                  {table && (
                    <span className="counter">
                      {table.sections.reduce((a, s) => a + s.rows.length, 0)} parámetros ·{" "}
                      {table.lotes.length} {table.lotes.length === 1 ? "lote" : "lotes"}
                    </span>
                  )}

                  <div className="toolbar__spacer" />

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

                  <button className="btn btn--ghost" onClick={handleExportFormatoA09} disabled={!productoActivo}>
                    <IconFileText size={16} />
                    FORMATO A09
                  </button>
                  <button className="btn btn--primary" onClick={handleExport} disabled={!productoActivo}>
                    <IconDownload size={16} />
                    Exportar a Excel
                  </button>
                </div>

                <ParamTable table={table} />
              </section>
            )}
          </>
        )}
      </main>

      <footer className="footer">
        {view === "product" ? (
          <button className="link-back link-back--footer" onClick={backToLibrary}>
            <IconGrid size={13} /> Volver a tus análisis
          </button>
        ) : (
          "El detector lee la estructura del propio registro, así que admite nuevos productos, etapas y parámetros sin tocar el código."
        )}
      </footer>
    </div>
  );
}
