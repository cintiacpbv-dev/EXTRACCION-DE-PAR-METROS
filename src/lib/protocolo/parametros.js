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

// Un título de Word con nivel ("Título 1", "Heading 2"). Marca el final de
// una etapa: lo que venga detrás pertenece a otro apartado del documento.
// Sin esto, en el protocolo la última etapa se quedaba con todo lo que
// seguía —el análisis de riesgo entero, 118 filas de FMEA— como si fuera un
// anexo suyo. El estilo suelto "Ttulo" (sin número) no cuenta: el protocolo
// se lo pone también a las notas al pie de las tablas.
const ESTILO_TITULO = /w:pStyle w:val="(?:T[íi]?tulo|Heading)\s*\d/i;

/** Dos títulos nombran la misma etapa si uno es el nombre corto del otro. */
function mismaEtapa(a, b) {
  const n = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const [x, y] = [n(a), n(b)];
  return x === y || x.startsWith(y) || y.startsWith(x);
}

// El protocolo no titula las columnas siempre igual: la mayoría de las
// etapas escribe "Parámetro de Proceso … Rango de operación", pero Secado e
// Inspección escriben "Parámetros … Rango esperado". Con los títulos rígidos
// esas dos etapas desaparecían enteras del Formato 02 y en silencio, que es
// lo peor: un cuadro al que le falta una etapa y no lo dice.
//
// Aceptar las variantes no afloja el filtro, porque una tabla sólo cuenta
// como tabla de parámetros si trae las TRES columnas.
// La tabla de cabecera de cada etapa: sala, personal, condiciones
// ambientales, inicio y final. Interesa por los rangos que trae escritos
// —"Temperatura: (15 °C – 25 °C)"— que son la especificación de la sala y
// cambian de una etapa a otra (fabricación de una crema admite hasta 30 °C
// donde dispensación admite 25).
const CABECERA_SALA = /^\s*Sala\s*$/i;
const FILA_TEMPERATURA = /Temperatura\s*:?\s*\(?([^)]*)\)?/i;
const FILA_HUMEDAD = /Humedad\s*:?\s*\(?([^)]*)\)?/i;

// Dos tablas del final que no se copian porque se rehacen con datos: el
// resumen de fechas por etapa y el bloque de firmas.
const TABLA_RESUMEN_FECHAS = /Fecha\s+inicial/i;
const TABLA_FIRMAS = /^\s*(Realizado|Elaborado)\s+por\s*:/i;
// El recuadro de observaciones lo pone el propio Formato 02 detrás de cada
// cuadro, así que copiarlo además del origen lo duplicaba.
const TABLA_OBSERVACIONES = /^\s*Observaciones\s*:/i;

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
/** Los rangos de sala escritos en la tabla de cabecera de una etapa. */
function cabeceraFormatoDe(tablaXml) {
  const filas = [...tablaXml.matchAll(RE_FILA)].map((f) => f[0]);
  if (filas.length === 0) return null;
  const primera = celdasDe(filas[0]);
  if (!primera[0] || !CABECERA_SALA.test(primera[0].texto)) return null;

  const salida = {};
  for (const filaXml of filas) {
    for (const celda of celdasDe(filaXml)) {
      const t = celda.texto;
      const mt = t.match(FILA_TEMPERATURA);
      if (mt && !salida.temperaturaRango) salida.temperaturaRango = mt[1].trim();
      const mh = t.match(FILA_HUMEDAD);
      if (mh && !salida.humedadRango) salida.humedadRango = mh[1].trim();
    }
  }
  return salida;
}

/** Una tabla copiada tal cual: sus filas, con el texto y el ancho de cada celda. */
function tablaLiteral(tablaXml) {
  const filas = [];
  for (const filaXml of [...tablaXml.matchAll(RE_FILA)].map((f) => f[0])) {
    const celdas = celdasDe(filaXml);
    filas.push({ celdas: celdas.map((c) => ({ texto: c.texto, ancho: c.ancho })), total: anchoDeFila(celdas) });
  }
  return filas;
}

