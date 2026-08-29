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
import { cajasDePasos, pasosPorSeccion, unidadesPorCodigo } from "./pasos.js";

// Secciones que no son operaciones del proceso: papeleo, alistar la sala y
// las máquinas, desmontar, y los recuentos del final.
//
// Preparar la solución granulante, el bulk o la gelatina sí son operaciones
// unitarias del proceso —son el DISOLVER, el HOMOGENEIZAR y el PREPARACIÓN DEL
// BULK del esquema— y se salvan antes de descartar todo lo que empieza por
// "preparar", que si no se llevaría por delante también el alistado de la sala
// y de las máquinas.
const SI_ES_OPERACION =
  /PREPARACI[OÓ]N\s+DE(?:\s+LA|\s+LOS?|L)?\s+(SOLUCI[OÓ]N|SUSPENSI[OÓ]N|BULK|GELATINA|CONTENIDO|MEZCLA|EMULSI[OÓ]N|JARABE)/i;

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
 * Si esta etiqueta nombra un insumo de la etapa.
 *
 * No se compara por igualdad: la lista de insumos escribe "SORBITOL SOLUCION
 * NO CRISTALIZANTE 70%" y el paso lo llama "SORBITOL SOLUCION NO
 * CRISTALIZANTE", así que basta con que uno empiece por el otro.
 */
function esInsumo(etiqueta, nombresInsumo) {
  const e = etiqueta.toUpperCase();
  if (e.length < 5) return false;
  for (const nombre of nombresInsumo) {
    if (nombre.startsWith(e) || e.startsWith(nombre)) return true;
  }
  return false;
}

/**
 * Los insumos que entran en esta operación, con la cantidad que declara el
 * registro.
 *
 * El esquema no lista los insumos todos juntos al principio: cada uno cuelga
 * de la operación donde se agrega, y por eso el mismo producto lleva agua
 * purificada en el bulk y otra vez en la gelatina.
 */
function insumosDeSeccion(params, nombresInsumo) {
  const vistos = new Set();
  const salida = [];

  for (const p of params) {
    if (!esInsumo(sinLectura(p.label), nombresInsumo)) continue;

    // El valor trae lo declarado y lo dispensado ("14 L 14.000"); al esquema
    // va lo declarado, que es lo que manda la fórmula. Algunos insumos no
    // llevan cantidad sino el grado con el que entran ("Sorbitol: 70%"), y ése
    // está en el rango.
    const cantidad =
      String(p.value ?? "").trim().split(/\s{2,}|\s(?=\d+\.\d{3}$)/)[0].trim() ||
      String(p.setpoint ?? "").trim();
    if (!cantidad) continue;

    const texto = `${sinLectura(p.label)}: ${cantidad}`;
    if (vistos.has(texto)) continue;
    vistos.add(texto);
    salida.push(texto);
  }

  return salida;
}

/**
 * Los renglones de rango de una operación: "T°: 70 °C ± 5 °C".
 *
 * Sólo entran los parámetros que declaran un rango; los que sólo tienen el
 * valor que anotó el operario describen un lote concreto, no el proceso, y el
 * esquema no habla de lotes.
 */
function rangosDe(params, nombresInsumo = new Set()) {
  const vistos = new Set();
  const lineas = [];

  for (const p of params) {
    const rango = (p.setpoint || "").trim();
    if (!rango || rango.toUpperCase() === "UNICA") continue;
    if (CONTROL_RE.test(sinLectura(p.label))) continue;
    if (NO_ES_RANGO.test(sinLectura(p.label))) continue;
    // Un insumo es un material que entra, no un rango de operación: cuelga de
    // la caja como agregación, no se lista dentro de ella.
    if (esInsumo(sinLectura(p.label), nombresInsumo)) continue;

    const texto = `${abreviar(p.label)}: ${rango}`;
    if (vistos.has(texto)) continue;
    vistos.add(texto);
    lineas.push(texto);
  }

  return lineas;
}

/**
 * Los equipos cuyo nombre aparece en el texto de este paso o sección.
 *
 * Se compara sin espacios: el registro escribe "TANQUE DE 250 L (B)" donde la
 * lista de equipos dice "TANQUE 250L B1", y "Tamiz N° 20" donde dice "TAMIZ DE
 * ACERO INOXIDABLE N° 20 (0.85 mm)".
 *
 * Se exige la primera palabra y, además, todos los identificadores del nombre
 * —los trozos que llevan un dígito—. Sin esa segunda condición un paso que
 * nombra "el tanque de 250 L" se llevaba de golpe los cinco tanques de la
 * planta, y el tamiz N° 20 arrastraba también al N° 60.
 */
