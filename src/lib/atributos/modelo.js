// Separar el registro en lo que se AJUSTA y lo que se MIDE, y agrupar lo que
// es la misma cosa repetida.
//
// Un registro de fabricación de cápsula blanda deja 194 lecturas de proceso.
// No son 194 parámetros: son unas veinte magnitudes anotadas una y otra vez,
// paso a paso ("VELOCIDAD DE AGITACION (rpm) (4.4.19)", "(4.4.20)",
// "(4.4.22)"…). Clasificar las 194 por separado daría un cuadro ilegible, y
// además le pediría a la IA veinte veces lo mismo.
//
// Se agrupa por MAGNITUD DENTRO DE SU SECCIÓN, no por magnitud a secas. La
// velocidad de agitación en la preparación de la gelatina y la velocidad de
// los rodillos botadores en el encapsulado son dos parámetros distintos, con
// criterios distintos y afectando a atributos distintos; fundirlos en "la
// velocidad" sería perder justo lo que el cuadro tiene que decir.

import { esParametroAprendido, normalizarTermino } from "../vocabulario.js";
import { magnitudesConocidas } from "../parsers/genericParser.js";
import { atributoDe } from "./vocabulario.js";

/** Las lecturas que el análisis considera de proceso. */
const DE_PROCESO = new Set(["critico", "verificacion"]);

// La sección donde el registro lista la maquinaria: nombres de equipo, no
// parámetros. Tiene su propio detector (parsers/equipos.js) y su propio
// cuadro (el Formato 3).
const SECCION_DE_EQUIPOS = /^EQUIPOS?\s*\/|INSTRUMENTOS?\s*\/|^MATERIALES\b/i;

// Contabilidad del lote, no ajustes del proceso: lo que se entregó, lo que se
// obtuvo, lo que se muestreó, lo que se pesó al dispensar. Son 30 de las 112
// lecturas sin criterio de los tres registros del DOLORAL, y ninguna es un
// parámetro que se pueda mantener dentro de un rango: son el resultado de
// contar. El rendimiento sí se clasifica, pero como atributo, que es lo que
// es — el registro le imprime su 90 % - 100 %.
const CONTABILIDAD =
  /^(CANTIDAD|CONTRAMUESTRA|MERMA|PESO (OBTENIDO|NETO|TARA|TOTAL|FINAL TOTAL|INICIAL)|REPORT)\b/;

// Restos de la maquetación del PDF: una etiqueta que empieza por una cifra
// ("0 24 MPA", "65 C") es media línea partida, no una magnitud.
const RESTO_DE_MAQUETACION = /^\d/;

// Cuándo se hizo, no cómo se hizo. La hora de inicio, la de fin y el tiempo
// que pasó entre las dos son la trazabilidad de la etapa —ya tienen su propio
// lector (parsers/tiempos.js) y su propia fila en el cuadro—, no un ajuste
// que alguien mantenga dentro de un rango.
const MARCA_DE_TIEMPO = /^(HORA|TIEMPO (TRANSCURRIDO|TOTAL|DE TRABAJO))\b/;

// Dónde se hizo, tampoco: la sección, la línea y la sala son la cabecera de
// la etapa.
const DONDE = /^(SECCION|LINEA|SALA|LINEA SALA)\b/;

const MAGNITUDES = magnitudesConocidas().map(normalizarTermino).filter((m) => m.length >= 3);

/**
 * Si la magnitud es una de las que el detector reconoce —las de siempre o las
 * que aprendió de un producto nuevo.
 *
 * Es el mismo vocabulario que decide qué entra al cuadro de parámetros, así
 * que aquí no hay una segunda lista que mantener: lo que el detector aprenda
 * mañana también se podrá clasificar.
 */
function nombraUnaMagnitud(magnitud) {
  const texto = ` ${magnitud} `;
  if (MAGNITUDES.some((m) => texto.includes(` ${m} `))) return true;
  return esParametroAprendido(magnitud);
}

/**
 * Si una lectura que no es atributo se puede clasificar como parámetro.
 *
 * El criterio de fondo: un parámetro de proceso es algo que se AJUSTA y se
 * mantiene. Un nombre de equipo no se ajusta; un conteo no se mantiene; y un
 * título de operación sin lectura ni criterio no es nada.
 */
