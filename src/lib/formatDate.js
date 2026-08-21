/** "hace 3 min", "hace 2 h", "12 ago 2026" — según qué tan reciente sea. */
export function relativeDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  const min = Math.round(diffMs / 60000);

  if (min < 1) return "recién ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} d`;

  return date.toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" });
}
