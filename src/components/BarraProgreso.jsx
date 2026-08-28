/**
 * El avance de una tanda de carga: una barra con su porcentaje y, debajo, en
 * pequeño, lo que se está procesando ahora mismo.
 *
 * Sustituye a la línea "Analizando <archivo>…" que cambiaba en cada
 * documento: con treinta lotes descargados de SAP eso era un parpadeo de
 * nombres que no decía cuánto faltaba. La barra sí lo dice, y el detalle de
 * abajo —el lote y la etapa cuando se saben, el nombre del archivo cuando
 * no— queda como acompañamiento y no como protagonista.
 */
export default function BarraProgreso({ hecho, total, actual }) {
  if (!total) return null;

  const porcentaje = Math.min(100, Math.round((hecho / total) * 100));

  return (
    <div className="progreso" role="status" aria-live="polite">
      <div className="progreso__cabecera">
        <span className="progreso__texto">
          Analizando {Math.min(hecho + 1, total)} de {total}
        </span>
        <span className="progreso__pct">{porcentaje}%</span>
      </div>

      <div
        className="progreso__pista"
        role="progressbar"
        aria-valuenow={porcentaje}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progreso__relleno" style={{ width: `${porcentaje}%` }} />
      </div>

      {actual && <p className="progreso__detalle">{actual}</p>}
    </div>
  );
}
