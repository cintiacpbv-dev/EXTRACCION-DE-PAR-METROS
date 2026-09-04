// Prepara los datos que necesita el informe de validación (RVP) a partir de
// lo que la app ya extrajo de los registros de manufactura.
//
// El registro no trae los datos en forma de tabla de informe: hay que
// rescatar las fechas de proceso de entre los campos de trazabilidad, y los
// materiales de la sección de insumos.

import { aggregatePersonnel, buildTable, claveLote, listStages } from "./model.js";
import { SECCION_SIN_TIEMPO_RE } from "./parsers/tiempos.js";

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
 *
 * Los pasos sueltos se descartan por su sección, no sólo por cómo se
 * nombran: en Fabricación el "set up" del tableteado trae sus propias
 * fechas con nombre propio ("FECHA / HORA INICIO DE LA COMPRESIÓN"), que de
 * otro modo pasarían por el nombre de la etapa y correrían la fecha real de
 * fabricación varios días.
 */
export function fechasDeProceso(doc) {
  if (doc.orden?.cabecera) {
    const { inicio, fin } = doc.orden.cabecera;
    if (inicio || fin) return { inicio: soloFecha(inicio), fin: soloFecha(fin) };
  }

  const conFecha = doc.params.filter(
    (p) =>
      typeof p.value === "string" &&
      FECHA_RE.test(p.value) &&
      !SECCION_SIN_TIEMPO_RE.test(p.section || "")
  );

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

// La primera operación de acondicionado imprime el número de lote y la fecha
// de expira en las cajas: es el "lotizado". El informe lo lista como una
// columna aparte de la del acondicionado porque son trabajos distintos y a
// menudo con días de por medio — en el lote 2018806 las cajas se imprimieron
// el 3 de febrero y el acondicionado terminó el 10.
const OPERACION_LOTIZADO_RE = /IMPRESI[OÓ]N\s+DE\s+CAJAS/i;
export const ETAPA_LOTIZADO = "LOTIZADO";

// La segunda operación es el acondicionado propiamente dicho. Sus fechas son
// las que van en la columna de acondicionado del cuadro; las del documento
// entero abarcan también el lotizado, y entonces las dos columnas dirían lo
// mismo.
const OPERACION_ACONDICIONADO_RE = /OPERACI[OÓ]N\s*N\s*[°ºo.]*\s*2|INCREMENTO\s+DE\s+CAPACIDAD|CAMBIO\s+DE\s+TURNO/i;

/**
 * Fechas de inicio y fin de una operación concreta dentro de una etapa.
 *
 * Salen de las horas que el lector de tiempos (parsers/tiempos.js) empareja
 * en cada sección: "HORA INICIO" con la "HORA FINAL" que le sigue.
 */
export function fechasDeOperacion(doc, re) {
  const dentro = (p) => re.test(p.section || "");
  const buscar = (etiqueta) => {
    const p = doc.params.find((x) => dentro(x) && x.label === etiqueta);
    return p ? soloFecha(p.value) : "";
  };

  const inicio = buscar("HORA INICIO");
  const fin = buscar("HORA FINAL");
  return inicio || fin ? { inicio, fin } : null;
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
    const clave = claveLote(doc);
    if (!porLote.has(clave)) porLote.set(clave, { clave, lote: doc.lote, producto: doc.producto, etapas: {} });

    const fila = porLote.get(clave);
    const deOperacion = doc.params ? fechasDeOperacion(doc, OPERACION_ACONDICIONADO_RE) : null;

    // En acondicionado la columna de la etapa son las fechas de la operación
    // de acondicionar. Sólo si el registro no las separa se usan las del
    // documento entero, que es lo que se venía mostrando.
    fila.etapas[doc.stage] =
      doc.stage === "ACONDICIONADO" && deOperacion ? deOperacion : fechasDeProceso(doc);

    const lotizado = doc.params ? fechasDeOperacion(doc, OPERACION_LOTIZADO_RE) : null;
    if (lotizado) fila.etapas[ETAPA_LOTIZADO] = lotizado;

    if (doc.orden?.cabecera?.producto) fila.producto = doc.orden.cabecera.producto;
  }

  // El acondicionado va siempre con sus dos pares de fechas: el lotizado
  // primero —codificar las cajas es un trabajo aparte, a veces de otro día— y
  // el acondicionado después. El lote en el que no conste el lotizado deja sus
  // dos casillas en blanco, que es lo que dice el registro.
  const columnas = [];
  for (const s of stages) {
    if (s === "ACONDICIONADO") columnas.push(ETAPA_LOTIZADO);
    columnas.push(s);
  }

  return {
    stages: columnas,
    filas: [...porLote.values()].sort((a, b) => a.clave.localeCompare(b.clave)),
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
  //
  // Un mismo código puede tener más de una entrada: el material se recibió
  // de dos lotes del proveedor distintos y ambos se consumieron en el mismo
  // lote de producción (ejemplo real: dióxido de titanio, un lote de un
  // proveedor y el resto de otro). Guardar sólo la última pisaba a la
  // primera sin dejar rastro — el material se veía en el cuadro con un solo
  // lote, como si el otro no se hubiera usado.
  const ordenPorLoteEtapa = new Map();
  for (const doc of documents) {
    if (doc.familia !== familia || !doc.orden) continue;
    const porCodigo = new Map();
    for (const ins of doc.orden.insumos) {
      if (!porCodigo.has(ins.codigo)) porCodigo.set(ins.codigo, []);
      porCodigo.get(ins.codigo).push(ins);
    }
    ordenPorLoteEtapa.set(`${claveLote(doc)}::${doc.stage}`, porCodigo);
  }

  const registrosCubiertos = new Set();

  // Una entrada por cada lote de material que aportó a este insumo —normalmente
  // una sola, pero puede haber dos o más—; si la orden no dice nada de este
  // código, la fila de siempre con lo que trae el registro.
  const filasDeInsumo = (base, codigo, entradasOrden) => {
    if (entradasOrden?.length > 0) {
      return entradasOrden.map((insOrden) => ({
        ...base,
        codigo,
        loteMaterial: insOrden.loteMaterial || "",
        cantidad: `${insOrden.cantidadEntregada ?? ""} ${insOrden.unidad}`.trim(),
        consumo: insOrden.consumo ?? null,
        merma: insOrden.mermaProceso ?? null,
      }));
    }
    return [{ ...base, codigo, loteMaterial: "" }];
  };

  for (const doc of documents) {
    if (doc.familia !== familia || doc.kind === "orden") continue;

    const claveLoteEtapa = `${claveLote(doc)}::${doc.stage}`;
    const enOrden = ordenPorLoteEtapa.get(claveLoteEtapa);

    if (doc.insumos?.length > 0) {
      for (const ins of doc.insumos) {
        registrosCubiertos.add(claveLoteEtapa);
        filas.push(
          ...filasDeInsumo(
            {
              nombre: ins.descripcion,
              proveedor: "",
              fabricante: "",
              fechaVencimiento: "",
              cantidad: `${ins.cantidadRecibida ?? ins.cantidad ?? ""} ${ins.unidadRecibida || ins.unidad || ""}`.trim(),
              consumo: null,
              merma: null,
              lote: doc.lote,
              stage: doc.stage,
              producto: doc.producto,
            },
            ins.codigo,
            enOrden?.get(ins.codigo)
          )
        );
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
      filas.push(
        ...filasDeInsumo(
          {
            nombre: p.label,
            proveedor: "",
            fabricante: "",
            fechaVencimiento: "",
            cantidad: m[2].trim(),
            consumo: null,
            merma: null,
            lote: doc.lote,
            stage: doc.stage,
            producto: doc.producto,
          },
          m[1],
          enOrden?.get(m[1])
        )
      );
    }
  }

  // Lote y etapa donde el registro no aportó ningún material pero sí hay
  // orden: se usa su lista para no dejar el cuadro vacío.
  for (const doc of documents) {
    if (doc.familia !== familia || !doc.orden) continue;
    if (registrosCubiertos.has(`${claveLote(doc)}::${doc.stage}`)) continue;

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

  // El orden de la lista es el de la fórmula del producto —el principio
  // activo primero, luego los excipientes en el orden en que se pesan—, que
  // es el orden en que la Orden de Producción los imprime; no es
  // alfabético. Cualquier orden de cualquier lote sirve de referencia
  // (dentro de la misma etapa): la fórmula no cambia de un lote a otro del
  // mismo producto. Un material que no aparezca en ninguna orden —el
  // registro trae algo que la orden no declaró— se queda al final, en vez
  // de desordenar a los demás.
  const posicionEnOrden = new Map();
  for (const doc of documents) {
    if (doc.familia !== familia || !doc.orden) continue;
    doc.orden.insumos.forEach((ins, i) => {
      const clave = `${doc.stage}::${ins.codigo}`;
      if (!posicionEnOrden.has(clave)) posicionEnOrden.set(clave, i);
    });
  }

  return filas.sort((a, b) => {
    const posA = posicionEnOrden.get(`${a.stage}::${a.codigo}`) ?? Infinity;
    const posB = posicionEnOrden.get(`${b.stage}::${b.codigo}`) ?? Infinity;
    return posA - posB || a.nombre.localeCompare(b.nombre) || a.lote.localeCompare(b.lote);
  });
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
// Cómo se agrupan las operaciones de acondicionado en las filas de operarios
// del informe: el lotizado por un lado y el acondicionado por otro. El cambio
// de turno y el incremento de capacidad son la misma operación de
// acondicionado continuada por otra gente, así que van con ella.
const BLOQUES_OPERARIOS = [
  { etiqueta: "Lotizado - Codificado de cajas", re: /IMPRESI[OÓ]N\s+DE\s+CAJAS/i },
  {
    etiqueta: "Acondicionado",
    re: /OPERACI[OÓ]N\s*N\s*[°ºo.]*\s*2|INCREMENTO\s+DE\s+CAPACIDAD|CAMBIO\s+DE\s+TURNO/i,
    // El acondicionado siempre lo hizo alguien: si el registro no lo reparte
    // por secciones, o el reparto no da nadie, esta fila recoge al resto del
    // personal de la etapa. El lotizado no lleva respaldo porque sí puede no
    // haber ocurrido —las cajas vienen codificadas de otro lote— y entonces lo
    // que corresponde es dejarlo en blanco.
    respaldo: true,
  },
];

// Lo mismo para Fabricación, en sus propios tres trabajos: la granulación
// hasta el secado, la mezcla final ya seco el granulado, y el tableteado
// (comprimir en sí, no el armado ni la verificación de la máquina —ver el
// corte de sub-actividad "· COMPRESION" en parsers/personnel.js). "MEZCLA"
// va con límite de palabra para no confundirse con "TAMIZADO Y MEZCLA", que
// es parte de la granulación húmeda, no de la mezcla final.
const BLOQUES_OPERARIOS_FABRICACION = [
  {
    etiqueta: "Granulación - Secado",
    re: /^(FABRICACION|PREPARACION\s+DE\s+LA\s+SOLUCION\s+GRANULANTE|TAMIZADO\s+Y\s+MEZCLA|AMASADO|GRANULACI[OÓ]N\s+H[UÚ]MEDA|SECADO|GRANULACI[OÓ]N\s+SECA)\b/i,
  },
  // Lubricación no lleva fila propia de personal —sólo de tiempo, ver
  // tiemposDeFabricacion— porque el informe de referencia no la muestra ahí.
  { etiqueta: "Mezcla final", re: /^MEZCLA(\s+FINAL)?\b/i },
  {
    etiqueta: "Tableteado",
    re: /COMPRESI[OÓ]N|TABLETEADO/i,
    // El tableteado siempre lo hizo alguien: si el registro no separa la
    // compresión del resto de "SET UP", esta fila recoge al que quedó sin
    // reclamar en ningún otro bloque de la etapa.
    respaldo: true,
  },
];

/** Los nombres de un bloque de secciones, sin repetir y en orden. */
function nombresDe(personnel, bloque, rol) {
  if (!bloque?.re) return (personnel?.[rol] || []).map((p) => p.name);

  const vistos = new Set();
  for (const [seccion, suyos] of Object.entries(personnel?.porSeccion || {})) {
    if (!bloque.re.test(seccion)) continue;
    for (const p of suyos[rol] || []) vistos.add(p.name);
  }
  return [...vistos].sort();
}

/**
 * Reparte el personal de una etapa entre sus operaciones.
 *
 * El bloque de respaldo se queda con quien no reclamó ningún otro: en
 * acondicionado eso es todo el que no aparece codificando cajas, que es
 * exactamente quien acondicionó. Así la fila nunca queda vacía por un
 * registro que no separe sus operaciones, y tampoco repite al lotizador.
 */
function repartirPersonal(personnel, bloques, rol) {
  const reparto = bloques.map((b) => [b, nombresDe(personnel, b, rol)]);
  const reclamados = new Set(reparto.flatMap(([b, n]) => (b.respaldo ? [] : n)));

  return Object.fromEntries(
    reparto.map(([b, nombres]) => [
      b.etiqueta,
      b.respaldo && nombres.length === 0
        ? (personnel?.[rol] || []).map((p) => p.name).filter((n) => !reclamados.has(n))
        : nombres,
    ])
  );
}

/**
 * Personal lote por lote, que es como lo pide la tabla del informe: una
 * columna por lote y, dentro de cada etapa, una fila de operadores y otra de
 * supervisores. (aggregatePersonnel, en cambio, resume toda la etapa.)
 *
 * En acondicionado los operarios salen repartidos en dos filas —lotizado y
 * acondicionado—, que son trabajos distintos hechos por gente distinta. Eso
 * sólo se sabe si el registro se analizó con la lectura por secciones; en los
 * lotes analizados antes, el bloque queda vacío y se muestra la fila única de
 * siempre.
 */
export function personalPorLote(documents, familia) {
  return listStages(documents, familia).map((stage) => {
    const docs = documents.filter((d) => d.familia === familia && d.stage === stage && d.kind !== "orden");
    const lotes = [...new Set(docs.map(claveLote))].sort();

    // Acondicionado y Fabricación siempre salen con sus propias operaciones,
    // aunque en estos lotes no conste ninguna: el cuadro del informe las
    // tiene todas, y la que no se hizo se queda en blanco. Cualquier otra
    // etapa sigue con la fila única de siempre.
    const bloques =
      stage === "ACONDICIONADO"
        ? BLOQUES_OPERARIOS
        : stage === "FABRICACION"
          ? BLOQUES_OPERARIOS_FABRICACION
          : [{ etiqueta: stage, re: null }];

    const porLote = {};
    for (const lote of lotes) {
      const doc = docs.find((d) => claveLote(d) === lote);
      porLote[lote] = {
        operarios: nombresDe(doc?.personnel, null, "operarios"),
        supervisores: nombresDe(doc?.personnel, null, "supervisores"),
        // Operarios y supervisores se reparten por el mismo criterio: quien
        // codificó las cajas y quien acondicionó son trabajos distintos, y su
        // visto bueno lo dio quien estaba de turno en cada uno.
        bloques: repartirPersonal(doc?.personnel, bloques, "operarios"),
        bloquesSupervisores: repartirPersonal(doc?.personnel, bloques, "supervisores"),
      };
    }

    const producto = docs[0]?.producto || familia;
    return { stage, lotes, porLote, producto, bloques: bloques.map((b) => b.etiqueta) };
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
    const clave = claveLote(doc);
    if (receta && !mapa[clave]) mapa[clave] = receta;
  }
  return mapa;
}

/** Personal por etapa, en el formato de las tablas de personal del RVP. */
export function personalPorEtapa(documents, familia) {
  return listStages(documents, familia).map((stage) => ({
    stage,
    lotes: [...new Set(documents.filter((d) => d.familia === familia && d.stage === stage).map(claveLote))].sort(),
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
    tablas: stages.map((etapa) => {
      const tabla = buildTable(alcance, familia, etapa, { onlyCritical });
      // El material y su cantidad abren el cuadro, como en el informe: son el
      // contexto del lote antes de entrar en los parámetros de operación.
      const consideraciones = consideracionesGenerales(alcance, familia, etapa);
      if (consideraciones) {
        tabla.sections = [consideraciones, ...tabla.sections];
        tabla.rowCount += consideraciones.rows.length;
      }
      // Sólo Fabricación lleva el resumen de tiempos por tramo (granulación
      // seca/lubricación/mezcla final, y compresión) — Acondicionado y las
      // demás etapas quedan exactamente como estaban.
      if (etapa === "FABRICACION") {
        const tiempos = tiemposDeFabricacion(alcance, familia);
        if (tiempos) {
          tabla.sections = [...tabla.sections, tiempos];
          tabla.rowCount += tiempos.rows.length;
        }
      }
      return tabla;
    }),
  };
}

const SECCION_CONSIDERACIONES = "CONSIDERACIONES GENERALES";

// El rótulo nombra la etapa: en Acondicionado son cajas y folletos, pero en
// Fabricación son materias primas y en Envase, blísteres — "MATERIAL DE
// ACONDICIONADO" puesto fijo, sea cual sea la etapa, venía de cuando la app
// sólo conocía esa etapa.
function rotuloMaterial(stage) {
  return `MATERIAL DE ${stage || "ACONDICIONADO"}`;
}

/**
 * El apartado "CONSIDERACIONES GENERALES" del cuadro de parámetros: qué
 * material de acondicionado se usó y cuánto entró en cada lote.
 *
 * El nombre del material lo pone el registro de manufactura, que es el que
 * dice lo que realmente se usó en la etapa; la cantidad la pone la orden de
 * producción, que es donde está declarada (ver materialesPorLote, que ya
 * cruza las dos por código de material).
 *
 * Se devuelve con la forma de una sección de buildTable para poder anteponerla
 * a las demás sin que el cuadro tenga que saber de dónde salió.
 */
export function consideracionesGenerales(documents, familia, stage) {
  const materiales = materialesPorLote(documents, familia).filter((m) => !stage || m.stage === stage);
  if (materiales.length === 0) return null;

  const porNombre = new Map();
  for (const m of materiales) {
    if (!m.nombre) continue;
    if (!porNombre.has(m.nombre)) porNombre.set(m.nombre, {});
    const cantidad = (m.cantidad || "").trim();
    if (cantidad) porNombre.get(m.nombre)[m.lote] = cantidad;
  }

  const rows = [...porNombre.entries()]
    .filter(([, valores]) => Object.keys(valores).length > 0)
    .map(([nombre, values]) => ({
      id: `consideracion::${nombre}`,
      section: SECCION_CONSIDERACIONES,
      label: nombre,
      // Ni rango ni "Referencial": la cantidad entregada no se compara contra
      // un criterio, se deja constancia de ella.
      setpoint: "",
      sinRango: true,
      unit: "",
      valueType: "text",
      category: "critico",
      values,
    }));

  return rows.length > 0
    ? { title: SECCION_CONSIDERACIONES, rotulo: rotuloMaterial(stage), rows }
    : null;
}

// --- Tiempos por tramo de Fabricación ---------------------------------
//
// Granulación seca, Lubricación y Mezcla final van seguidas, ya seco el
// granulado, y sus horas de inicio/final viven cada una bajo su propia
// sección — se combinan en un solo tramo (el primer inicio, el último
// final). La Compresión (tableteado) es un trabajo aparte, a menudo días
// después, y su encabezado en el registro es literalmente "SET UP" —el
// mismo que usa el changeover de la máquina—, así que sus fechas no salen
// de la sección: salen del propio nombre del paso ("FECHA / HORA INICIO DE
// LA COMPRESIÓN"), sea cual sea la sección donde caiga.
const SECCION_GRANULACION_MEZCLA_RE =
  /^(PREPARACION\s+DE\s+LA\s+SOLUCION\s+GRANULANTE|TAMIZADO\s+Y\s+MEZCLA|AMASADO|GRANULACI[OÓ]N\s+H[UÚ]MEDA|SECADO|GRANULACI[OÓ]N\s+SECA|LUBRICACION|LUBRICACIÓN|MEZCLA)\b/i;
const COMPRESION_INICIO_RE = /^FECHA\s*\/\s*HORA\s+INICIO\s+DE(L)?\s+(LA\s+)?(COMPRESI[OÓ]N|TABLETEADO)\b/i;
const COMPRESION_FINAL_RE = /^FECHA\s*\/\s*HORA\s+FINAL\s+DE(L)?\s+(LA\s+)?(COMPRESI[OÓ]N|TABLETEADO)\b/i;
const SECCION_TIEMPOS_FABRICACION = "TIEMPOS DE FABRICACIÓN";

/**
 * El primer "HORA INICIO" y el último "HORA FINAL" entre las secciones que
 * cumplan `re`, tal como los dejó parsers/tiempos.js — sin pasar por
 * `soloFecha`, porque estas secciones sólo imprimen la hora, no el día.
 */
function fechasCombinadasDeSecciones(doc, re) {
  const dentro = (p) => re.test(p.section || "");
  const esInicio = (p) => /^HORA INICIO\b/i.test(p.baseLabel || p.label || "");
  const esFinal = (p) => /^HORA FINAL\b/i.test(p.baseLabel || p.label || "");

  const inicios = doc.params
    .filter((p) => dentro(p) && esInicio(p) && p.value)
    .map((p) => p.value)
    .sort();
  const finales = doc.params
    .filter((p) => dentro(p) && esFinal(p) && p.value)
    .map((p) => p.value)
    .sort();

  if (inicios.length === 0 && finales.length === 0) return null;
  return { inicio: inicios[0] || "", fin: finales[finales.length - 1] || "" };
}

/** Fecha y hora de la compresión, por el nombre del propio paso, no por sección. */
function fechasDeCompresion(doc) {
  const inicio = doc.params.find((p) => COMPRESION_INICIO_RE.test(p.label || p.baseLabel || ""));
  const final = doc.params.find((p) => COMPRESION_FINAL_RE.test(p.label || p.baseLabel || ""));
  if (!inicio && !final) return null;
  return { inicio: inicio?.value || "", fin: final?.value || "" };
}

/**
 * La sección extra de tiempos que se agrega sólo al cuadro de Fabricación
 * (ver buildRvpModel) — Acondicionado y las demás etapas no la llevan.
 */
export function tiemposDeFabricacion(documents, familia) {
  const docs = documents.filter((d) => d.familia === familia && d.stage === "FABRICACION" && d.kind !== "orden");
  if (docs.length === 0) return null;

  const porGranMezcla = {};
  const porCompresion = {};
  for (const doc of docs) {
    const lote = claveLote(doc);
    const gm = fechasCombinadasDeSecciones(doc, SECCION_GRANULACION_MEZCLA_RE);
    if (gm) porGranMezcla[lote] = gm;
    const cp = fechasDeCompresion(doc);
    if (cp) porCompresion[lote] = cp;
  }

  const soloValor = (mapa, campo) =>
    Object.fromEntries(Object.entries(mapa).map(([lote, fechas]) => [lote, fechas[campo]]).filter(([, v]) => v));

  const fila = (id, label, values) => ({
    id,
    section: SECCION_TIEMPOS_FABRICACION,
    label,
    setpoint: "",
    sinRango: true,
    unit: "",
    valueType: "text",
    category: "critico",
    values,
  });

  const rows = [
    fila("tiempo-fab::gm-inicio", "Inicio Granulación Seca / Lubricación / Mezcla Final", soloValor(porGranMezcla, "inicio")),
    fila("tiempo-fab::gm-final", "Final Granulación Seca / Lubricación / Mezcla Final", soloValor(porGranMezcla, "fin")),
    fila("tiempo-fab::cp-inicio", "Inicio Compresión (Tableteado)", soloValor(porCompresion, "inicio")),
    fila("tiempo-fab::cp-final", "Final Compresión (Tableteado)", soloValor(porCompresion, "fin")),
  ].filter((r) => Object.keys(r.values).length > 0);

  return rows.length > 0 ? { title: SECCION_TIEMPOS_FABRICACION, rows } : null;
}

