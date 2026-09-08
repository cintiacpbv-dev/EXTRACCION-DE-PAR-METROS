import assert from "node:assert/strict";
import { estadisticaDescriptiva } from "../src/lib/estadistica/descriptiva.js";
import { detectarOutliers } from "../src/lib/estadistica/outliers.js";
import { capacidadProceso } from "../src/lib/estadistica/spc.js";
import { compararLotes } from "../src/lib/estadistica/comparacion.js";
import { regresionLinealSimple } from "../src/lib/estadistica/regresion.js";

const d = estadisticaDescriptiva([2, 4, 4, 4, 5, 5, 7, 9]);
assert.equal(d.n, 8); assert.equal(d.media, 5); assert.equal(d.mediana, 4.5); assert.ok(Math.abs(d.desvEst - 2.138089935) < 1e-6);

const o = detectarOutliers([10, 10, 11, 10, 12, 11, 10, 100]);
assert.ok(o.atipicos.some((x) => x.valor === 100));

const cap = capacidadProceso([9.8, 10, 10.1, 10.2, 9.9, 10.05], { lsl: 9, usl: 11 });
assert.ok(cap.pp > 0); assert.ok(cap.ppk > 0); assert.equal(cap.cp, undefined);

const a = compararLotes([{ name: "L1", values: [1, 2, 1, 2] }, { name: "L2", values: [2, 3, 2, 3] }, { name: "L3", values: [1, 1, 2, 1] }]);
assert.ok(Number.isFinite(a.anova.valorP)); assert.ok(Number.isFinite(a.welch.valorP)); assert.ok(Number.isFinite(a.kruskal.valorP)); assert.equal(a.posthocMetodo.startsWith("Comparaciones"), true);

const r = regresionLinealSimple([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
assert.ok(Math.abs(r.pendiente - 2) < 1e-12); assert.ok(Math.abs(r.r2 - 1) < 1e-12);

console.log("OK: pruebas estadísticas básicas superadas");
