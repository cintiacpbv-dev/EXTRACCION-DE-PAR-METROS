// Prepara los datos que necesita el informe de validación (RVP) a partir de
// lo que la app ya extrajo de los registros de manufactura.
//
// El registro no trae los datos en forma de tabla de informe: hay que
// rescatar las fechas de proceso de entre los campos de trazabilidad, y los
// materiales de la sección de insumos.

import { aggregatePersonnel, buildTable, listStages } from "./model.js";

const FECHA_RE = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/;

function soloFecha(valor) {
  const m = String(valor || "").match(FECHA_RE);
  return m ? m[1] : "";
}

/**
 * Fechas de inicio y término de una etapa en un lote.
 *
 * La orden de producción las declara de forma explícita, así que cuando está
 * disponible manda ella. Del registro hay que deducirlas: se prefieren los
 * campos que nombran la etapa ("FECHA / HORA INICIO DE ACONDICIONADO"),
 * porque también trae fechas de pasos sueltos (documentación, set up) que no
 * delimitan el proceso; si no existen, se usa la primera y la última vistas.
 */
export function fechasDeProceso(doc) {
  if (doc.orden?.cabecera) {
    const { inicio, fin } = doc.orden.cabecera;
    if (inicio || fin) return { inicio: soloFecha(inicio), fin: soloFecha(fin) };
  }

  const conFecha = doc.params.filter((p) => typeof p.value === "string" && FECHA_RE.test(p.value));

  const buscar = (re) => {
    const p = conFecha.find((x) => re.test(x.label));
    return p ? soloFecha(p.value) : "";
  };

  let inicio = buscar(/FECHA\s*\/\s*HORA\s+INICIO\s+DE(L)?\s+\w/i);
  let fin = buscar(/FECHA\s*\/\s*HORA\s+FINAL\s+DE(L)?\s+\w/i);

  if (!inicio || !fin) {
    const todas = conFecha.map((p) => soloFecha(p.value)).filter(Boolean).sort();
    if (!inicio) inicio = todas[0] || "";
    if (!fin) fin = todas[todas.length - 1] || "";
  }

  return { inicio, fin };
}

/** Un renglón por lote con sus fechas en cada etapa (tabla de lotes del RVP). */
export function lotesConFechas(documents, familia) {
  const stages = listStages(documents, familia);
  const porLote = new Map();

  // Las órdenes se procesan al final para que sus fechas —declaradas de forma
  // explícita— pisen a las deducidas del registro.
  const ordenados = [...documents].sort((a, b) => (a.orden ? 1 : 0) - (b.orden ? 1 : 0));

  for (const doc of ordenados) {
    if (doc.familia !== familia) continue;
    if (!porLote.has(doc.lote)) porLote.set(doc.lote, { lote: doc.lote, producto: doc.producto, etapas: {} });

    const fila = porLote.get(doc.lote);
    fila.etapas[doc.stage] = fechasDeProceso(doc);
    if (doc.orden?.cabecera?.producto) fila.producto = doc.orden.cabecera.producto;
  }

  return {
    stages,
    filas: [...porLote.values()].sort((a, b) => a.lote.localeCompare(b.lote)),
  };
}

// En la sección de insumos del registro, el valor concentra código, cantidad
// ordenada y cantidad recibida: "1000000510 41.380 KGP 41.714 kg 2".
const INSUMO_RE = /^(\d{6,})\s+(.*)$/;

/**
 * Materiales e insumos usados en cada lote.
 *
 * La orden de producción es la fuente buena: declara el lote de cada material
 * ("Lote ME"), que el registro de manufactura no trae. Cuando para un lote hay
 * orden se usa ésa; si sólo hay registro, se cae a lo que él declare, con el
 * lote de material en blanco para completarlo a mano.
 */
export function materialesPorLote(documents, familia) {
  const filas = [];
  const lotesConOrden = new Set(
    documents.filter((d) => d.familia === familia && d.orden).map((d) => `${d.lote}::${d.stage}`)
  );

  for (const doc of documents) {
    if (doc.familia !== familia) continue;

    if (doc.orden) {
      for (const ins of doc.orden.insumos) {
        filas.push({
          nombre: ins.descripcion,
          codigo: ins.codigo,
          loteMaterial: ins.loteMaterial,
          cantidad: `${ins.cantidadEntregada ?? ""} ${ins.unidad}`.trim(),
          consumo: ins.consumo,
          merma: ins.mermaProceso,
          lote: doc.lote,
          stage: doc.stage,
        });
      }
      continue;
    }

    // Sin orden para este lote y etapa: se aprovecha lo del registro.
    if (lotesConOrden.has(`${doc.lote}::${doc.stage}`)) continue;

    for (const p of doc.params) {
      if (p.section !== "INSUMOS") continue;
      if (typeof p.value !== "string") continue;

      const m = p.value.match(INSUMO_RE);
      if (!m) continue; // firmas y verificaciones de la misma sección

      filas.push({
        nombre: p.label,
        codigo: m[1],
        loteMaterial: "",
        cantidad: m[2].trim(),
        consumo: null,
        merma: null,
        lote: doc.lote,
        stage: doc.stage,
      });
    }
  }

  return filas.sort(
    (a, b) => a.nombre.localeCompare(b.nombre) || a.lote.localeCompare(b.lote)
  );
}

/** Rendimiento oficial declarado en la orden, por lote y etapa. */
export function rendimientoPorLote(documents, familia) {
  return documents
    .filter((d) => d.familia === familia && d.orden?.cabecera?.rendimiento !== null && d.orden)
    .map((d) => ({
      lote: d.lote,
      stage: d.stage,
      orden: d.orden.cabecera.orden,
      teorico: d.orden.cabecera.teorico,
      unidad: d.orden.cabecera.teoricoUnidad,
      entregado: d.orden.cabecera.entregado,
      controlCalidad: d.orden.cabecera.controlCalidad,
      obtenido: d.orden.cabecera.obtenido,
      rendimiento: d.orden.cabecera.rendimiento,
    }))
    .sort((a, b) => a.lote.localeCompare(b.lote));
}

/** Personal por etapa, en el formato de las tablas de personal del RVP. */
export function personalPorEtapa(documents, familia) {
  return listStages(documents, familia).map((stage) => ({
    stage,
    lotes: [...new Set(documents.filter((d) => d.familia === familia && d.stage === stage).map((d) => d.lote))].sort(),
    ...aggregatePersonnel(documents, familia, stage),
  }));
}

/**
 * Todo lo que necesita el informe, ya resuelto: encabezados, tablas de
 * parámetros por etapa, personal, materiales y fechas.
 */
export function buildRvpModel(documents, familia, { onlyCritical = true } = {}) {
  const stages = listStages(documents, familia);

  return {
    familia,
    stages,
    lotes: lotesConFechas(documents, familia),
    materiales: materialesPorLote(documents, familia),
    rendimiento: rendimientoPorLote(documents, familia),
    personal: personalPorEtapa(documents, familia),
    tablas: stages.map((stage) => buildTable(documents, familia, stage, { onlyCritical })),
  };
}
