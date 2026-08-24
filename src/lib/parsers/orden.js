// Lector de Órdenes de Producción.
//
// La orden es un reporte tabular de SAP, con una estructura distinta a la del
// registro de manufactura: no tiene el patrón "etiqueta + relleno + valor" que
// usa el detector genérico, sino columnas reales. De aquí salen los datos que
// el registro no trae — sobre todo el lote de cada material (el "Lote ME" del
// informe de validación), el rendimiento oficial y las fechas exactas.

import { norm } from "./utils.js";

/** ¿Este documento es una orden de producción y no un registro de manufactura? */
export function esOrdenDeProduccion(flatText) {
  const t = norm(flatText);
  return /Tipo de orden:/i.test(t) && /N[°º] de Orden:/i.test(t);
}

function match1(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function num(valor) {
  if (valor === null || valor === undefined) return null;
  const n = parseFloat(String(valor).replace(/\s+/g, "").replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

/**
 * Producto y cifras de rendimiento, leídos por posición.
 *
 * Van en la línea que sigue al rótulo "Código Producto Versión". Se busca
 * ahí y no por el valor del código, porque el código no siempre empieza por
 * la misma cifra: 6000000118 en acondicionado, pero 5000000855 en
 * fabricación y 5000000865 en envase. Dar por hecho el 6 dejaba a esas dos
 * etapas sin nombre de producto ni rendimiento.
 */
function extraerProducto(pages) {
  const lineas = pages?.[0]?.lines;
  if (!Array.isArray(lineas)) return null;

  const i = lineas.findIndex((l) => /^C[oó]digo\s+Producto\b/i.test(norm(l.text).trim()));
  if (i === -1) return null;

  for (const linea of lineas.slice(i + 1, i + 4)) {
    const m = norm(linea.text).trim().match(/^(\d{10})\s+(.+)$/);
    if (!m) continue;

    // La cola de la línea son las cifras de rendimiento; el resto es el
    // nombre. En una orden sin llenar esas cifras no están, y el nombre
    // igualmente se recupera.
    const cifras = m[2].match(/(-?[\d.,]+)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s*%\s*$/);
    const nombre = m[2].replace(/(\s+-?[\d.,]+){1,4}\s*%?\s*$/, "").replace(/\s{2,}/g, " ").trim();

    return {
      codigo: m[1],
      nombre: nombre || null,
      entregado: cifras ? num(cifras[1]) : null,
      controlCalidad: cifras ? num(cifras[2]) : null,
      obtenido: cifras ? num(cifras[3]) : null,
      rendimiento: cifras ? num(cifras[4]) : null,
    };
  }

  return null;
}

/** Cabecera: producto, lote, etapa, orden, fechas y rendimiento declarado. */
function extraerCabecera(flatText, pages) {
  const t = norm(flatText);

  const prodPos = extraerProducto(pages);
  // Respaldo sobre el texto corrido por si la plantilla no encaja.
  const m = t.match(/\b(\d{10})\s+(.+?)\s+(-?\d[\d.,]*)\s+(-?\d[\d.,]*)\s+(-?\d[\d.,]*)\s+(-?\d[\d.,]*)\s*%/);
  const prod =
    prodPos ||
    (m
      ? {
          codigo: m[1],
          nombre: m[2].replace(/\s{2,}/g, " ").trim(),
          entregado: num(m[3]),
          controlCalidad: num(m[4]),
          obtenido: num(m[5]),
          rendimiento: num(m[6]),
        }
      : null);

  return {
    tipoOrden: match1(t, /Tipo de orden:\s*(\S+)/i),
    centro: match1(t, /Centro:\s*(\d+)/i),
    orden: match1(t, /N[°º] de Orden:\s*(\d+)/i),
    emision: match1(t, /Fecha de Emisi[oó]n:\s*([\d-]{8,10})/i),
    seccion: match1(t, /Secci[oó]n:\s*([A-ZÁÉÍÓÚÑ ]+?)\s+(?:Etapa|P[aá]gina)/i),
    stage: (match1(t, /Etapa:\s*([A-ZÁÉÍÓÚÑ ]+?)\s+(?:P[aá]gina|Descripci)/i) || "").trim() || null,
    lote: match1(t, /\bLote:\s*(\w+)/i),
    variante: match1(t, /Variante:\s*(\d+)/i),
    version: match1(t, /Versi[oó]n:\s*(\d+)/i),
    expira: match1(t, /Expira:\s*([\d-]{8,10})/i),
    inicio: match1(t, /Fecha inicio:\s*([\d-]{8,10}(?:\s+[\d:]{4,8})?)/i),
    fin: match1(t, /Fecha final:\s*([\d-]{8,10}(?:\s+[\d:]{4,8})?)/i),
    teorico: match1(t, /Te[oó]rico:\s*([\d.,]+)\s*\w*/i),
    teoricoUnidad: match1(t, /Te[oó]rico:\s*[\d.,]+\s*([A-Z]{2,4})/i),
    productoCodigo: prod?.codigo ?? null,
    producto: prod?.nombre ?? null,
    entregado: prod?.entregado ?? null,
    controlCalidad: prod?.controlCalidad ?? null,
    obtenido: prod?.obtenido ?? null,
    rendimiento: prod?.rendimiento ?? null,
  };
}

// Una fila de insumo empieza con el código de material (10 dígitos) y termina
// con la cadena de cifras de cantidades. En medio va la descripción, que puede
// partirse en dos renglones, y los códigos de grupo y almacén.
const FILA_INSUMO_RE = new RegExp(
  [
    /^(\d{10})\s+/, // código del insumo
    /(.+?)\s+/, // descripción
    /(Z[A-Z]{3}\d{5})\s+/, // grupo de artículo
    /(P\d{3})\s+/, // almacén de piso
    /([\d.,]+)\s*/, // cantidad requerida
    // Unidad de medida. Admite una sola letra: los gramos ("1356.000 g") y
    // los litros ("20 L") se escriben así, y exigir dos caracteres descartaba
    // la fila entera, con lo que ese material se quedaba sin su Lote ME.
    /([A-Z]{1,4})\s*/, // unidad de medida
    /(\d{6,})\s+/, // lote del material (Lote ME)
    /([\d.,]+)\s+/, // potencia %
    /([\d.,]+)\s+/, // cantidad entregada
    /([\d.,]+)\s+/, // adicional
    /([\d.,]+)\s+/, // devolución
    /([\d.,]+)\s+/, // consumo
    /([\d.,]+)\s+/, // merma proceso
    /([\d.,]+)\s+/, // archivo cc
    /([\d.,]+)\s*$/, // merma inspección
  ]
    .map((r) => r.source)
    .join(""),
  "i"
);

/**
 * Insumos con su lote de material. El PDF corta la descripción larga en dos
 * renglones, así que la línea se reconstruye uniendo la continuación antes de
 * intentar el calce.
 */
function extraerInsumos(pages) {
  const filas = [];

  for (const page of pages) {
    const lineas = page.lines.map((l) => l.text);

    for (let i = 0; i < lineas.length; i++) {
      if (!/^\d{10}\s/.test(lineas[i])) continue;

      // El resto de la descripción baja al renglón siguiente (p.ej. "LTM",
      // "EXP") cuando no cabe; se reincorpora antes de leer las columnas.
      // Sólo se acepta como continuación un fragmento de letras: el PDF
      // también parte cifras largas ("64081.000" deja un "0" suelto), y ese
      // dígito no pertenece a la descripción.
      let linea = lineas[i];
      const sig = (lineas[i + 1] || "").trim();
      if (/^[A-ZÁÉÍÓÚÑ]{2,6}$/.test(sig)) {
        linea = linea.replace(/\s+(Z[A-Z]{3}\d{5})/, ` ${sig} $1`);
        i++;
      }

      const m = norm(linea).match(FILA_INSUMO_RE);
      if (!m) continue;

      filas.push({
        codigo: m[1],
        descripcion: m[2].replace(/\s{2,}/g, " ").trim(),
        grupoArticulo: m[3],
        almacen: m[4],
        cantidadRequerida: num(m[5]),
        unidad: m[6].toUpperCase(),
        loteMaterial: m[7],
        potencia: num(m[8]),
        cantidadEntregada: num(m[9]),
        adicional: num(m[10]),
        devolucion: num(m[11]),
        consumo: num(m[12]),
        mermaProceso: num(m[13]),
        archivoCc: num(m[14]),
        mermaInspeccion: num(m[15]),
      });
    }
  }

  return filas;
}

/** Firmas de almacén y producción que la orden registra aparte del registro. */
function extraerFirmas(flatText) {
  const t = norm(flatText);
  const persona = (etiqueta) => {
    const m = t.match(new RegExp(etiqueta + "\\s*/?\\s*Fecha:\\s*([A-ZÁÉÍÓÚÑ,\\s]+?)\\s*/\\s*([\\d-]{8,10}\\s+[\\d:]{4,8})", "i"));
    if (!m) return null;
    return {
      nombres: m[1].split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean),
      fecha: m[2],
    };
  };

  return {
    dispensadoPor: persona("Dispensado por"),
    recibidoPor: persona("Recibido por"),
    supervisadoPor: persona("Supervisado por"),
    verificadoPor: persona("Verificado por"),
  };
}

/** Entregas y muestreos de control de calidad de la última página. */
function extraerEntregas(pages) {
  const entregas = [];
  const muestras = [];

  for (const page of pages) {
    for (const linea of page.lines) {
      // "2026-04-23 3201.000    2026-04-23 2.500 0003 Muestras por Contramuestras"
      const m = norm(linea.text).match(
        /^([\d-]{10})\s+([\d.,]+)\s+(?:([\d-]{10})\s+([\d.,]+)\s+(.+))?$/
      );
      if (!m) continue;

      entregas.push({ fecha: m[1], cantidad: num(m[2]) });
      if (m[3]) muestras.push({ fecha: m[3], cantidad: num(m[4]), motivo: m[5].trim() });
    }
  }

  return { entregas, muestras };
}

/**
 * Procesa una orden de producción completa.
 * Devuelve la misma forma de "documento" que usa el resto de la app, marcado
 * con kind: "orden" para distinguirlo del registro de manufactura.
 */
export function parseOrden(pages, flatText) {
  const cabecera = extraerCabecera(flatText, pages);
  const insumos = extraerInsumos(pages);
  const firmas = extraerFirmas(flatText);
  const { entregas, muestras } = extraerEntregas(pages);

  return { cabecera, insumos, firmas, entregas, muestras };
}
