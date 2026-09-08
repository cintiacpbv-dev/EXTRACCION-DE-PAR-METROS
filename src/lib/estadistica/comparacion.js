import jStat from "jstat";
import { tDosMuestras, anovaUnFactor, pruebaVarianzasMultiple } from "./pruebas.js";

export function welchAnova(columnas) {
  const grupos = columnas.map((c) => ({ nombre: c.name, valores: c.values.filter(Number.isFinite) })).filter((g) => g.valores.length >= 2);
  if (grupos.length < 2) return { error: "Hacen falta al menos 2 grupos con 2 observaciones cada uno." };
  const k = grupos.length;
  const n = grupos.map((g) => g.valores.length);
  const medias = grupos.map((g) => g.valores.reduce((a, b) => a + b, 0) / g.valores.length);
  const vars = grupos.map((g, i) => g.valores.reduce((s, x) => s + (x - medias[i]) ** 2, 0) / (n[i] - 1));
  const w = vars.map((v, i) => n[i] / v);
  const W = w.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(W) || W === 0) return { error: "No se puede estimar la varianza dentro de los grupos." };
  const mediaPonderada = w.reduce((s, wi, i) => s + wi * medias[i], 0) / W;
  const numerador = w.reduce((s, wi, i) => s + wi * (medias[i] - mediaPonderada) ** 2, 0) / (k - 1);
  const c = w.reduce((s, wi) => s + (1 - wi / W) ** 2 / (n[wi === undefined ? 0 : w.indexOf(wi)] - 1), 0);
  const ajuste = 1 + (2 * (k - 2) * c) / (k * k - 1);
  const F = numerador / ajuste;
  const gl1 = k - 1;
  const gl2 = (k * k - 1) / (3 * c || 1);
  const p = 1 - jStat.centralF.cdf(F, gl1, gl2);
  return { metodo: "Welch ANOVA", k, n, medias, vars, F, gl1, gl2, valorP: p };
}

export function kruskalWallis(columnas) {
  const grupos = columnas.map((c) => ({ nombre: c.name, valores: c.values.filter(Number.isFinite) })).filter((g) => g.valores.length > 0);
  if (grupos.length < 2) return { error: "Hacen falta al menos 2 grupos." };
  const filas = grupos.flatMap((g, gi) => g.valores.map((valor) => ({ valor, gi })));
  filas.sort((a, b) => a.valor - b.valor);
  let i = 0;
  const rangos = new Array(filas.length);
  while (i < filas.length) {
    let j = i + 1;
    while (j < filas.length && filas[j].valor === filas[i].valor) j++;
    const rango = (i + 1 + j) / 2;
    for (let q = i; q < j; q++) rangos[q] = rango;
    i = j;
  }
  const suma = grupos.map((_, gi) => filas.reduce((s, f, idx) => s + (f.gi === gi ? rangos[idx] : 0), 0));
  const nTotal = filas.length;
  let H = (12 / (nTotal * (nTotal + 1))) * suma.reduce((s, r, gi) => s + r * r / grupos[gi].valores.length, 0) - 3 * (nTotal + 1);
  const empates = new Map();
  for (const f of filas) empates.set(f.valor, (empates.get(f.valor) || 0) + 1);
  const correccion = 1 - [...empates.values()].filter((t) => t > 1).reduce((s, t) => s + t ** 3 - t, 0) / (nTotal ** 3 - nTotal);
  if (correccion > 0) H /= correccion;
  const gl = grupos.length - 1;
  const p = 1 - jStat.chisquare.cdf(H, gl);
  return { metodo: "Kruskal-Wallis", k: grupos.length, nTotal, H, gl, valorP: p };
}

export function compararLotes(columnas) {
  const grupos = columnas.filter((c) => c.values.filter(Number.isFinite).length >= 2);
  if (grupos.length < 2) return { error: "Hacen falta al menos 2 lotes con datos." };
  const anova = grupos.length >= 3 ? anovaUnFactor(grupos) : null;
  const levene = grupos.length >= 3 ? pruebaVarianzasMultiple(grupos) : null;
  const welch = welchAnova(grupos);
  const kruskal = kruskalWallis(grupos);
  const pares = [];
  for (let i = 0; i < grupos.length; i++) for (let j = i + 1; j < grupos.length; j++) {
    const r = tDosMuestras(grupos[i].values, grupos[j].values);
    if (!r.error) pares.push({ a: grupos[i].name, b: grupos[j].name, ...r });
  }
  const m = pares.length;
  const alfa = 0.05;
  const posthoc = pares.map((r) => ({ ...r, pAjustadoHolm: null })).sort((a, b) => a.valorP - b.valorP);
  posthoc.forEach((r, i) => { r.pAjustadoHolm = Math.min(1, r.valorP * (m - i)); });
  for (let i = posthoc.length - 2; i >= 0; i--) posthoc[i].pAjustadoHolm = Math.min(posthoc[i].pAjustadoHolm, posthoc[i + 1].pAjustadoHolm);
  return { grupos: grupos.map((g) => ({ nombre: g.name, n: g.values.filter(Number.isFinite).length })), anova, welch, kruskal, levene, posthoc, criterio: alfa, posthocMetodo: "Comparaciones por pares de Welch con ajuste de Holm; no se presenta como Tukey." };
}
