import { useCallback, useId, useRef, useState } from "react";
import { IconUpload } from "./Icons.jsx";

/**
 * `compact` la reduce a una barra delgada de una sola línea, para usar una
 * vez que ya hay documentos cargados y no hace falta que la zona de carga
 * domine la pantalla. Sin `compact` se muestra grande e invitante, pensada
 * para el primer PDF de una sesión nueva.
 */
export default function UploadZone({
  onFiles,
  busy,
  busyLabel,
  compact = false,
  title = "Arrastra aquí los PDF",
  compactTitle = "Agregar otro PDF",
  hint = "Cualquier producto y cualquier etapa. Los parámetros se detectan solos a partir del documento.",
  // Qué archivos admite. Por defecto PDF, que es lo que se carga casi
  // siempre; el protocolo de referencia llega en Word.
  extensiones = [".pdf"],
  tipos = ["application/pdf"],
}) {
  const inputRef = useRef(null);
  const hintId = useId();
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList || []).filter(
        (f) => tipos.includes(f.type) || extensiones.some((e) => f.name.toLowerCase().endsWith(e))
      );
      if (files.length > 0) onFiles(files);
    },
    [onFiles, tipos, extensiones]
  );

  const etiqueta = busy ? busyLabel || "Procesando…" : compact ? compactTitle : title;

  return (
    <div
      className={`upload-zone ${compact ? "upload-zone--compact" : ""} ${dragOver ? "is-drag" : ""} ${busy ? "is-busy" : ""}`}
      onDragOver={(e) => {
        if (busy) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        // Sin esta guarda se podía soltar un segundo grupo de archivos
        // mientras el primero seguía procesándose, y la tanda que terminaba
        // antes se perdía al guardarse la otra encima.
        if (busy) return;
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !busy && inputRef.current?.click()}
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-label={compact ? compactTitle : title}
      aria-describedby={hintId}
      aria-busy={busy}
      title={compact ? hint : undefined}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={[...tipos, ...extensiones].join(",")}
        multiple
        hidden
        // El input vive dentro del contenedor pulsable: sin detener la
        // propagación, su propio clic vuelve a burbujear hasta el onClick de
        // arriba y reabre el diálogo en bucle.
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="upload-zone__icon" aria-hidden="true">
        <IconUpload size={compact ? 15 : 22} />
      </span>
      <span className="upload-zone__title">{etiqueta}</span>
      <span id={hintId} className={compact ? "sr-only" : "upload-zone__hint"}>
        {hint}
      </span>
    </div>
  );
}
