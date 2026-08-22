import { norm } from "./utils.js";

// Campos de la columna derecha de la cabecera; nunca forman parte del nombre.
const ETIQUETAS_CABECERA =
  /^(Etapa|Fraccion|Emitido|P[aá]gina|Orden|Lote|Expira|Te[oó]rico|Inicio|Fin|C[oó]digo|Version)\b/i;

/**
 * Nombre del producto leído por geometría, no por el texto corrido.
 *
 * En la cabecera el nombre ocupa una celda combinada de la columna izquierda,
 * centrada en vertical frente a los campos de la derecha (Orden N°, Lote,
 * Expira, Teórico), que van todos alineados en la misma x. Buscar el nombre
 * "entre Lote: y Expira:" sobre el texto plano funciona sólo mientras quepa
 * en un renglón: en cuanto es más largo y el PDF lo parte en dos, una de las
 * mitades cae fuera de ese tramo y se pierde — "DOLORAL CB 400mg CAP BLANDA"
 * llegaba como "CB 400mg CAP BLANDA".
 *
 * Aquí se toma lo que hay en la columna izquierda entre el título del
 * documento y la fila de "Código", que es el nombre completo aunque venga
 * repartido en varios renglones.
 */
function extraerProductoPorGeometria(pages) {
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
 * Lee la cabecera de un Registro de Manufactura. No asume ningún producto ni
 * ninguna etapa concreta: toma los nombres tal como los declara el documento,
 * de modo que sirve igual para FABRICACION, ENVASE, ACONDICIONADO, INSPECCION
 * o cualquier otra etapa futura.
 */
export function extractMeta(flatTextRaw, pages) {
  const text = norm(flatTextRaw);

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

  // La receta es el código de producto de 10 dígitos del encabezado
  // ("6000003270"): siempre empieza en 6, igual que en la orden de
  // producción. Si por algún motivo no aparece suelto, se cae al de la línea
  // "Código  Version Fab. / Alt. … 5000000855  1001/ 1  5  Autorizado/…".
  const codigoMatch = text.match(/\b(6\d{9})\b/);
  const recetaMatch = codigoMatch || text.match(/(\d{10})\s+\d{3,4}\s*\/\s*\d+\s+\d+\s+Autorizado/i);

  const loteMatch = text.match(/Lote:\s*([\w-]+)/i);
  const ordenMatch = text.match(/Orden\s*N[ºo°]:\s*(\d+)/i);
  const expiraMatch = text.match(/Expira:\s*([\d-]{8,10})/i);
  const inicioMatch = text.match(/Inicio:\s*([\d-]{8,10}(?:\s+[\d:]{4,8})?)/i);
  const finMatch = text.match(/Fin:\s*([\d-]{8,10}(?:\s+[\d:]{4,8})?)/i);
  const teoricoMatch = text.match(/Te[oó]rico:\s*([\d\s.,]{2,18}?)\s*(kg|g|L|CJ|SAC|UND|MLL|ROL)?\s*(?:C[oó]digo|Fecha|$)/i);

  // Primero por geometría (lee el nombre completo aunque venga en dos
  // renglones); si la plantilla no encaja, se recurre al texto corrido.
  let producto = extraerProductoPorGeometria(pages);
  if (!producto && loteMatch) {
    const prodMatch = text.match(
      new RegExp("Lote:\\s*" + loteMatch[1] + "\\s+([A-Za-zÀ-ÿ0-9.,°%/x\\s-]{4,70}?)\\s+Expira:", "i")
    );
    if (prodMatch) producto = prodMatch[1].trim().replace(/\s{2,}/g, " ");
  }

  return {
    stage: stage || "SIN ETAPA",
    receta: recetaMatch ? recetaMatch[1] : null,
    lote: loteMatch ? loteMatch[1] : null,
    orden: ordenMatch ? ordenMatch[1] : null,
    producto: producto || "PRODUCTO SIN IDENTIFICAR",
    expira: expiraMatch ? expiraMatch[1] : null,
    inicio: inicioMatch ? inicioMatch[1] : null,
    fin: finMatch ? finMatch[1] : null,
    teorico: teoricoMatch ? teoricoMatch[1].trim() : null,
    teoricoUnidad: teoricoMatch && teoricoMatch[2] ? teoricoMatch[2] : null,
  };
}
