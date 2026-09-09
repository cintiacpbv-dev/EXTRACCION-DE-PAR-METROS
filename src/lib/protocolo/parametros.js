// Los parámetros que el protocolo de validación manda verificar, leídos del
// propio protocolo.
//
// El registro de manufactura dice lo que pasó; el protocolo dice lo que
// debía pasar, y lo dice de una forma que el registro no tiene: por
// operación y en orden. "Temperatura … Verificar con un termómetro … 60 °C ±
// 5 °C" bajo el título "Enfriamiento (1) de la solución de hidróxido de
// potasio" es una fila del protocolo; en el registro esa misma medida se
// llama "TEMPERATURA (4.4.5 ENFRIAR)" y no dice ni con qué se verifica ni de
// qué operación forma parte. De ahí sale el Formato 02.
//
// Sirven dos documentos distintos, porque los dos traen la misma tabla:
//   - el protocolo (PVP), donde la tabla tiene tres columnas
//     (Parámetro · Modo de verificación · Rango de operación);
//   - el Formato 9 en blanco, donde tiene siete: las tres de arriba, con el
//     parámetro partido en dos columnas, más Resultado, Verificado y Cumple.
// Se distinguen por su propia fila de encabezado, no por el nombre del
// archivo.

import { leerProtocolo, textoDe } from "./documento.js";

const RE_PARRAFO = /<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g;
const RE_TABLA = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
const RE_FILA = /<w:tr\b[\s\S]*?<\/w:tr>/g;
const RE_CELDA = /<w:tc>[\s\S]*?<\/w:tc>/g;

// "Etapa de Fabricación:", "Etapa Etapa de Inspección visual…" (el protocolo
// repite la palabra en un título, y así viene en el papel).
const RE_ETAPA = /^(?:Etapa\s+)?Etapa\s+de\s+(.+?)\s*:?\s*$/i;

// El protocolo no titula las columnas siempre igual: la mayoría de las
// etapas escribe "Parámetro de Proceso … Rango de operación", pero Secado e
// Inspección escriben "Parámetros … Rango esperado". Con los títulos rígidos
// esas dos etapas desaparecían enteras del Formato 02 y en silencio, que es
// lo peor: un cuadro al que le falta una etapa y no lo dice.
//
// Aceptar las variantes no afloja el filtro, porque una tabla sólo cuenta
// como tabla de parámetros si trae las TRES columnas.
const CABECERA_PARAMETRO = /^\s*Par[áa]metros?\b/i;
const CABECERA_MODO = /Modo\s+de\s+verificaci[óo]n/i;
const CABECERA_RANGO = /Rango\s+(?:de\s+operaci[óo]n|esperado)/i;

/** Cuántas columnas ocupa una celda (las combinadas cuentan por todas). */
function ancho(celdaXml) {
  const m = celdaXml.match(/w:gridSpan\s+w:val="(\d+)"/);
  return m ? Number(m[1]) : 1;
}

/** Una celda continuada de la de arriba no repite el texto: lo hereda. */
function esContinuacion(celdaXml) {
  return /<w:vMerge(?:\s+w:val="continue")?\s*\/>/.test(celdaXml);
}

/**
 * Las celdas de una fila, cada una con la columna de la rejilla en la que
 * empieza.
 *
 * Hay que contar columnas y no celdas: en cuanto una celda va combinada en
 * horizontal, la tercera celda de la fila deja de ser la tercera columna. En
 * este mismo protocolo hay tablas donde "Parámetro de Proceso" ocupa dos
 * columnas y otras donde ocupa una, y contando celdas el modo de
 * verificación se leía en la casilla del rango.
 */
function celdasDe(filaXml) {
  let columna = 0;
  return [...filaXml.matchAll(RE_CELDA)].map((m) => {
    const celda = {
      texto: textoDe(m[0]),
      columna,
      ancho: ancho(m[0]),
      continuacion: esContinuacion(m[0]),
    };
    columna += celda.ancho;
    return celda;
  });
}

/** La celda que ocupa una columna de la rejilla, o null si la fila no llega. */
function enColumna(celdas, columna) {
  return celdas.find((c) => columna >= c.columna && columna < c.columna + c.ancho) || null;
}

/** Columnas de la rejilla que cubre la fila entera. */
function anchoDeFila(celdas) {
  const ultima = celdas[celdas.length - 1];
  return ultima ? ultima.columna + ultima.ancho : 0;
}

/**
 * Los bloques del documento —párrafos y tablas— en el orden en que están.
 *
 * Hace falta el orden porque el nombre de la etapa no vive dentro de la
 * tabla sino en el párrafo que la precede.
 */
function bloques(xml) {
  const encontrados = [];
  for (const m of xml.matchAll(RE_PARRAFO)) encontrados.push({ i: m.index, tipo: "p", xml: m[0] });
  for (const m of xml.matchAll(RE_TABLA)) encontrados.push({ i: m.index, tipo: "tbl", xml: m[0] });
  // Los párrafos de dentro de una tabla también salen del primer barrido; se
  // descartan quedándose sólo con los que no caen dentro de ninguna tabla.
  const tablas = encontrados.filter((b) => b.tipo === "tbl").map((b) => [b.i, b.i + b.xml.length]);
  return encontrados
    .filter((b) => b.tipo === "tbl" || !tablas.some(([a, z]) => b.i > a && b.i < z))
    .sort((a, b) => a.i - b.i);
}

