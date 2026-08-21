import { IconUser, IconShieldCheck } from "./Icons.jsx";

function RoleList({ title, icon, people, emptyHint }) {
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
        <ul className="personnel-role__list">
          {people.map((p) => (
            <li key={p.name} className="personnel-chip">
              <span>{p.name}</span>
              <span className="personnel-chip__count">{p.count}</span>
            </li>
          ))}
        </ul>
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
