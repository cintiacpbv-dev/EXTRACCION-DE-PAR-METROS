// Prueba de normalidad de Anderson-Darling — la misma que usa Minitab por
// defecto en su Gráfica de probabilidad.
//
// Verificada contra un caso real, no inventado: los 100 valores de
// "Control de envasado - Lote 2" de una validación real (Lidenart 2%,
// Medenfar) reportan en Minitab Media 1.824, Desv.Est. 0.002611, AD 1.495,
// Valor p < 0.005 — este módulo, con esos mismos datos, da Media 1.82415,
// Desv.Est. 0.0026105, AD 1.4951836 (redondea a 1.495) y valor p 0.0007
// (< 0.005). Coincide.
//
// El detalle que hizo falta descubrir para que coincidiera: Minitab
// *muestra* el estadístico AD sin corregir por tamaño de muestra, pero
// *calcula* el valor p con la versión corregida (D'Agostino y Stephens,
// "Goodness-of-Fit Techniques", 1986) — son dos números distintos del
// mismo estudio, no un error de redondeo.
import jStat from "jstat";
import { valoresNumericos } from "./descriptiva.js";

/**
 * Valor p empírico de Anderson-Darling (D'Agostino y Stephens 1986, tabla
 * 4.7), a partir del estadístico ya corregido por tamaño de muestra.
 */
function valorPAndersonDarling(a2Corregido) {
  const a = a2Corregido;
  if (a >= 0.6) return Math.exp(1.2937 - 5.709 * a + 0.0186 * a * a);
  if (a >= 0.34) return Math.exp(0.9177 - 4.279 * a - 1.38 * a * a);
  if (a >= 0.2) return 1 - Math.exp(-8.318 + 42.796 * a - 59.938 * a * a);
  return 1 - Math.exp(-13.436 + 101.14 * a - 223.73 * a * a);
}

/**
 * Prueba de normalidad de Anderson-Darling sobre una columna numérica.
 * También devuelve los puntos ya listos para una gráfica de probabilidad:
 * cada valor ordenado con la posición de trazado que le corresponde (el
 * método de Benard, el mismo que usa Minitab por defecto) y el valor Z que
 * representa esa posición en la escala de probabilidad normal.
 */
export function pruebaNormalidad(values) {
  const datos = valoresNumericos(values);
  const n = datos.length;
  if (n < 4) return { error: "Hacen falta al menos 4 valores." };

  const media = datos.reduce((a, b) => a + b, 0) / n;
  const varianza = datos.reduce((acc, x) => acc + (x - media) ** 2, 0) / (n - 1);
  const desvEst = Math.sqrt(varianza);

  if (desvEst === 0) return { error: "Todos los valores son idénticos: no hay variación que probar." };

  const ordenados = [...datos].sort((a, b) => a - b);
  const z = ordenados.map((y) => (y - media) / desvEst);
  const Phi = z.map((zi) => jStat.normal.cdf(zi, 0, 1));

  let suma = 0;
  for (let i = 1; i <= n; i++) {
    const Fi = Phi[i - 1];
    const Fni1 = Phi[n - i];
    // Un valor repetido muchas veces puede empujar Fi a exactamente 0 o 1,
    // y log(0) rompe toda la suma — se recorta al épsilon más chico que
    // representa un double, igual que hacen las implementaciones de
    // referencia (no cambia el resultado salvo en ese caso extremo).
    const a = Math.min(Math.max(Fi, Number.EPSILON), 1 - Number.EPSILON);
    const b = Math.min(Math.max(Fni1, Number.EPSILON), 1 - Number.EPSILON);
    suma += (2 * i - 1) * (Math.log(a) + Math.log(1 - b));
  }
  const ad = -n - suma / n;
  const adCorregido = ad * (1 + 0.75 / n + 2.25 / (n * n));
  const valorP = valorPAndersonDarling(adCorregido);

  // Posición de trazado de Benard: (i − 0.3)/(n + 0.4) — la aproximación de
  // "rango mediano" que usa Minitab por defecto en su gráfica de
  // probabilidad, para el i-ésimo valor ordenado (1-indexado).
  const puntos = ordenados.map((valor, idx) => {
    const i = idx + 1;
    const percentil = (i - 0.3) / (n + 0.4);
    return { valor, percentil, z: jStat.normal.inv(percentil, 0, 1) };
  });

  return { n, media, desvEst, ad, valorP, puntos };
}