/**
 * Dónde está cada columna en la fila de encabezado.
 *
 * Devuelve null si la tabla no es una tabla de parámetros: es lo que separa
 * las tablas que interesan (una por etapa) de las decenas que un protocolo
 * tiene además —fórmula, equipos, muestreo, FMEA—.
 */
function columnasDe(filaXml) {
  const celdas = celdasDe(filaXml);
  const busca = (re) => celdas.find((c) => re.test(c.texto)) || null;
  const param = busca(CABECERA_PARAMETRO);
  const modo = busca(CABECERA_MODO);
  const rango = busca(CABECERA_RANGO);
  if (!param || !modo || !rango) return null;

  // El parámetro puede ocupar una columna o dos —el protocolo usa las dos
  // formas y el Formato 9 siempre dos—, así que su ancho se lee del propio
  // encabezado en vez de fijarlo.
  return {
    param: param.columna,
    anchoParam: param.ancho,
    modo: modo.columna,
    rango: rango.columna,
    total: anchoDeFila(celdas),
  };
}

/**
 * Las filas de una tabla de parámetros, ya clasificadas.
 *
 * Una fila con una sola celda que ocupa todo el ancho es un rótulo: o una
 * sección del cuadro ("Consideraciones generales", "Dispensación") o el
 * título de una operación ("Disolución manual (1) de hidróxido de potasio…").
 * Las dos se guardan igual, como banda, porque el protocolo no las distingue
 * y forzar la distinción sería inventarla.
 */
function filasDe(tablaXml, columnas) {
  const filas = [...tablaXml.matchAll(RE_FILA)].map((m) => m[0]);
  const salida = [];
  // Una celda combinada en vertical se escribe una vez y vale para las filas
  // de abajo; sin arrastrarla, esas filas saldrían sin nombre de grupo.
  let grupo = "";

  for (const filaXml of filas.slice(1)) {
    const celdas = celdasDe(filaXml);
    if (celdas.length === 0) continue;

    // Una sola celda que cubre la fila entera es un rótulo, no un parámetro.
    if (celdas.length === 1 && anchoDeFila(celdas) >= columnas.total) {
      const titulo = celdas[0].texto.trim();
      if (titulo) salida.push({ tipo: "banda", titulo });
      grupo = "";
      continue;
    }

    const celdaParam = enColumna(celdas, columnas.param);
    if (!celdaParam?.continuacion) grupo = celdaParam?.texto.trim() || "";

    // Con el parámetro partido en dos columnas, la segunda es el detalle
    // ("Peso de excipientes" / "Polietilenglicol 400", "N° Formato de
    // blíster" / "Moldeo").
    const celdaDetalle = columnas.anchoParam > 1 ? enColumna(celdas, columnas.param + 1) : null;
    const detalle = celdaDetalle && celdaDetalle !== celdaParam ? celdaDetalle.texto.trim() : "";
    const celdaModo = enColumna(celdas, columnas.modo);
    const modo = celdaModo?.continuacion ? "" : celdaModo?.texto.trim() || "";
    const rango = enColumna(celdas, columnas.rango)?.texto.trim() || "";

    if (!grupo && !detalle && !modo && !rango) continue;
    salida.push({ tipo: "parametro", grupo, detalle, modo, rango });
  }

  return salida;
}

/**
 * Lee un protocolo (o un Formato 9 en blanco) y devuelve sus etapas con la
 * secuencia de operaciones y los parámetros de cada una.
 *
 * Lo que no encuentre no lo inventa: un documento sin tablas de parámetros
 * devuelve una lista vacía, y quien llama debe decirlo así.
 */
export async function leerParametrosDeProtocolo(file) {
  const { xml, nombre } = await leerProtocolo(file);
  const etapas = [];
  let etapaPendiente = "";

  for (const bloque of bloques(xml)) {
    if (bloque.tipo === "p") {
      const m = textoDe(bloque.xml).match(RE_ETAPA);
      if (m) etapaPendiente = m[1].replace(/\s+/g, " ").trim();
      continue;
    }

    const filas = [...bloque.xml.matchAll(RE_FILA)].map((f) => f[0]);
    if (filas.length < 2) continue;
    const columnas = columnasDe(filas[0]);
    if (!columnas) continue;

    const contenido = filasDe(bloque.xml, columnas);
    if (contenido.length === 0) continue;

    // Una etapa puede traer más de una tabla (el protocolo la parte cuando
    // cruza de página); se acumulan en la misma entrada.
    const nombreEtapa = etapaPendiente || "SIN ETAPA";
    const existente = etapas.find((e) => e.etapa === nombreEtapa);
    if (existente) existente.filas.push(...contenido);
    else etapas.push({ etapa: nombreEtapa, filas: contenido });
  }

  return { nombre, etapas };
}

/** Cuántos parámetros trae el documento, para poder decirlo en pantalla. */
export function contarParametros(etapas) {
  return etapas.reduce((n, e) => n + e.filas.filter((f) => f.tipo === "parametro").length, 0);
}
