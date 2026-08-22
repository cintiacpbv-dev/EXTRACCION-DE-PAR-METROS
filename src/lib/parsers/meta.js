import { norm } from "./utils.js";

// Campos de la columna derecha de la cabecera; nunca forman parte del nombre.
const ETIQUETAS_CABECERA =
  /^(Etapa|Fraccion|Emitido|P[aá]gina|Orden|Lote|Expira|Te[oó]rico|Inicio|Fin|C[oó]digo|Version)\b/i;

/**
 * Líneas de la cabecera de la primera página, hasta la fila del código de
 * producto incluida.
 *
 * Toda la cabecera se lee línea a línea, no sobre el texto corrido. Es la
 * diferencia entre leer bien y leer mal un registro maestro sin llenar: ahí
 * "Lote:", "Orden N°:" o "Inicio:" aparecen sin valor, y un patrón que
 * atraviesa saltos de línea se lleva lo primero que encuentra después —el
 * nombre del producto, o el código de la fila siguiente— y lo guarda como si
 * fuera el dato. Acotando la búsqueda a la propia línea, un campo vacío se
 * lee como vacío.
 */
function lineasCabecera(pages) {
  const lineas = pages?.[0]?.lines;
  if (!Array.isArray(lineas) || lineas.length === 0) return null;

  // Bajo la fila de "Código" todavía quedan "Inicio:" y "Fin:", intercalados
  // con la propia fila del código, así que la ventana llega hasta cinco
  // líneas más abajo.
  const iCodigo = lineas.findIndex((l) => /^C[oó]digo\b/i.test(norm(l.text).trim()));
  return iCodigo === -1 ? lineas.slice(0, 14) : lineas.slice(0, iCodigo + 5);
}

/** Valor que sigue a una etiqueta, dentro de su misma línea. */
function campoCabecera(lineas, etiqueta) {
  if (!lineas) return null;
  for (const linea of lineas) {
    const texto = norm(linea.text).trim();
    const m = texto.match(etiqueta);
    if (!m) continue;
    const valor = texto.slice(m.index + m[0].length).trim();
    return valor || null; // "" = campo presente pero sin rellenar
  }
  return null;
}

/**
 * Nombre del producto leído por geometría.
 *
 * En la cabecera el nombre ocupa una celda combinada de la columna izquierda,
 * centrada en vertical frente a los campos de la derecha (Orden N°, Lote,
 * Expira, Teórico), que van todos alineados en la misma x. Se toma lo que hay
 * en esa columna izquierda entre el título del documento y la fila de
 * "Código": así llega completo aunque el PDF lo reparta en varios renglones.
 */
function extraerProducto(pages) {
  const lineas = pages?.[0]?.lines;
  if (!Array.isArray(lineas) || lineas.length === 0) return null;

  // Las líneas vienen ordenadas de arriba abajo, así que el orden de lectura
  // de un nombre partido en dos se conserva.
  const iTitulo = lineas.findIndex((l) => /REGISTRO DE MANUFACTURA/i.test(l.text));
  const iCodigo = lineas.findIndex((l) => /^C[oó]digo\b/i.test(norm(l.text).trim()));
  if (iTitulo === -1 || iCodigo === -1 || iCodigo <= iTitulo) return null;

  // La x de la columna derecha se deduce del propio documento en vez de
  // fijarla, para que siga valiendo si cambia el ancho de la plantilla.
  const lineaLote = lineas.find((l) => /^Lote:/i.test(norm(l.text).trim()));
  if (!lineaLote || typeof lineaLote.x0 !== "number") return null;

  const partes = lineas
    .slice(iTitulo + 1, iCodigo)
    .filter((l) => typeof l.x0 === "number" && l.x0 < lineaLote.x0 - 10)
    .map((l) => norm(l.text).trim())
    .filter((t) => t && !ETIQUETAS_CABECERA.test(t));

  const nombre = partes.join(" ").replace(/\s{2,}/g, " ").trim();
  return nombre.length >= 4 ? nombre : null;
}

/**
 * Receta: el código de producto de diez dígitos de la cabecera. Es la primera
 * celda de la fila que va bajo el rótulo "Código", así que se lee por
 * posición y no por su valor: el código no siempre empieza por la misma
 * cifra (6000000118 en acondicionado, 5000003307 en fabricación) y el estado
 * de la misma fila puede ser "Autorizado" o "Ingresado".
 */
