import { norm } from "./utils.js";

/**
 * Lee la cabecera de un Registro de Manufactura. No asume ningún producto ni
 * ninguna etapa concreta: toma los nombres tal como los declara el documento,
 * de modo que sirve igual para FABRICACION, ENVASE, ACONDICIONADO, INSPECCION
 * o cualquier otra etapa futura.
 */
export function extractMeta(flatTextRaw) {
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

  // "Código  Version Fab. / Alt. … 5000000855  1001/ 1  5  Autorizado/…"
  // Es la receta del producto, que el informe de validación pide en su tabla
  // de lotes controlados.
  const recetaMatch = text.match(/(\d{10})\s+\d{3,4}\s*\/\s*\d+\s+\d+\s+Autorizado/i);

  const loteMatch = text.match(/Lote:\s*([\w-]+)/i);
  const ordenMatch = text.match(/Orden\s*N[ºo°]:\s*(\d+)/i);
  const expiraMatch = text.match(/Expira:\s*([\d-]{8,10})/i);
  const inicioMatch = text.match(/Inicio:\s*([\d-]{8,10}(?:\s+[\d:]{4,8})?)/i);
  const finMatch = text.match(/Fin:\s*([\d-]{8,10}(?:\s+[\d:]{4,8})?)/i);
  const teoricoMatch = text.match(/Te[oó]rico:\s*([\d\s.,]{2,18}?)\s*(kg|g|L|CJ|SAC|UND|MLL|ROL)?\s*(?:C[oó]digo|Fecha|$)/i);

  let producto = null;
  if (loteMatch) {
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