/**
 * Lee un protocolo (o un Formato 9 en blanco) y devuelve sus etapas con la
 * secuencia de operaciones y los parámetros de cada una.
 *
 * De cada etapa se guardan además dos cosas que el documento trae y que el
 * cuadro de parámetros no cubre:
 *
 *   - los rangos de sala de su cabecera ("Temperatura: (15 °C – 30 °C)"),
 *     que son la especificación contra la que se lee el termohigrómetro;
 *   - las tablas que van detrás del cuadro —"Observaciones:", el esquema de
 *     muestreo— copiadas tal cual. Se copian en vez de interpretarse porque
 *     cada producto tiene el suyo y una lectura "inteligente" del muestreo
 *     acabaría inventando ensayos.
 *
 * Lo que no encuentre no lo inventa: un documento sin tablas de parámetros
 * devuelve una lista vacía, y quien llama debe decirlo así.
 */
export async function leerParametrosDeProtocolo(file) {
  const { xml, nombre } = await leerProtocolo(file);
  const etapas = [];
  let etapaPendiente = "";
  let ultima = null;

  for (const bloque of bloques(xml)) {
    if (bloque.tipo === "p") {
      const texto = textoDe(bloque.xml);
      const m = texto.match(RE_ETAPA);
      // La etapa la nombra el último título que hay antes de su cuadro, diga
      // "Etapa de…" o no: el protocolo titula así "Tiempo de espera de la
      // fabricación al encapsulado", que es una etapa como las demás. Y un
      // título de otro apartado —el análisis de riesgo, pongamos— cierra la
      // que estuviera abierta, porque sus tablas no son anexos suyos.
      if (m || ESTILO_TITULO.test(bloque.xml)) {
        const nombre = (m ? m[1] : texto).replace(/\s+/g, " ").replace(/:$/, "").trim();
        // El documento vuelve a titular la misma etapa antes de su esquema de
        // muestreo, y a veces más corto ("Etapa de envase" después de "Etapa
        // de envase (Blisteado)") o en minúscula. Es la misma etapa, no una
        // nueva: si se abriera otra, el muestreo se perdería.
        const suya = nombre ? etapas.find((e) => mismaEtapa(e.etapa, nombre)) : null;
        etapaPendiente = suya ? suya.etapa : nombre;
        ultima = suya || null;
      }
      continue;
    }

    const filas = [...bloque.xml.matchAll(RE_FILA)].map((f) => f[0]);
    if (filas.length === 0) continue;

    const nombreEtapa = etapaPendiente || "SIN ETAPA";
    const entrada = () => {
      let e = etapas.find((x) => x.etapa === nombreEtapa);
      if (!e) {
        e = { etapa: nombreEtapa, filas: [], anexos: [], cabeceraFormato: {} };
        etapas.push(e);
      }
      return e;
    };

    const cabecera = cabeceraFormatoDe(bloque.xml);
    if (cabecera) {
      const e = entrada();
      e.cabeceraFormato = { ...e.cabeceraFormato, ...cabecera };
      ultima = e;
      continue;
    }

    const columnas = filas.length >= 2 ? columnasDe(filas[0]) : null;
    if (columnas) {
      const contenido = filasDe(bloque.xml, columnas);
      if (contenido.length > 0) {
        // Una etapa puede traer más de una tabla (el documento la parte
        // cuando cruza de página); se acumulan en la misma entrada.
        const e = entrada();
        e.filas.push(...contenido);
        ultima = e;
      }
      continue;
    }

    // Cualquier otra tabla que caiga detrás del cuadro de una etapa es un
    // anexo suyo, salvo las dos del final que se rehacen con datos.
    if (!ultima || ultima.filas.length === 0) continue;
    const texto = textoDe(bloque.xml);
    if (TABLA_RESUMEN_FECHAS.test(texto) || TABLA_FIRMAS.test(texto) || TABLA_OBSERVACIONES.test(texto)) continue;
    ultima.anexos.push(tablaLiteral(bloque.xml));
  }

  return { nombre, etapas };
}

/** Cuántos parámetros trae el documento, para poder decirlo en pantalla. */
export function contarParametros(etapas) {
  return etapas.reduce((n, e) => n + e.filas.filter((f) => f.tipo === "parametro").length, 0);
}
