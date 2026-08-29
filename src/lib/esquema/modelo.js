// Convierte un registro de manufactura en el esquema del proceso: la lista
// ordenada de operaciones, con lo que hay que controlar en cada una, el equipo
// que se usa y los insumos que entran.
//
// El registro ya trae todo lo que el Formato 01 dibuja —los rangos de
// operación viven en el propio texto de cada paso, los equipos en su sección y
// las cantidades por fracción en los pasos de pesada— pero repartido y con
// otro nombre. Aquí se recoge y se ordena; dibujarlo es cosa de lienzo.js.

import { detectParameters } from "../parsers/genericParser.js";
import { detectEquipos } from "../parsers/equipos.js";
import { detectInsumos } from "../parsers/insumos.js";
import { extractMeta } from "../parsers/meta.js";
import { nombreDeOperacion } from "./nombres.js";

// Secciones que no son operaciones del proceso: papeleo, alistar la sala y
// las máquinas, desmontar, y los recuentos del final.
//
// "PREPARACION DE LA SOLUCION GRANULANTE" y "PREPARACION DE LA SUSPENSION DE
// RECUBRIMIENTO" sí son operaciones —son el DISOLVER y el DISPERSAR del
// esquema— y por eso se salvan antes de descartar todo lo que empieza por
// "preparar".
const SI_ES_OPERACION = /PREPARACI[OÓ]N\s+DE\s+LA\s+(SOLUCION|SOLUCIÓN|SUSPENSION|SUSPENSIÓN)/i;

const NO_ES_OPERACION =
  /^(GENERAL|EQUIPOS|INSUMOS|CONDICIONES AMBIENTALES|DOCUMENTACION|DOCUMENTACIÓN|PREPARA|SET\s*UP|RENDIMIENTO|RANGO DE ACEPTACION|VERIFICACION DE FIRMAS|TIEMPO TOTAL|EN\s|VERIFICAR|REGISTRAR|ROTULAR|COLOCAR|UBICAR|TRASLADAR|RETIRAR|ENTREGAR|REALIZAR|CONTABILIZAR)/i;

// Algunos pasos que el detector toma por encabezado son frases del
// procedimiento, no nombres de operación. Se reconocen porque llevan dentro un
// verbo de comprobación.
const ES_FRASE_RE = /(VERIFICAR|VERIFIQUE|ASEGURAR|REGISTRAR|ANOTAR|CONTABILIZAR)/i;

// Un renglón que no describe cómo se opera, aunque traiga "setpoint".
const NO_ES_RANGO = /^(VERIFICADO POR|REALIZADO POR|CODIGO|NOTA|OPCION)/i;

/** Toda operación real del registro anota cuándo empezó y cuándo terminó. */
const ES_OPERACION_RE = /^(HORA|FECHA\s*\/\s*HORA|TIEMPO)/i;

// El alistado de la máquina no es un paso del esquema, pero sus rangos sí son
// los de la operación: en envase, la temperatura de moldeo y la de sellado se
// registran al preparar la blistera y en el esquema van dentro de la caja de
// ENVASE.
const AJUSTE_DE_MAQUINA_RE =
  /^(REALIZAR\s+LA\s+PREPARACION|UBICAR\s+LAS\s+PIEZAS|PREPARACI[OÓ]N\s+DE\s+LAS\s+MAQUINAS)/i;

// Las condiciones de la sala, que describen dónde se trabaja y no cómo.
const ES_AMBIENTAL_RE = /^(TEMPERATURA|HUMEDAD\s+RELATIVA)$/i;

// Los controles en proceso del formato: lo que Calidad mide sobre el producto,
// no sobre la máquina.
const CONTROL_RE =
  /^(DESCRIPCION|DESCRIPCIÓN|DUREZA|FRIABILIDAD|DESINTEGRACION|DESINTEGRACIÓN|PESO PROMEDIO|PESOS INDIVIDUALES|HERMETICIDAD|VARIACION DE PESO)/i;

// Cómo se abrevian los rangos en las cajas del esquema.
const ABREVIA = [
  [/TEMPERATURA/i, "T°"],
  [/TIEMPO|^t\b/i, "t"],
  [/VELOCIDAD|PRESION DE AIRE COMPRIMIDO/i, "Velocidad"],
  [/HUMEDAD/i, "Humedad"],
  [/PRESION/i, "Presión"],
];

