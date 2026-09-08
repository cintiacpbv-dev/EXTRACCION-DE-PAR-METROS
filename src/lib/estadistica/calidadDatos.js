export function evaluarCalidadDatos(columns) {
  const variables = columns.filter((c) => String(c.nombre || c.name || "").trim() !== "" || c.values.some((v) => v != null));
  const observaciones = variables.reduce((m, c) => Math.max(m, c.values.length), 0);
  const resumen = variables.map((c) => {
    const hasta = [...c.values];
    while (hasta.length && (hasta[hasta.length - 1] == null || String(hasta[hasta.length - 1]).trim() === "")) hasta.pop();
    const faltantes = hasta.filter((v) => v == null || String(v).trim() === "").length;
    const noNumericos = c.type === "numeric" ? hasta.filter((v) => v != null && typeof v !== "number").length : 0;
    const infinitos = hasta.filter((v) => typeof v === "number" && !Number.isFinite(v)).length;
    return { nombre: c.nombre || c.name, tipo: c.type, n: hasta.filter((v) => v != null && String(v).trim() !== "").length, faltantes, noNumericos, infinitos };
  });
  const problemas = resumen.filter((r) => r.faltantes || r.noNumericos || r.infinitos);
  const estado = !variables.length || problemas.some((r) => r.noNumericos || r.infinitos) ? "NO APTO" : problemas.length ? "REQUIERE REVISIÓN" : "FAVORABLE";
  return { estado, observaciones, variables: resumen, problemas };
}

export function estadoDesdeResultado({ evaluado = false, favorable = null } = {}) {
  if (!evaluado) return "NO EVALUADO";
  return favorable === true ? "FAVORABLE" : favorable === false ? "NO FAVORABLE" : "REQUIERE REVISIÓN";
}