function equiposDeSeccion(textoSeccion, equipos) {
  const texto = textoSeccion.toUpperCase().replace(/\s+/g, "");

  return equipos
    .filter((e) => {
      // Lo que va entre paréntesis es una aclaración del inventario ("(Grande)",
      // "(0.85 mm)") que el paso no repite.
      const nombre = e.descripcion.toUpperCase().replace(/\([^)]*\)/g, " ");
      const palabras = nombre.split(/\s+/).filter(Boolean);
      if (palabras.length === 0) return false;

      const primera = palabras[0];
      if (primera.length < 5 || !texto.includes(primera)) return false;

      const identificadores = palabras.filter((t) => /\d/.test(t));
      return identificadores.every((t) => texto.includes(t.replace(/[°º.]/g, "")));
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

  const unidades = unidadesPorCodigo(pages);
  const insumosDeEtapa = detectInsumos(pages).filter((i) => i.descripcion);
  const nombresInsumo = new Set(insumosDeEtapa.map((i) => i.descripcion.toUpperCase()));

  const porSeccion = new Map();
  for (const p of params) {
    if (!porSeccion.has(p.section)) porSeccion.set(p.section, []);
    porSeccion.get(p.section).push(p);
  }

  // Los pasos numerados de cada sección, para poder partir una operación
  // unitaria en las cajas que el esquema dibuja. Se reconoce que un paso abre
  // sección comparándolo con las que ya encontró el detector genérico.
  const pasos = pasosPorSeccion(pages, (titulo) => {
    const limpio = titulo.replace(/\s*\([^)]*\)\s*$/, "").replace(/:$/, "").trim().toUpperCase();
    return limpio && limpio.length <= 70 && porSeccion.has(limpio) ? limpio : null;
  });

  // Los rangos del alistado se guardan para la caja de la etapa.
  const deAjuste = [];
  for (const [seccion, suyos] of porSeccion) {
    if (AJUSTE_DE_MAQUINA_RE.test(seccion)) deAjuste.push(...rangosDe(suyos, nombresInsumo));
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
    const propios = [...tiemposDeSeccion(texto), ...rangosDe(suyos, nombresInsumo)];
    const lineas = esLaEtapa ? [...propios, ...deAjuste] : propios;

    // La sección que se llama como la etapa a veces sólo trae la sala y las
    // condiciones ambientales —en fabricación es así— y entonces no es un paso
    // del proceso sino su cabecera. Sólo entra si aporta algún rango de
    // operación de verdad.
    if (esLaEtapa && !suyos.some((p) => p.setpoint && !ES_AMBIENTAL_RE.test(sinLectura(p.label)))) continue;
    if (esLaEtapa && deAjuste.length === 0 && propios.length === 0) continue;

    const equipoDeSeccion =
      esLaEtapa && equipos.length > 0 && equiposDeSeccion(texto, equipos).length === 0
        ? [equipos[0].descripcion]
        : equiposDeSeccion(texto, equipos);

    // Una operación unitaria —preparar el bulk, la gelatina, la solución
    // granulante— se dibuja como varias cajas: una por paso del registro. Sólo
    // se parte si de verdad salen dos o más; si no, la sección entera es una
    // caja, que es como se ven las demás etapas.
    const cajas = cajasDePasos(pasos.get(seccion) || [], {
      equiposDeTexto: (t) => equiposDeSeccion(t, equipos),
      unidadDe: (codigo) => unidades.get(codigo) || "",
    });

    if (cajas.length >= 2) {
      for (const caja of cajas) {
        operaciones.push({
          seccion,
          grupo: nombreDeOperacion(seccion),
          titulo: caja.titulo,
          insumos: caja.insumos,
          lineas: caja.lineas,
          equipo: caja.equipo,
        });
      }
      continue;
    }

    operaciones.push({
      seccion,
      titulo: nombreDeOperacion(seccion),
      // Lo que se agrega en esta operación: es lo que en el esquema cuelga a
      // su izquierda con una flecha.
      insumos: insumosDeSeccion(suyos, nombresInsumo),
      lineas: [...new Set(lineas)],
      equipo: equipoDeSeccion,
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

  const insumos = insumosDeEtapa
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
