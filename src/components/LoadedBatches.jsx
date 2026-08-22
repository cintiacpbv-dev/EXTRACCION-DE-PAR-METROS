import { useState } from "react";
import { IconBox, IconChevronDown, IconClose } from "./Icons.jsx";

function groupByLote(documents) {
  const map = new Map();
  for (const doc of documents) {
    if (!map.has(doc.lote)) map.set(doc.lote, []);
    map.get(doc.lote).push(doc);
  }
  return [...map.entries()]
    .map(([lote, docs]) => ({ lote, docs, totalParams: docs.reduce((a, d) => a + d.params.length, 0) }))
    .sort((a, b) => a.lote.localeCompare(b.lote));
}

/**
 * Todo lo cargado de un producto, agrupado por lote y colapsado en una sola
 * barra resumen: cuántos lotes, documentos y parámetros hay en total. Un
 * clic despliega el detalle — un renglón por lote con sus etapas — para que
 * la carga de archivos no ocupe la pantalla cuando ya hay varios lotes.
 */
export default function LoadedBatches({ documents, onRemove }) {
  const [expanded, setExpanded] = useState(false);

  if (documents.length === 0) return null;

  const grupos = groupByLote(documents);
  const totalParams = documents.reduce((a, d) => a + d.params.length, 0);

  return (
    <div className="batches">
      <button className="batches__summary" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <IconBox size={15} />
        <span>
          {grupos.length} {grupos.length === 1 ? "lote" : "lotes"} cargado{grupos.length === 1 ? "" : "s"} ·{" "}
          {documents.length} documento{documents.length === 1 ? "" : "s"} · {totalParams} parámetros
        </span>
        <IconChevronDown size={15} className={`batches__chevron ${expanded ? "is-open" : ""}`} />
      </button>

      {expanded && (
        <div className="batches__list">
          {grupos.map((g) => (
            <div className="batch-row" key={g.lote}>
              <span className="batch-row__lote">Lote {g.lote}</span>
              <div className="batch-row__stages">
                {g.docs.map((doc) => {
                  const esOrden = doc.kind === "orden";
                  const detalle = esOrden
                    ? `orden · ${doc.orden?.insumos?.length ?? 0} insumos`
                    : doc.params.length;
                  const que = esOrden ? `la orden de ${doc.stage}` : doc.stage;

                  return (
                    <span
                      className={`stage-pill ${esOrden ? "stage-pill--orden" : ""}`}
                      key={`${doc.stage}::${doc.kind || "registro"}`}
                    >
                      {doc.stage} · {detalle}
                      <button
                        onClick={() => onRemove(doc)}
                        title={`Quitar ${que} del lote ${doc.lote}`}
                        aria-label={`Quitar ${que} del lote ${doc.lote}`}
                      >
                        <IconClose size={11} />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