function esClasificable(lectura, magnitud) {
  if (SECCION_DE_EQUIPOS.test(lectura.section || "")) return false;
  if (CONTABILIDAD.test(magnitud) || RESTO_DE_MAQUETACION.test(magnitud)) return false;
  if (MARCA_DE_TIEMPO.test(magnitud) || DONDE.test(magnitud)) return false;

  const tieneLectura = String(lectura.value ?? "").trim() !== "";
  const tieneCriterio = String(lectura.setpoint ?? "").trim() !== "";
  if (!tieneLectura && !tieneCriterio) return false;

  // Con criterio impreso entra sin más: el propio documento está diciendo que
  // eso se mantiene dentro de un rango. Sin criterio hay que pedirle que al
  // menos nombre una magnitud conocida, o se cuelan los títulos de operación
  // y los sobrantes de la maquetación.
  return tieneCriterio || nombraUnaMagnitud(magnitud);
}

/**
 * El nombre de la magnitud, sin el número de paso ni el detalle entre
 * paréntesis: "VELOCIDAD DE AGITACION (rpm) (4.4.19)" y "(4.4.22)" son la
 * misma. Se quita también el "(INICIO)" / "(FINAL)", que es cuándo se anotó y
 * no qué se anotó.
 */
export function magnitudDe(label) {
  return normalizarTermino(
    String(label || "")
      .replace(/\(\s*\d+(?:\.\d+)*[^)]*\)/g, " ") // (4.4.19), (4.4.7 AGREGAR)
      .replace(/\(\s*(?:INICIO|FINAL|INFORMATIVO|RPM|KG|G|MM|°?C)\s*\)/gi, " ")
      .replace(/\bN°?\s*\d+\b/g, " ") // BANDEJA N° 12
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Los criterios distintos que ese parámetro llevó a lo largo de la etapa. */
function criteriosDe(lecturas) {
  const vistos = [];
  for (const l of lecturas) {
    const c = String(l.setpoint || "").trim();
    if (c && !vistos.includes(c)) vistos.push(c);
  }
  return vistos;
}

/**
 * Separa las lecturas de un documento en parámetros de proceso y atributos de
 * calidad, ya agrupados.
 *
 * Devuelve las dos listas, cada elemento con de dónde salió: la etapa, la
 * sección, cuántas veces se anotó y con qué criterios. Esa procedencia es lo
 * que permite que el cuadro final diga por qué dice lo que dice.
 */
export function separarLecturas(documentos = []) {
  const parametros = new Map();
  const atributos = new Map();

  for (const doc of documentos) {
    if (doc?.kind === "orden") continue;
    const etapa = doc?.stage || doc?.meta?.stage || "SIN ETAPA";

    for (const lectura of doc?.params || []) {
      if (!DE_PROCESO.has(lectura.category)) continue;

      const seccion = lectura.section || "GENERAL";
      const atributo = atributoDe(lectura);

      if (atributo) {
        const clave = `${etapa}|${atributo}`;
        if (!atributos.has(clave)) {
          atributos.set(clave, { nombre: atributo, etapa, secciones: [], lecturas: [] });
        }
        const a = atributos.get(clave);
        if (!a.secciones.includes(seccion)) a.secciones.push(seccion);
        a.lecturas.push(lectura);
        continue;
      }

      const magnitud = magnitudDe(lectura.label);
      // Una etiqueta que se queda en nada al quitarle el paso ("°C)", "AGREGAR")
      // es un resto de la maquetación del PDF, no un parámetro.
      if (magnitud.length < 4) continue;
      if (!esClasificable(lectura, magnitud)) continue;

      const clave = `${etapa}|${seccion}|${magnitud}`;
      if (!parametros.has(clave)) {
        parametros.set(clave, { magnitud, etapa, seccion, lecturas: [] });
      }
      parametros.get(clave).lecturas.push(lectura);
    }
  }

  const rematar = (mapa) =>
    [...mapa.values()].map((x) => ({
      ...x,
      veces: x.lecturas.length,
      criterios: criteriosDe(x.lecturas),
      // Los pasos del registro donde se lee ("4.4.16"): es lo que permite
      // volver al RMD y marcar en qué operación va el V°B°.
      pasos: [...new Set(x.lecturas.map((l) => l.paso).filter(Boolean))],
      ejemplo: x.lecturas[0]?.label || "",
    }));

  return { parametros: rematar(parametros), atributos: rematar(atributos) };
}

/**
 * Los parámetros que vale la pena clasificar, de más a menos sustentado.
 *
 * Primero los que el registro imprime con un criterio de aceptación: si el
 * documento se molestó en poner un rango, es porque ahí hay algo que
 * mantener. Es también el orden en que conviene gastar las llamadas a la IA
 * cuando hay un tope.
 */
export function porRelevancia(parametros) {
  return [...parametros].sort((a, b) => {
    const ca = a.criterios.length > 0 ? 0 : 1;
    const cb = b.criterios.length > 0 ? 0 : 1;
    return ca - cb || b.veces - a.veces || a.magnitud.localeCompare(b.magnitud);
  });
}