/**
 * "TEMPERATURA — Lectura 1" -> "T°", pero "TEMPERATURA DE MOLDEO" se queda
 * como está: en la caja de envase conviven la de moldeo y la de sellado, y
 * abreviar las dos a "T°" las volvería indistinguibles.
 */
function abreviar(label) {
  const limpio = label.replace(/\s*—\s*Lectura\s*\d+\s*$/i, "").trim();
  const corta = ABREVIA.find(([re]) => re.test(limpio));
  if (!corta) return limpio;

  const desnuda = limpio.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const conCualificador = desnuda.split(/\s+/).length > 1;
  return conCualificador ? limpio : corta[1];
}

function sinLectura(label) {
  return label.replace(/\s*—\s*Lectura\s*\d+\s*$/i, "").trim();
}

/**
 * Los renglones de rango de una operación: "T°: 70 °C ± 5 °C".
 *
 * Sólo entran los parámetros que declaran un rango; los que sólo tienen el
 * valor que anotó el operario describen un lote concreto, no el proceso, y el
 * esquema no habla de lotes.
 */
function rangosDe(params) {
  const vistos = new Set();
  const lineas = [];

  for (const p of params) {
    const rango = (p.setpoint || "").trim();
    if (!rango || rango.toUpperCase() === "UNICA") continue;
    if (CONTROL_RE.test(sinLectura(p.label))) continue;
    if (NO_ES_RANGO.test(sinLectura(p.label))) continue;

    const texto = `${abreviar(p.label)}: ${rango}`;
    if (vistos.has(texto)) continue;
    vistos.add(texto);
    lineas.push(texto);
  }

  return lineas;
}

/**
 * Los equipos cuyo nombre aparece en el texto de esta sección del registro.
 *
 * No basta con la primera palabra: "TAMIZ DE ACERO INOXIDABLE N° 20" y el N° 60
 * empiezan igual, y el paso los nombra como "Tamiz N° 20". Se exige la primera
 * palabra significativa y, si el equipo lleva número, también ese número.
 */
function equiposDeSeccion(textoSeccion, equipos) {
  const texto = textoSeccion.toUpperCase().replace(/\s+/g, " ");

  return equipos
    .filter((e) => {
      const nombre = e.descripcion.toUpperCase();
      const primera = nombre.split(/\s+/)[0];
      if (primera.length < 5 || !texto.includes(primera)) return false;

      const numero = nombre.match(/N\s*[°ºo.]*\s*(\d+)/);
      if (!numero) return true;

      // Con número, el paso tiene que nombrar ese mismo número. El "no seguido
      // de dígito" evita que el tamiz N° 2 case con el N° 20.
      const patron = String.raw`N\s*[°ºo.]*\s*` + numero[1] + String.raw`(?!\d)`;
      return new RegExp(patron).test(texto);
    })
    .map((e) => e.descripcion);
}

/**
 * El tiempo de la operación, que el registro escribe en la prosa del paso y no
 * como campo: "TIEMPO DE AGITACION NO MENOS DE 20 MINUTOS", "TIEMPO DE MEZCLA
 * (Minutos) : 15". Es uno de los tres datos que el esquema pone en cada caja.
 */
function tiemposDeSeccion(textoSeccion) {
  const texto = textoSeccion.replace(/\s+/g, " ");
  const salida = [];

  const minimo = texto.match(/TIEMPO\s+DE\s+\w+\s+NO\s+MENOS\s+DE\s+(\d+)\s*(MINUTOS?|HORAS?)/i);
  if (minimo) salida.push(`t: No menos de ${minimo[1]} ${minimo[2].toLowerCase()}`);

  const exacto = texto.match(/TIEMPO\s+DE\s+\w+\s*\(\s*(MINUTOS?|HORAS?)\s*\)\s*:?\s*(\d+)/i);
  if (exacto) salida.push(`t: ${exacto[2]} ${exacto[1].toLowerCase()}`);

  return salida;
}

/** El texto de cada sección, para poder buscar en ella los equipos. */
function textoPorSeccion(pages) {
  const porSeccion = new Map();
  let seccion = null;

  for (const page of pages) {
    for (const linea of page.lines) {
      const t = String(linea.text || "");
      const m = t.match(/^(\d+(?:\.\d+)*)\s*\.-\s*(.+)$/);
      if (m) {
        const titulo = m[2].replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
        if (titulo && titulo.length <= 70) seccion = titulo;
      }
      if (!seccion) continue;
      porSeccion.set(seccion, `${porSeccion.get(seccion) || ""} ${t}`);
    }
  }

  return porSeccion;
}

