// Estadísticas descriptivas para las columnas Mínimo / Máximo / Promedio / Desv. Estándar
// de la tabla maestra, calculadas sobre los valores numéricos de un parámetro a través
// de los lotes cargados. Usa desviación estándar muestral (n-1), igual que el Excel de
// referencia (función DESVEST de Excel).

export function computeStats(values) {
  const nums = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (nums.length === 0) {
    return { min: null, max: null, avg: null, stdev: null };
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;

  let stdev = null;
  if (nums.length > 1) {
    const variance = nums.reduce((acc, x) => acc + (x - avg) ** 2, 0) / (nums.length - 1);
    stdev = Math.sqrt(variance);
  }

  return { min, max, avg, stdev };
}
