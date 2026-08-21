import { useState } from "react";
import { downloadMacro, MACRO_VBA, MACRO_MODULE_NAME } from "../lib/macro.js";
import { IconClose, IconDownload, IconCopy, IconCheck } from "./Icons.jsx";

const PASOS = [
  ["Exporta la tabla", "Usa «Exportar a Excel» y abre el archivo generado."],
  ["Descarga la macro", `Guarda ${MACRO_MODULE_NAME}.bas con el botón de abajo.`],
  ["Impórtala en Excel", "En el archivo abierto pulsa Alt + F11, y luego Archivo → Importar archivo… y elige el .bas."],
  ["Ejecútala", "Cierra el editor, pulsa Alt + F8, selecciona FormatearTablasValidacion y dale a Ejecutar."],
  ["Guarda", "Guarda como .xlsx normal: el formato queda aplicado en todas las hojas."],
];

export default function MacroPanel({ open, onClose }) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  async function copyVba() {
    try {
      await navigator.clipboard.writeText(MACRO_VBA);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = MACRO_VBA;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Macro de formato">
        <header className="modal__head">
          <div>
            <h2>Macro de formato para Excel</h2>
            <p>Deja las tablas exportadas idénticas a la sábana de validación: Arial 8, bordes finos, cabecera gris, estadísticas en verde y vistos buenos en Wingdings.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconClose size={18} />
          </button>
        </header>

        <ol className="steps">
          {PASOS.map(([titulo, detalle], i) => (
            <li key={titulo}>
              <span className="steps__num">{i + 1}</span>
              <div>
                <strong>{titulo}</strong>
                <p>{detalle}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="modal__actions">
          <button className="btn btn--primary" onClick={downloadMacro}>
            <IconDownload size={16} />
            Descargar {MACRO_MODULE_NAME}.bas
          </button>
          <button className="btn btn--ghost" onClick={copyVba}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            {copied ? "Código copiado" : "Copiar código VBA"}
          </button>
        </div>

        <p className="modal__note">
          Si Excel bloquea las macros, guarda el libro como <code>.xlsm</code> o habilita las macros
          desde Archivo → Opciones → Centro de confianza.
        </p>
      </div>
    </div>
  );
}