/**
 * El esquema de una etapa, a partir de las páginas de su registro.
 */
export function esquemaDeRegistro(pages) {
  const flat = pages.map((p) => p.lines.map((l) => l.text).join(" ")).join(" ").replace(/\s+/g, " ");
  const meta = extractMeta(flat, pages);
  const params = detectParameters(pages);
  const equipos = detectEquipos(pages);
  const textos = textoPorSeccion(pages);

  const porSeccion = new Map();
  for (const p of params) {
    if (!porSeccion.has(p.section)) porSeccion.set(p.section, []);
    porSeccion.get(p.section).push(p);
  }

  // Los rangos del alistado se guardan para la caja de la etapa.
  const deAjuste = [];
  for (const [seccion, suyos] of porSeccion) {
    if (AJUSTE_DE_MAQUINA_RE.test(seccion)) deAjuste.push(...rangosDe(suyos));
  }

  const etapa = (meta.stage || "").toUpperCase();
  const operaciones = [];

  for (const [seccion, suyos] of porSeccion) {
    const esLaEtapa = seccion === etapa;
    if (!esLaEtapa) {
      if (!SI_ES_OPERACION.test(seccion) && NO_ES_OPERACION.test(seccion)) continue;
      if (ES_FRASE_RE.test(seccion)) continue;
      // Sin hora de inicio no es una operación, es una anotación suelta.
      if (!suyos.some((p) => ES_OPERACION_RE.test(sinLectura(p.label)))) continue;
    }

    const texto = textos.get(seccion) || "";
    // El tiempo va primero: es lo que el esquema pone justo bajo el nombre.
    const propios = [...tiemposDeSeccion(texto), ...rangosDe(suyos)];
    const lineas = esLaEtapa ? [...propios, ...deAjuste] : propios;

    // La sección que se llama como la etapa a veces sólo trae la sala y las
    // condiciones ambientales —en fabricación es así— y entonces no es un paso
    // del proceso sino su cabecera. Sólo entra si aporta algún rango de
    // operación de verdad.
    if (esLaEtapa && !suyos.some((p) => p.setpoint && !ES_AMBIENTAL_RE.test(sinLectura(p.label)))) continue;
    if (esLaEtapa && deAjuste.length === 0 && propios.length === 0) continue;

    operaciones.push({
      seccion,
      titulo: nombreDeOperacion(seccion),
      lineas: [...new Set(lineas)],
      equipo: esLaEtapa && equipos.length > 0
        ? equiposDeSeccion(texto, equipos).length > 0
          ? equiposDeSeccion(texto, equipos)
          : [equipos[0].descripcion]
        : equiposDeSeccion(texto, equipos),
    });
  }

  // Los controles en proceso van juntos, al margen: son de Calidad y se
  // refieren al producto, no a una operación concreta.
  const controles = [];
  const vistos = new Set();
  for (const p of params) {
    const nombre = sinLectura(p.label);
    if (!CONTROL_RE.test(nombre) || !p.setpoint) continue;
    const texto = `- ${nombre.charAt(0)}${nombre.slice(1).toLowerCase()}: ${p.setpoint}`;
    if (vistos.has(texto)) continue;
    vistos.add(texto);
    controles.push(texto);
  }

  const insumos = detectInsumos(pages)
    .filter((i) => i.descripcion)
    .map((i) => ({
      nombre: i.descripcion,
      cantidad: `${i.cantidad ?? i.cantidadRecibida ?? ""} ${i.unidad ?? i.unidadRecibida ?? ""}`.trim(),
    }));

  return {
    etapa: meta.stage || "PROCESO",
    producto: meta.producto || "",
    lote: meta.lote || "",
    operaciones,
    controles,
    insumos,
    equipos: equipos.map((e) => e.descripcion),
  };
}

/** Ordena las etapas como transcurre el proceso. */
const ORDEN = ["FABRICACION", "RECUBRIMIENTO", "ENVASE", "ACONDICIONADO"];

export function ordenarEtapas(esquemas) {
  return [...esquemas].sort((a, b) => {
    const ia = ORDEN.indexOf(a.etapa);
    const ib = ORDEN.indexOf(b.etapa);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.etapa.localeCompare(b.etapa);
  });
}
