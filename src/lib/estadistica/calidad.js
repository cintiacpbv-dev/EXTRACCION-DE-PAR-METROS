// Calidad de datos: lo que hay que mirar ANTES de correr cualquier prueba,
// no después. Ninguna función de aquí decide nada por su cuenta ni borra
// nada de la hoja — sólo describe lo que hay, para que la persona vea de un
// vistazo si tiene con qué trabajar.
import { hastaElUltimoDato } from "./descriptiva.js";

/**
 * Calidad de una columna: cuántas filas tiene, cuántas están vacías, cuántas
 * no son numéricas (cuando se declaró numérica), duplicados exactos, e
 * infinitos. "usables" es lo que de verdad entraría en un cálculo.
 *
 * Los duplicados se cuentan sobre valores no vacíos: dos celdas en blanco no
 * son "el mismo dato repetido", son dos datos que faltan.
 */
export function calidadColumna(columna) {
  const usados = hastaElUltimoDato(columna.values);
  const n = usados.length;
  const noVacios = usados.filter((v) => v != null && String(v).trim() !== "");
  const faltantes = n - noVacios.length;

  const infinitos = noVacios.filter((v) => typeof v === "number" && !Number.isFinite(v)).length;
  const noNumericos = columna.type === "numeric" ? noVacios.filter((v) => typeof v !== "number" || Number.isNaN(v)).length : 0;

  const conteo = new Map();
  for (const v of noVacios) {
    const clave = String(v);
    conteo.set(clave, (conteo.get(clave) || 0) + 1);
  }
  let duplicados = 0;
  for (const veces of conteo.values()) if (veces > 1) duplicados += veces - 1;

  const usables =
    columna.type === "numeric"
      ? noVacios.filter((v) => typeof v === "number" && Number.isFinite(v)).length
      : noVacios.length;

  return {
    nombre: columna.name,
    tipo: columna.type,
    n,
    faltantes,
    noNumericos,
    infinitos,
    duplicados,
    usables,
  };
}

/**
 * Resumen de calidad de varias columnas a la vez — lo que se muestra antes
 * de elegir qué análisis correr. No decide qué es "lote" ni qué es "fecha":
 * eso lo dice el tipo ya detectado de la columna (ver csv.js/store.js) o lo
 * elige la persona a mano en cada análisis; aquí sólo se describe.
 */
export function calidadDeColumnas(columnas) {
  const filas = columnas.map(calidadColumna);
  const totalFaltantes = filas.reduce((a, f) => a + f.faltantes, 0);
  const totalDuplicados = filas.reduce((a, f) => a + f.duplicados, 0);
  const totalNoNumericos = filas.reduce((a, f) => a + f.noNumericos, 0);
  const columnasFecha = columnas.filter((c) => c.type === "date").length;
  return {
    columnas: filas,
    numColumnas: columnas.length,
    numVariablesNumericas: columnas.filter((c) => c.type === "numeric").length,
    numVariablesTexto: columnas.filter((c) => c.type === "text").length,
    numVariablesFecha: columnasFecha,
    totalFaltantes,
    totalDuplicados,
    totalNoNumericos,
    // Si no hay ninguna columna de fecha, no hay cómo comprobar el orden
    // temporal — información que necesitan las cartas de control y el SPC
    // temporal para saber si tiene sentido correrlos.
    hayOrdenTemporal: columnasFecha > 0,
  };
}
