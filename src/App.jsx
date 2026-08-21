import { useEffect, useMemo, useState } from "react";
import UploadZone from "./components/UploadZone.jsx";
import ParamTable from "./components/ParamTable.jsx";
import DocumentChips from "./components/DocumentChips.jsx";
import MacroPanel from "./components/MacroPanel.jsx";
import {
  IconCloud,
  IconDrive,
  IconCopy,
  IconCheck,
  IconDownload,
  IconCode,
  IconFlask,
  IconLayers,
  IconAlert,
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
import { buildTable, listProducts, listStages, withFamilies } from "./lib/model.js";
import "./App.css";

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [producto, setProducto] = useState(null);
  const [stage, setStage] = useState(null);
  const [onlyCritical, setOnlyCritical] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [messages, setMessages] = useState([]);
  const [copyState, setCopyState] = useState("idle");
  const [macroOpen, setMacroOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let docs = [];
      if (supabaseEnabled) docs = await loadDocumentsFromSupabase();
      if (docs.length > 0) {
        // Se guarda una copia local de lo que hay en la nube, para seguir
        // trabajando si Supabase no responde en el próximo arranque.
        saveLocalDocuments(docs);
      } else {
        docs = loadLocalDocuments();
      }
      setDocuments(docs);
      setLoading(false);
    })();
  }, []);

  // Las etapas de un mismo lote nombran al producto de forma distinta, así que
  // todo el análisis trabaja sobre la familia de producto, no sobre el código.
  const docs = useMemo(() => withFamilies(documents), [documents]);

  const productos = useMemo(() => listProducts(docs), [docs]);

  // La selección se resuelve durante el render: al quitar un documento o al
  // cargar otro producto, lo elegido puede dejar de existir y basta con caer
  // sobre la primera opción disponible, sin estados intermedios inválidos.
  const productoActivo = producto && productos.includes(producto) ? producto : productos[0] ?? null;

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

  const productDocs = useMemo(
    () => docs.filter((d) => d.familia === productoActivo),
    [docs, productoActivo]
  );

  function pushMessage(text, type = "info") {
    const id = Date.now() + Math.random();
    setMessages((m) => [...m, { id, text, type }]);
    setTimeout(() => setMessages((m) => m.filter((x) => x.id !== id)), 7000);
  }

  async function handleFiles(files) {
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
        const contentHash = await computeContentHash(result.params);

        // Un documento ya cargado (de esta tanda o de antes) con exactamente
        // el mismo contenido: se detecta y no se vuelve a procesar.
        const yaVisto =
          hashesEnEstaTanda.find((h) => h.hash === contentHash) ||
          (await findDuplicateDocument(documents, contentHash));

        if (yaVisto) {
          pushMessage(
            `${file.name}: contenido idéntico a "${yaVisto.fileName}" (lote ${yaVisto.lote}, ${yaVisto.stage}) — se omitió, ya estaba cargado.`,
            "info"
          );
          continue;
        }

        const doc = {
          producto: result.meta.producto,
          lote: result.meta.lote || "SIN LOTE",
          stage: result.stage,
          fileName: result.fileName,
          meta: result.meta,
          params: result.params,
        };
        next = upsertDocument(next, doc);
        nuevos.push(doc);
        hashesEnEstaTanda.push({ hash: contentHash, fileName: doc.fileName, lote: doc.lote, stage: doc.stage });
        pushMessage(
          `${file.name} · ${doc.stage} · lote ${doc.lote} — ${doc.params.length} parámetros detectados`,
          "success"
        );
      } catch (err) {
        pushMessage(`${file.name}: ${err.message}`, "error");
      }
    }

    setDocuments(next);
    saveLocalDocuments(next);
    if (nuevos.length > 0) setStage(nuevos[0].stage);
    setBusy(false);
    setBusyLabel("");

    if (supabaseEnabled) {
      for (const doc of nuevos) {
        const res = await syncDocumentToSupabase(doc);
        if (!res.ok && !res.skipped) {
          pushMessage(`No se pudo guardar en Supabase (${doc.stage} lote ${doc.lote}): ${res.error}`, "error");
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

  function handleExport() {
    if (!productoActivo) return;
    const ok = exportProductToExcel(docs, productoActivo, { onlyCritical });
    if (!ok) pushMessage("No hay datos para exportar en este producto.", "error");
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
        <div className="brand">
          <span className="brand__mark">
            <IconFlask size={20} />
          </span>
          <span className="brand__text">
            <strong>Detección de Parámetros</strong>
            <small>Extracción y validación comparativa de registros de manufactura</small>
          </span>
        </div>
        <span className={`badge ${supabaseEnabled ? "badge--cloud" : "badge--local"}`}>
          {supabaseEnabled ? <IconCloud size={15} /> : <IconDrive size={15} />}
          {supabaseEnabled ? "Supabase conectado" : "Guardado local"}
        </span>
      </header>

      <main className="main">
        <section className="card">
          <UploadZone onFiles={handleFiles} busy={busy} busyLabel={busyLabel} />

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

          {productos.length > 0 && (
            <div className="selectors">
              <label className="field">
                <span className="field__label">
                  <IconFlask size={14} /> Producto
                </span>
                <select value={productoActivo || ""} onChange={(e) => setProducto(e.target.value)}>
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

          <DocumentChips documents={productDocs} onRemove={handleRemove} />
        </section>

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
                {table.sections.reduce((a, s) => a + s.rows.length, 0)} parámetros · {table.lotes.length}{" "}
                {table.lotes.length === 1 ? "lote" : "lotes"}
              </span>
            )}

            <div className="toolbar__spacer" />

            <button className="btn btn--ghost" onClick={() => setMacroOpen(true)}>
              <IconCode size={16} />
              Macro de formato
            </button>
            <button className="btn btn--ghost" onClick={handleCopy} disabled={!table}>
              {copyState === "copied" ? <IconCheck size={16} /> : <IconCopy size={16} />}
              {copyState === "copied" ? "Copiado" : copyState === "error" ? "No se pudo copiar" : "Copiar tabla"}
            </button>
            <button className="btn btn--primary" onClick={handleExport} disabled={!productoActivo}>
              <IconDownload size={16} />
              Exportar a Excel
            </button>
          </div>

          {loading ? <div className="empty-state">Cargando…</div> : <ParamTable table={table} />}
        </section>
      </main>

      <footer className="footer">
        El detector lee la estructura del propio registro, así que admite nuevos productos, etapas y
        parámetros sin tocar el código.
      </footer>

      <MacroPanel open={macroOpen} onClose={() => setMacroOpen(false)} />
    </div>
  );
}
