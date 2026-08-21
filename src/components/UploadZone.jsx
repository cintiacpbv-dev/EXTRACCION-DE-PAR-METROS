import { useCallback, useRef, useState } from "react";
import { IconUpload } from "./Icons.jsx";

export default function UploadZone({ onFiles, busy, busyLabel }) {
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

  return (
    <div
      className={`upload-zone ${dragOver ? "is-drag" : ""} ${busy ? "is-busy" : ""}`}
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
        <IconUpload size={22} />
      </span>
      <span className="upload-zone__title">
        {busy ? busyLabel || "Procesando…" : "Arrastra aquí los Registros de Manufactura (PDF)"}
      </span>
      <span className="upload-zone__hint">
        Cualquier producto y cualquier etapa. Los parámetros se detectan solos a partir del documento.
      </span>
    </div>
  );
}
