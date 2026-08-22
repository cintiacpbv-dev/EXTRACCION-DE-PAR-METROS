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

// Registros de antes de que existiera el lector dedicado de la sección
// INSUMOS (parsers/insumos.js) sólo llegaron a capturar, en el mejor de los
// casos, una fila suelta con esta forma: código + cantidad pegados en el
// valor. Se mantiene como último respaldo para no perder esos documentos
// mientras no se vuelvan a subir.
const INSUMO_RE = /^(\d{6,})\s+(.*)$/;

/**
 * Materiales e insumos usados en cada lote.
 *
 * La lista de materiales de cada lote y etapa sale del propio registro de
 * manufactura (sección INSUMOS, leída por parsers/insumos.js): es la que
 * nombra lo que de verdad se usó en esa etapa concreta (cajas, etiquetas y
 * folletos en Acondicionado; alupol, palupol y PVC en Envase; materias
 * primas y principios activos en Fabricación). La orden de producción del
 * mismo lote y etapa se cruza por código de material sólo para aportar el
 * lote de material ("Lote ME"), que el registro no trae. Si para un lote y
 * etapa el registro no aportó ningún material —porque no se cargó, o porque
 * el detector no encontró nada ahí— se usa la lista de la orden para no
 * dejar el cuadro vacío.
 */
export function materialesPorLote(documents, familia) {
  const filas = [];

  // Insumos declarados en la orden de cada lote y etapa, indexados por código
  // de material, para cruzarlos con la lista que trae el registro.
  const ordenPorLoteEtapa = new Map();
  for (const doc of documents) {
    if (doc.familia !== familia || !doc.orden) continue;
    const porCodigo = new Map();
    for (const ins of doc.orden.insumos) porCodigo.set(ins.codigo, ins);
    ordenPorLoteEtapa.set(`${doc.lote}::${doc.stage}`, porCodigo);
  }

  const registrosCubiertos = new Set();

  for (const doc of documents) {
    if (doc.familia !== familia || doc.kind === "orden") continue;

    const claveLoteEtapa = `${doc.lote}::${doc.stage}`;
    const enOrden = ordenPorLoteEtapa.get(claveLoteEtapa);

    if (doc.insumos?.length > 0) {
      for (const ins of doc.insumos) {
        registrosCubiertos.add(claveLoteEtapa);
        const insOrden = enOrden?.get(ins.codigo);
        filas.push({
          nombre: ins.descripcion,
          codigo: ins.codigo,
          loteMaterial: insOrden?.loteMaterial || "",
          proveedor: "",
          fabricante: "",
          fechaVencimiento: "",
          cantidad: insOrden
            ? `${insOrden.cantidadEntregada ?? ""} ${insOrden.unidad}`.trim()
            : `${ins.cantidadRecibida ?? ins.cantidad ?? ""} ${ins.unidadRecibida || ins.unidad || ""}`.trim(),
          consumo: insOrden?.consumo ?? null,
          merma: insOrden?.mermaProceso ?? null,
          lote: doc.lote,
          stage: doc.stage,
          producto: doc.producto,
        });
      }
      continue;
    }

    // Documento de antes del lector dedicado: se aprovecha lo poco que el
    // detector genérico haya podido capturar bajo la sección INSUMOS.
    for (const p of doc.params) {
      if (p.section !== "INSUMOS") continue;
      if (typeof p.value !== "string") continue;

      const m = p.value.match(INSUMO_RE);
      if (!m) continue; // firmas y verificaciones de la misma sección

      registrosCubiertos.add(claveLoteEtapa);
      const insOrden = enOrden?.get(m[1]);
      filas.push({
        nombre: p.label,
        codigo: m[1],
        loteMaterial: insOrden?.loteMaterial || "",
        proveedor: "",
        fabricante: "",
        fechaVencimiento: "",
        cantidad: insOrden ? `${insOrden.cantidadEntregada ?? ""} ${insOrden.unidad}`.trim() : m[2].trim(),
        consumo: insOrden?.consumo ?? null,
        merma: insOrden?.mermaProceso ?? null,
        lote: doc.lote,
        stage: doc.stage,
        producto: doc.producto,
      });
    }
  }

  // Lote y etapa donde el registro no aportó ningún material pero sí hay
  // orden: se usa su lista para no dejar el cuadro vacío.
  for (const doc of documents) {
    if (doc.familia !== familia || !doc.orden) continue;
    if (registrosCubiertos.has(`${doc.lote}::${doc.stage}`)) continue;

    for (const ins of doc.orden.insumos) {
      filas.push({
        nombre: ins.descripcion,
        codigo: ins.codigo,
        loteMaterial: ins.loteMaterial,
        proveedor: "",
        fabricante: "",
        fechaVencimiento: "",
        cantidad: `${ins.cantidadEntregada ?? ""} ${ins.unidad}`.trim(),
        consumo: ins.consumo,
        merma: ins.mermaProceso,
        lote: doc.lote,
        stage: doc.stage,
        producto: doc.producto,
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

/**
 * Personal lote por lote, que es como lo pide la tabla del informe: una
 * columna por lote y, dentro de cada etapa, una fila de operadores y otra de
 * supervisores. (aggregatePersonnel, en cambio, resume toda la etapa.)
 */
export function personalPorLote(documents, familia) {
  return listStages(documents, familia).map((stage) => {
    const docs = documents.filter((d) => d.familia === familia && d.stage === stage && d.kind !== "orden");
    const lotes = [...new Set(docs.map((d) => d.lote))].sort();

    const porLote = {};
    for (const lote of lotes) {
      const doc = docs.find((d) => d.lote === lote);
      porLote[lote] = {
        operarios: (doc?.personnel?.operarios || []).map((p) => p.name),
        supervisores: (doc?.personnel?.supervisores || []).map((p) => p.name),
      };
    }

    const producto = docs[0]?.producto || familia;
    return { stage, lotes, porLote, producto };
  });
}

/**
 * Receta (código de producto de 10 dígitos) declarada para cada lote. Sale
 * del propio encabezado del registro; la orden sólo se usa si para ese lote
 * no se cargó ningún registro.
 */
export function recetaPorLote(documents, familia) {
  const mapa = {};
  for (const doc of documents) {
    if (doc.familia !== familia) continue;
    const receta = doc.meta?.receta || doc.orden?.cabecera?.productoCodigo;
    if (receta && !mapa[doc.lote]) mapa[doc.lote] = receta;
  }
  return mapa;
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
 *
 * Con `stage` se restringe todo el modelo a una sola etapa: si de un
 * producto sólo se cargó Acondicionado, el informe no debe salir con
 * columnas vacías de Fabricación o Envase sólo porque otro lote de la
 * misma familia sí las tiene.
 */
export function buildRvpModel(documents, familia, { onlyCritical = true, stage = null } = {}) {
  const alcance = stage ? documents.filter((d) => d.familia !== familia || d.stage === stage) : documents;
  const stages = listStages(alcance, familia);

  return {
    familia,
    stages,
    lotes: lotesConFechas(alcance, familia),
    recetas: recetaPorLote(alcance, familia),
    materiales: materialesPorLote(alcance, familia),
    rendimiento: rendimientoPorLote(alcance, familia),
    personal: personalPorEtapa(alcance, familia),
    personalPorLote: personalPorLote(alcance, familia),
    tablas: stages.map((s) => buildTable(alcance, familia, s, { onlyCritical })),
  };
}
