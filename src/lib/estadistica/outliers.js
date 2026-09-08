function mediana(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function detectarOutliers(values) {
  const datos = values.map((valor, indice) => ({ valor, indice })).filter(({ valor }) => typeof valor === "number" && Number.isFinite(valor));
  const xs = datos.map((d) => d.valor).sort((a, b) => a - b);
  if (xs.length < 3) return { error: "Hacen falta al menos 3 observaciones numéricas." };

  const q1 = mediana(xs.slice(0, Math.floor(xs.length / 2)));
  const q3 = mediana(xs.slice(Math.ceil(xs.length / 2)));
  const iqr = q3 - q1;
  const limInf = q1 - 1.5 * iqr;
  const limSup = q3 + 1.5 * iqr;
  const media = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - media) ** 2, 0) / (xs.length - 1)) : 0;
  const med = mediana(xs);
  const mad = mediana(xs.map((x) => Math.abs(x - med)));

  const resultados = datos.map(({ valor, indice }) => {
    const z = sd > 0 ? (valor - media) / sd : 0;
    const zRobusto = mad > 0 ? (valor - med) / (1.4826 * mad) : 0;
    const metodos = [];
    if (valor < limInf || valor > limSup) metodos.push("IQR");
    if (Math.abs(z) > 3) metodos.push("Z-score");
    if (mad > 0 && Math.abs(zRobusto) > 3) metodos.push("MAD robusto");
    return { indice, valor, z, zRobusto, metodos, atipico: metodos.length > 0 };
  });

  return { n: xs.length, q1, q3, iqr, limInf, limSup, media, sd, mediana: med, mad, resultados, atipicos: resultados.filter((r) => r.atipico), nota: "Un valor estadísticamente atípico no implica necesariamente que el dato sea incorrecto." };
}

export const _paraPruebas = { mediana };