function extraerReceta(pages, textoPlano) {
  const lineas = pages?.[0]?.lines;
  if (Array.isArray(lineas)) {
    const iCodigo = lineas.findIndex((l) => /^C[oó]digo\b/i.test(norm(l.text).trim()));
    if (iCodigo !== -1) {
      for (const linea of lineas.slice(iCodigo + 1, iCodigo + 4)) {
        const m = norm(linea.text).trim().match(/^(\d{10})\b/);
        if (m) return m[1];
      }
    }
  }

  const respaldo = textoPlano.match(/(\d{10})\s+\d{3,4}\s*\/\s*\d+\s+\d+\s+(?:Autorizado|Ingresado)/i);
  return respaldo ? respaldo[1] : null;
}

/** Un lote real es un código alfanumérico corto, no una palabra suelta. */
function limpiarLote(valor) {
  if (!valor) return null;
  const m = valor.match(/^([A-Z]?\d[\w-]*)/i);
  return m ? m[1] : null;
}

/**
 * Lee la cabecera de un Registro de Manufactura. No asume ningún producto ni
 * ninguna etapa concreta: toma los nombres tal como los declara el documento,
 * de modo que sirve igual para FABRICACION, ENVASE, ACONDICIONADO, INSPECCION
 * o cualquier otra etapa futura.
 */
export function extractMeta(flatTextRaw, pages) {
  const text = norm(flatTextRaw);
  const cabecera = lineasCabecera(pages);

  // "Fecha de ENVASE  Inicio: ..." es el indicador más fiable de la etapa.
  let stage = null;
  const byFecha = text.match(/Fecha de\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{2,28}?)\s+(?:Inicio|Fin):/);
  if (byFecha) {
    stage = byFecha[1].trim();
  } else {
    const byTitle = text.match(/REGISTRO DE MANUFACTURA\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{2,28}?)\s+(?:Página|Etapa)/);
    if (byTitle) stage = byTitle[1].trim();
  }
  if (stage) stage = stage.replace(/\s+/g, " ").toUpperCase();

  // Cada campo se busca primero en su propia línea de la cabecera; sólo si el
  // documento no aporta geometría se recurre al texto corrido.
  const porLinea = (etiqueta, respaldo) => {
    const valor = campoCabecera(cabecera, etiqueta);
    if (valor !== null) return valor;
    if (!cabecera && respaldo) {
      const m = text.match(respaldo);
      return m ? m[1].trim() : null;
    }
    return null;
  };

  const lote = limpiarLote(porLinea(/Lote:\s*/i, /Lote:\s*([\w-]+)/i));
  const orden = porLinea(/Orden\s*N[ºo°]:\s*/i, /Orden\s*N[ºo°]:\s*(\d+)/i);
  const expira = porLinea(/Expira:\s*/i, /Expira:\s*([\d-]{8,10})/i);
  const inicio = porLinea(/Inicio:\s*/i, /Inicio:\s*([\d-]{8,10}(?:\s+[\d:]{4,8})?)/i);
  const fin = porLinea(/Fin:\s*/i, /Fin:\s*([\d-]{8,10}(?:\s+[\d:]{4,8})?)/i);
  const teoricoBruto = porLinea(/Te[oó]rico:\s*/i, /Te[oó]rico:\s*([\d\s.,]{2,18}?)\s*(?:kg|g|L|CJ|SAC|UND|MLL|ROL)?/i);

  const teoricoMatch = teoricoBruto ? teoricoBruto.match(/^([\d.,]+)\s*([A-Za-z]{1,4})?/) : null;

  const producto = extraerProducto(pages);

  return {
    stage: stage || "SIN ETAPA",
    receta: extraerReceta(pages, text),
    lote,
    orden: orden && /^\d+$/.test(orden) ? orden : null,
    producto: producto || "PRODUCTO SIN IDENTIFICAR",
    expira: expira && /^[\d-]{8,10}$/.test(expira) ? expira : null,
    inicio: inicio && /^[\d-]{8,10}/.test(inicio) ? inicio : null,
    fin: fin && /^[\d-]{8,10}/.test(fin) ? fin : null,
    teorico: teoricoMatch ? teoricoMatch[1] : null,
    teoricoUnidad: teoricoMatch && teoricoMatch[2] ? teoricoMatch[2] : null,
  };
}
