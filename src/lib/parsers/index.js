import { extractPdfText } from "../pdfText.js";
import { extractMeta } from "./meta.js";
import { detectParameters } from "./genericParser.js";
import { detectPersonnel } from "./personnel.js";
import { detectInsumos } from "./insumos.js";
import { detectEquipos } from "./equipos.js";
import { conOpciones } from "./opcionesParams.js";
import { conAmbientales } from "./ambientales.js";
import { conTiempos } from "./tiempos.js";
import { esOrdenDeProduccion, parseOrden } from "./orden.js";

/**
 * Procesa un PDF de cualquiera de los dos tipos de documento que maneja la app:
 *
 *  - Registro de Manufactura: de aquí salen los parámetros de proceso y el
 *    personal que ejecutó y supervisó cada paso.
 *  - Orden de Producción: de aquí salen los datos que el registro no trae —
 *    el lote de cada material, el rendimiento oficial y las fechas exactas.
 *
 * El tipo se detecta por el contenido, así que se pueden arrastrar mezclados
 * sin tener que separarlos a mano.
 */
export async function processPdfFile(file) {
  const { pages, flatText, numPages } = await extractPdfText(file);

  if (esOrdenDeProduccion(flatText)) {
    const orden = parseOrden(pages, flatText);
    const { cabecera } = orden;

    if (!cabecera.lote) {
      throw new Error(`No se pudo leer el lote de la orden "${file.name}".`);
    }

    return {
      kind: "orden",
      stage: cabecera.stage || "SIN ETAPA",
      meta: {
        producto: cabecera.producto || "PRODUCTO SIN IDENTIFICAR",
        lote: cabecera.lote,
        stage: cabecera.stage,
        orden: cabecera.orden,
        inicio: cabecera.inicio,
        fin: cabecera.fin,
        expira: cabecera.expira,
        teorico: cabecera.teorico,
        teoricoUnidad: cabecera.teoricoUnidad,
      },
      orden,
      params: [],
      personnel: { operarios: [], supervisores: [] },
      fileName: file.name,
      numPages,
      parsedAt: new Date().toISOString(),
    };
  }

  const meta = extractMeta(flatText, pages);
  const params = conAmbientales(conOpciones(conTiempos(detectParameters(pages)), pages));
  const personnel = detectPersonnel(pages);
  const insumos = detectInsumos(pages);
  const equipos = detectEquipos(pages);

  if (params.length === 0) {
    throw new Error(
      `No se detectó ningún parámetro en "${file.name}". Verifica que el PDF contenga texto seleccionable (no una imagen escaneada).`
    );
  }

  return {
    kind: "registro",
    stage: meta.stage,
    meta,
    params,
    personnel,
    insumos,
    equipos,
    fileName: file.name,
    numPages,
    parsedAt: new Date().toISOString(),
  };
}
