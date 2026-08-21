import { IconClose, IconDocument } from "./Icons.jsx";

export default function DocumentChips({ documents, onRemove }) {
  if (documents.length === 0) return null;

  return (
    <div className="chips">
      {documents.map((doc) => (
        <div className="chip" key={`${doc.producto}::${doc.lote}::${doc.stage}`}>
          <IconDocument size={14} />
          <span className="chip__lote">Lote {doc.lote}</span>
          <span className="chip__stage">{doc.stage}</span>
          <span className="chip__count">{doc.params.length} parám.</span>
          <button
            className="chip__remove"
            onClick={() => onRemove(doc)}
            title={`Quitar ${doc.stage} del lote ${doc.lote}`}
            aria-label={`Quitar ${doc.stage} del lote ${doc.lote}`}
          >
            <IconClose size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
