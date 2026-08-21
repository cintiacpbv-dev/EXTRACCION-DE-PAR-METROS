import { useCallback, useRef, useState } from "react";
import { IconUpload } from "./Icons.jsx";

/**
 * `compact` la reduce a una barra delgada de una sola línea, para usar una
 * vez que ya hay documentos cargados y no hace falta que la zona de carga
 * domine la pantalla. Sin `compact` se muestra grande e invitante, pensada
 * para el primer PDF de una sesión nueva.
 */
export default function UploadZone({ onFiles, busy, busyLabel, compact = false }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList || []).filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      );
      if (files.length > 0) onFiles(files);
    },
    [onFiles]
  );

  const hint = "Cualquier producto y cualquier etapa. Los parámetros se detectan solos a partir del documento.";

  return (
    <div
      className={`upload-zone ${compact ? "upload-zone--compact" : ""} ${dragOver ? "is-drag" : ""} ${busy ? "is-busy" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !busy && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      title={compact ? hint : undefined}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="upload-zone__icon">
        <IconUpload size={compact ? 15 : 22} />
      </span>
      <span className="upload-zone__title">
        {busy ? busyLabel || "Procesando…" : compact ? "Agregar otro PDF" : "Arrastra aquí los Registros de Manufactura (PDF)"}
      </span>
      {!compact && <span className="upload-zone__hint">{hint}</span>}
    </div>
  );
}
