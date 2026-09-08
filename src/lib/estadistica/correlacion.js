import jStat from "jstat";

function rangoPromedio(xs) {
  const orden = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array(xs.length);
  let i = 0;
  while (i < orden.length) {
    let j = i + 1;
    while (j < orden.length && orden[j].v === orden[i].v) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) r[orden[k].i] = rank;
    i = j;
  }
  return r;
}

function pearson(x, y) {
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  const num = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  const den = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0));
  return den ? num / den : NaN;
}

export function correlacionAvanzada(valuesA, valuesB, nivel = 0.95) {
  const pares = [];
  for (let i = 0; i < Math.min(valuesA.length, valuesB.length); i++) if (Number.isFinite(valuesA[i]) && Number.isFinite(valuesB[i])) pares.push([valuesA[i], valuesB[i]]);
  if (pares.length < 4) return { error: "Hacen falta al menos 4 pares completos." };
  const x = pares.map((p) => p[0]); const y = pares.map((p) => p[1]);
  const pearsonR = pearson(x, y);
  const rx = rangoPromedio(x); const ry = rangoPromedio(y);
  const spearmanR = pearson(rx, ry);
  const gl = pares.length - 2;
  const pPearson = Math.abs(pearsonR) < 1 ? 2 * (1 - jStat.studentt.cdf(Math.abs(pearsonR) * Math.sqrt(gl / (1 - pearsonR ** 2)), gl)) : 0;
  const pSpearman = Math.abs(spearmanR) < 1 ? 2 * (1 - jStat.studentt.cdf(Math.abs(spearmanR) * Math.sqrt(gl / (1 - spearmanR ** 2)), gl)) : 0;
  const fisherZ = Math.atanh(Math.max(-0.999999999, Math.min(0.999999999, pearsonR)));
  const seZ = 1 / Math.sqrt(pares.length - 3);
  const zCrit = jStat.normal.inv((1 + nivel) / 2, 0, 1);
  const icZ = [fisherZ - zCrit * seZ, fisherZ + zCrit * seZ];
  return { n: pares.length, pearson: { r: pearsonR, p: pPearson, ic: icZ.map(Math.tanh) }, spearman: { rho: spearmanR, p: pSpearman }, nivelConfianza: nivel };
}
