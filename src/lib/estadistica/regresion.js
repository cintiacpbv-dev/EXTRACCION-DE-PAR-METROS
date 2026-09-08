import jStat from "jstat";

function inversa(A) {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r.slice(n));
}

function mul(A, b) { return A.map((r) => r.reduce((s, x, i) => s + x * b[i], 0)); }
function trans(A) { return A[0].map((_, j) => A.map((r) => r[j])); }

export function regresionLinealSimple(xValues, yValues) {
  const pares = [];
  for (let i = 0; i < Math.min(xValues.length, yValues.length); i++) if (Number.isFinite(xValues[i]) && Number.isFinite(yValues[i])) pares.push([xValues[i], yValues[i]]);
  if (pares.length < 3) return { error: "Hacen falta al menos 3 pares completos." };
  const x = pares.map((p) => p[0]);
  const y = pares.map((p) => p[1]);
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  const sxy = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  if (sxx === 0) return { error: "La variable X no presenta variación." };
  const pendiente = sxy / sxx;
  const intercepto = my - pendiente * mx;
  const ajustados = x.map((v) => intercepto + pendiente * v);
  const residuos = y.map((v, i) => v - ajustados[i]);
  const sse = residuos.reduce((s, v) => s + v * v, 0);
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const r2 = sst > 0 ? 1 - sse / sst : 1;
  const gl = x.length - 2;
  const mse = sse / gl;
  const sePendiente = Math.sqrt(mse / sxx);
  const t = pendiente / sePendiente;
  const p = 2 * (1 - jStat.studentt.cdf(Math.abs(t), gl));
  const tCrit = jStat.studentt.inv(0.975, gl);
  return { n: x.length, intercepto, pendiente, r2, r2Ajustado: 1 - (1 - r2) * (x.length - 1) / (x.length - 2), sePendiente, t, gl, p, icPendiente: [pendiente - tCrit * sePendiente, pendiente + tCrit * sePendiente], ajustados, residuos };
}

export function regresionLinealMultiple(xColumns, yValues) {
  const k = xColumns.length;
  if (k < 1) return { error: "Hacen falta variables predictoras." };
  const n = Math.min(yValues.length, ...xColumns.map((c) => c.values.length));
  const X = [], y = [];
  for (let i = 0; i < n; i++) {
    const fila = xColumns.map((c) => c.values[i]);
    if (Number.isFinite(yValues[i]) && fila.every(Number.isFinite)) X.push([1, ...fila]), y.push(yValues[i]);
  }
  if (X.length <= k + 1) return { error: `Hacen falta más observaciones que parámetros del modelo (n > ${k + 1}).` };
  const Xt = trans(X);
  const XtX = Xt.map((r) => X[0].map((_, j) => r.reduce((s, v, i) => s + v * X[i][j], 0)));
  const inv = inversa(XtX);
  if (!inv) return { error: "La matriz de diseño es singular o presenta colinealidad perfecta." };
  const Xty = Xt.map((r) => r.reduce((s, v, i) => s + v * y[i], 0));
  const beta = mul(inv, Xty);
  const ajustados = X.map((r) => r.reduce((s, v, i) => s + v * beta[i], 0));
  const residuos = y.map((v, i) => v - ajustados[i]);
  const media = y.reduce((a, b) => a + b, 0) / y.length;
  const sse = residuos.reduce((s, v) => s + v * v, 0);
  const sst = y.reduce((s, v) => s + (v - media) ** 2, 0);
  const r2 = sst > 0 ? 1 - sse / sst : 1;
  const glError = y.length - k - 1;
  const mse = sse / glError;
  const se = beta.map((_, i) => Math.sqrt(Math.max(0, mse * inv[i][i])));
  const t = beta.map((b, i) => b / se[i]);
  const p = t.map((v) => 2 * (1 - jStat.studentt.cdf(Math.abs(v), glError)));
  const vif = xColumns.map((_, j) => {
    const others = xColumns.filter((__, i) => i !== j);
    if (!others.length) return 1;
    const r = regresionLinealMultiple(others, xColumns[j].values);
    return r.error || r.r2 >= 1 ? Infinity : 1 / (1 - r.r2);
  });
  return { n: y.length, k, coeficientes: beta, erroresEstandar: se, t, p, r2, r2Ajustado: 1 - (1 - r2) * (y.length - 1) / glError, glError, ajustados, residuos, vif };
}
