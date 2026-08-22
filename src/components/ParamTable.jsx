import { Fragment } from "react";
import { IconCheck } from "./Icons.jsx";

function fmtStat(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Math.round(n * 1000) / 1000;
}

function Cell({ value }) {
  if (value === undefined || value === null || value === "") return <span className="muted">—</span>;
  if (value === "ü") return <IconCheck size={14} className="check-icon" />;
  if (typeof value === "number") return Math.round(value * 1000) / 1000;
  return value;
}

export default function ParamTable({ table }) {
  if (!table || table.lotes.length === 0) {
    return (
      <div className="empty-state">
        Todavía no hay documentos cargados para esta etapa. Sube un PDF para ver la tabla de parámetros.
      </div>
    );
  }

  const colCount = 6 + table.lotes.length;

  return (
    <div className="table-scroll">
      <table className="param-table">
        <thead>
          <tr>
            <th className="col-param">Parámetros</th>
            <th className="col-setpoint">Setpoint / Criterio de Aceptación</th>
            {table.lotes.map((lote) => (
              <th key={lote} className="col-lote">
                Lote {lote}
              </th>
            ))}
            <th className="col-stat">Mínimo</th>
            <th className="col-stat">Máximo</th>
            <th className="col-stat">Promedio</th>
            <th className="col-stat">Desv. Estándar</th>
          </tr>
        </thead>
        <tbody>
          {table.sections.map((section) => (
            <Fragment key={section.title}>
              <tr className="section-row">
                {/* El rótulo se ancla por separado de la celda: la celda ocupa
                    todo el ancho de la tabla, así que al desplazarse en
                    horizontal su texto quedaba fuera de la vista y la fila
                    parecía vacía justo cuando más falta hace saber qué
                    bloque se está leyendo. */}
                <td colSpan={colCount}>
                  <span className="section-row__label">{section.title}</span>
                </td>
              </tr>
              {section.rows.map((row) => (
                <tr key={row.id}>
                  <td className="col-param">
                    {row.label}
                    {row.unit ? <span className="unit"> ({row.unit})</span> : null}
                  </td>
                  <td className="col-setpoint">{row.setpoint || <span className="muted">Referencial</span>}</td>
                  {table.lotes.map((lote) => (
                    <td key={lote} className="col-lote value-cell">
                      <Cell value={row.values[lote]} />
                    </td>
                  ))}
                  <td className="col-stat">{row.stats ? fmtStat(row.stats.min) : "—"}</td>
                  <td className="col-stat">{row.stats ? fmtStat(row.stats.max) : "—"}</td>
                  <td className="col-stat">{row.stats ? fmtStat(row.stats.avg) : "—"}</td>
                  <td className="col-stat">{row.stats ? fmtStat(row.stats.stdev) : "—"}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
