import { useState } from "react";
import { IconUser, IconShieldCheck } from "./Icons.jsx";
import { formatPersonName } from "../lib/personName.js";

// Con veinte lotes cargados una etapa puede reunir más de sesenta nombres, y
// la lista completa empuja la tabla de parámetros fuera de la pantalla. Se
// muestran primero los que más intervienen —que es el dato que se consulta—
// y el resto queda a un clic.
const VISIBLES = 12;

function RoleList({ title, icon, people, emptyHint }) {
  const [verTodos, setVerTodos] = useState(false);
  const hayDeMas = people.length > VISIBLES;
  const mostrados = verTodos || !hayDeMas ? people : people.slice(0, VISIBLES);

  return (
    <div className="personnel-role">
      <div className="personnel-role__head">
        {icon}
        <strong>{title}</strong>
        <span className="muted">({people.length})</span>
      </div>
      {people.length === 0 ? (
        <p className="muted personnel-role__empty">{emptyHint}</p>
      ) : (
        <>
          <ul className="personnel-role__list">
            {mostrados.map((p) => (
              <li key={p.name} className="personnel-chip">
                <span>{formatPersonName(p.name)}</span>
                <span className="personnel-chip__count">{p.count}</span>
              </li>
            ))}
          </ul>
          {hayDeMas && (
            <button className="personnel-role__more" onClick={() => setVerTodos((v) => !v)}>
              {verTodos
                ? "Ver menos"
                : people.length - VISIBLES === 1
                  ? "Ver el que falta"
                  : `Ver los ${people.length - VISIBLES} restantes`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Quién participó en la etapa activa: a la izquierda los operarios que
 * ejecutaron cada paso (recuadro "Realizado / Por" del registro), a la
 * derecha quienes lo supervisaron (recuadro "VB"). El número junto al
 * nombre es cuántas veces aparece firmando en los lotes cargados de esta
 * etapa.
 */
export default function PersonnelPanel({ personnel, stage }) {
  if (!personnel || (personnel.operarios.length === 0 && personnel.supervisores.length === 0)) return null;

  return (
    <section className="card personnel-panel">
      <h3 className="personnel-panel__title">Participantes — {stage}</h3>
      <div className="personnel-panel__grid">
        <RoleList
          title="Operarios (Realizado / Por)"
          icon={<IconUser size={15} />}
          people={personnel.operarios}
          emptyHint="No se detectaron operarios en esta etapa."
        />
        <RoleList
          title="Supervisores (VB)"
          icon={<IconShieldCheck size={15} />}
          people={personnel.supervisores}
          emptyHint="No se detectaron supervisores en esta etapa."
        />
      </div>
    </section>
  );
}
