// El RMD identifica a cada operario o supervisor con un código en mayúsculas:
// inicial del nombre + apellido paterno + inicial del apellido materno (p.
// ej. "ALACHOS" = A. Lacho S.). Para los reportes se muestra sólo el nombre
// legible, descartando esa inicial final.
export function formatPersonName(raw) {
  const name = String(raw || "").trim();
  if (name.length < 3) return name;

  const inicial = name[0].toUpperCase();
  const cuerpo = name.slice(1, -1).toLowerCase();
  const apellido = cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1);

  return `${inicial}. ${apellido}`;
}
