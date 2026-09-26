// El orden y la numeración de los parámetros en la evaluación.
//
// El N° que un parámetro recibe en el Paso 2 es su nombre en todo lo demás:
// el Paso 3 y el FMEA lo citan, y el RMD coloreado dice "eval. 4, 5, 23" para
// que quien lo lee sepa qué fila de la evaluación justifica el V°B°. Por eso
// se calcula en un solo sitio y en el orden del proceso: etapa por etapa, y
// dentro de cada etapa, por el paso del registro donde se lee.

/** Compara códigos de paso numéricamente: 4.4.9 va antes que 4.4.10. */
export function compararPasos(a, b) {
  const pa = String(a || "").split(".").map(Number);
  const pb = String(b || "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** El primer paso de una fila: el de sus lecturas o el que encabeza su operación. */
export function pasosDe(fila) {
  if (fila.pasos?.length) return [...fila.pasos].sort(compararPasos);
  const m = String(fila.seccion || "").match(/^\s*(\d+(?:\.\d+){1,3})\b/);
  return m ? [m[1]] : [];
}

/**
 * Las filas en el orden del proceso. Las etapas quedan en el orden en que
 * aparecen; dentro de cada una, las que tienen paso se ordenan por él, y las
 * que no lo tienen conservan su lugar relativo al final.
 */
export function ordenDeProceso(filas = []) {
  const etapas = [];
  const porEtapa = new Map();
  filas.forEach((f, i) => {
    if (!porEtapa.has(f.etapa)) {
      porEtapa.set(f.etapa, []);
      etapas.push(f.etapa);
    }
    porEtapa.get(f.etapa).push({ f, i });
  });
  return etapas.flatMap((e) =>
    porEtapa
      .get(e)
      .sort((a, b) => {
        const pa = pasosDe(a.f)[0];
        const pb = pasosDe(b.f)[0];
        if (pa && pb) return compararPasos(pa, pb) || a.i - b.i;
        if (pa) return -1;
        if (pb) return 1;
        return a.i - b.i;
      })
      .map((x) => x.f)
  );
}

/** id → N°, en el orden del proceso. */
export function numerar(filas = []) {
  const numeros = new Map();
  ordenDeProceso(filas).forEach((f, i) => numeros.set(f.id, i + 1));
  return numeros;
}

/** "eval. 4, 5, 23" — o "eval. 12–14" cuando son seguidos. */
export function citaDeEvaluacion(numeros) {
  const n = [...new Set(numeros)].filter(Number.isFinite).sort((a, b) => a - b);
  if (n.length === 0) return "";
  const tramos = [];
  for (const x of n) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && x === ultimo[1] + 1) ultimo[1] = x;
    else tramos.push([x, x]);
  }
  return `eval. ${tramos.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a}, ${b}` : `${a}–${b}`)).join(", ")}`;
}
