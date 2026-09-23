// Lo que el protocolo de validación ya dice, leído para la Evaluación de
// Criticidad y Riesgo.
//
// El protocolo trae dos cosas que la evaluación necesita y que ningún
// registro de manufactura tiene:
//
//   1. Los ATRIBUTOS DE CALIDAD DEL PRODUCTO TERMINADO — la tabla "Ensayo ·
//      Especificaciones · NT" del capítulo V. Es exactamente lo que el Paso 0
//      del procedimiento pide: "la lista de los atributos de calidad del
//      producto contenidos en el certificado de análisis del producto
//      terminado y en las especificaciones". Valoración, disolución,
//      uniformidad, impurezas, microbiología: los CQA de verdad, con su
//      especificación. El registro de manufactura sólo trae los controles en
//      proceso (dureza, grados Brix, espesor de pared), que son otra cosa.
//
//   2. El ANÁLISIS DE RIESGO que ya se hizo — la sección "Análisis de riesgo,
//      evaluación de parámetros de proceso", una tabla por etapa con
//      "Parámetros · Set-point · Clasificación · Análisis de riesgo · Afecta ·
//      Rango esperado". Es el "texto fuente" del que salen las corridas: su
//      columna de análisis de riesgo es el origen de la sospecha del Paso 2,
//      y su columna "Afecta" dice con qué atributo. Leerlo en vez de
//      preguntárselo a la IA es la diferencia entre una evaluación sustentada
//      en lo que la empresa ya documentó y una redactada de memoria.
//
// La clasificación de ese análisis viene en el esquema ANTIGUO (Crítico /
// Potencialmente crítico / Clave). No se usa para decidir nada —el
// procedimiento nuevo decide por severidad— pero se conserva, porque
// comparar la clasificación antigua con la nueva es justo lo que hay que
// poder revisar al migrar de un esquema al otro.

import { leerProtocolo, textoDe } from "../protocolo/documento.js";
import { bloques, celdasDe, enColumna } from "../protocolo/parametros.js";

const RE_FILA = /<w:tr\b[\s\S]*?<\/w:tr>/g;
const RE_PARRAFO = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;

/**
 * El texto de una celda con sus párrafos separados.
 *
 * `textoDe` los pega sin espacio, y en estas tablas una celda suele tener
 * varios: "400.00 (360.00 - 440.00) mg/cáp." en un párrafo y "(90.0 % -
 * 110.0 %)" en el siguiente salían como "mg/cáp.(90.0 %".
 */
function textoDeCelda(xml) {
  const partes = [...xml.matchAll(RE_PARRAFO)].map((m) => textoDe(m[0])).filter(Boolean);
  return partes.length ? partes.join(" ").replace(/\s+/g, " ").trim() : textoDe(xml);
}

function celdasConTexto(filaXml) {
  // Se reusa el cálculo de columnas de la rejilla, que es lo que resuelve las
  // celdas combinadas en horizontal, y sólo se cambia cómo se lee el texto.
  const cruda = [...filaXml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
  return celdasDe(filaXml).map((c, i) => ({ ...c, texto: textoDeCelda(cruda[i] || "") }));
}

// --- 1. Los atributos del producto terminado -------------------------------

/**
 * El tipo de dato de cada atributo, según la Tabla 8 del procedimiento.
 *
 * Decide cómo se calcula el muestreo en el Paso 5: un dato continuo se
 * trata con un intervalo de tolerancia; uno de pasa/no pasa, con
 * confianza-confiabilidad y cero defectos. Se deduce de la ESPECIFICACIÓN,
 * que es lo que dice cómo se mide: "No menos de 80 %" es un número; "Ausencia
 * en 1 g" o "Corresponde al estándar" es un sí o un no.
 */
export function tipoDeDato(ensayo, especificacion) {
  const nombre = String(ensayo || "").toLowerCase();
  // Primero el NOMBRE: si nombra una magnitud que se mide, es continuo aunque
  // la especificación venga escrita en palabras. «Porcentaje de sellado» es un
  // porcentaje, y «Peso específico» un número, por mucho que su rango en el
  // cuadro diga "según lo observado".
  if (/\b(peso|porcentaje|grados|dureza|espesor|humedad|ph\b|valoraci|disoluci|uniformidad|dimensi|densidad|viscosidad|volumen|recuento|impureza|compuesto relacionado|contenido)/.test(nombre)) {
    return "Continuo";
  }
  // Después, lo que se juzga por sí o por no. Son los ejemplos de la Tabla 8:
  // identidad, ausencia de microorganismos, hermeticidad (sella / no sella).
  const todo = `${nombre} ${especificacion || ""}`.toLowerCase();
  if (/ausencia|ausente|corresponde|conforme|cumple|identi|descripci|aspecto|color|herm[eé]tic|exenta|libre de|correspondencia/.test(todo)) {
    return "Atributo";
  }
  return /\d/.test(especificacion || "") ? "Continuo" : "Atributo";
}

/**
 * Lee la tabla "Ensayo · Especificaciones · NT".
 *
 * Tiene filas de dos tipos: los GRUPOS ("VALORACIÓN", "DISOLUCIÓN") en una
 * sola celda a lo ancho, y debajo los ensayos con su especificación. El
 * atributo se nombra por su grupo cuando lo hay —en un expediente se habla de
 * "Disolución", no de "IBUPROFENO (Aparato 2, 60 min.) – Cromatografía de
 * líquidos"— y el ensayo concreto se guarda como detalle.
 */
export function especificacionesDe(xml) {
  const atributos = [];
  for (const b of bloques(xml)) {
    if (b.tipo !== "tbl") continue;
    const filas = [...b.xml.matchAll(RE_FILA)].map((m) => celdasConTexto(m[0]));
    if (filas.length < 2) continue;
    const cab = filas[0].map((c) => c.texto.toLowerCase());
    if (!(/^ensayo/.test(cab[0] || "") && cab.some((c) => /especificaci/.test(c)))) continue;

    let grupo = "";
    for (const f of filas.slice(1)) {
      const conTexto = f.filter((c) => c.texto);
      if (conTexto.length === 0) continue;
      // Una fila de una sola celda es un grupo o una nota: la del código de la
      // especificación ("ESPECIFICACIONES TÉCNICAS… Código: ESP-PT-…") y la de
      // la leyenda de normas ("NT: Norma Técnica…") no son grupos.
      if (conTexto.length === 1) {
        const t = conTexto[0].texto;
        if (/^(NT:|ESPECIFICACIONES T[ÉE]CNICAS)/i.test(t)) continue;
        grupo = t;
        continue;
      }
      const [ensayo, especificacion, norma] = [f[0]?.texto || "", f[1]?.texto || "", f[2]?.texto || ""];
      if (!ensayo) continue;
      // "CARACTERÍSTICAS FÍSICAS" y "PRUEBAS ESPECÍFICAS" son grupos de
      // ordenación, no atributos: el atributo es el ensayo que llevan dentro.
      const grupoEsAtributo = grupo && !/CARACTER[ÍI]STICAS|PRUEBAS ESPEC[ÍI]FICAS|EXAMEN MICROBIOL/i.test(grupo);
      const nombre = grupoEsAtributo ? capitalizar(grupo) : ensayo;
      const detalle = grupoEsAtributo ? ensayo : "";
      atributos.push({
        nombre: detalle && atributos.some((a) => a.nombre === nombre) ? `${nombre} — ${detalle}` : nombre,
        grupo: capitalizar(grupo || ""),
        ensayo,
        especificacion,
        norma: norma || "",
        criterios: especificacion ? [especificacion] : [],
        tipoDeDato: tipoDeDato(ensayo, especificacion),
        origen: "especificación",
        etapa: "PRODUCTO TERMINADO",
      });
    }
    // Con la primera tabla de especificaciones basta: el protocolo tiene una.
    if (atributos.length > 0) break;
  }

  // Dos ensayos del mismo grupo ("Compuesto relacionado J" y "C" dentro de
  // IMPUREZAS) salen como dos atributos distintos con su calificativo, porque
  // tienen dos límites y la severidad es por atributo. El primero de ellos
  // se renombra también para que ninguno quede con el nombre a secas.
  const porNombre = new Map();
  for (const a of atributos) {
    const base = a.nombre.split(" — ")[0];
    porNombre.set(base, (porNombre.get(base) || 0) + 1);
  }
  return atributos.map((a) =>
    porNombre.get(a.nombre) > 1 && a.ensayo !== a.nombre ? { ...a, nombre: `${a.nombre} — ${a.ensayo}` } : a
  );
}

/** "VALORACIÓN" → "Valoración". Los grupos del protocolo van en mayúscula. */
function capitalizar(t) {
  const s = String(t).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// --- 2. El análisis de riesgo que ya existe --------------------------------

const RE_TITULO_ETAPA = /^Etapa(?:\s*:\s*|\s+de\s+)(.+?)\s*:?\s*$/i;

/** Dónde está cada columna en la cabecera del cuadro de análisis de riesgo. */
function columnasDeRiesgo(cabecera) {
  const buscar = (re) => cabecera.find((c) => re.test(c.texto))?.columna;
  const columnas = {
    parametro: buscar(/^Par[áa]metros?\b/i),
    setpoint: buscar(/Set.?point/i),
    clasificacion: buscar(/Clasificaci[óo]n/i),
    analisis: buscar(/An[áa]lisis\s+de\s+riesgo/i),
    afecta: buscar(/^Afecta/i),
    rango: buscar(/Rango/i),
  };
  // Sin estas tres no es un cuadro de análisis de riesgo, por mucho que se
  // parezca: el protocolo tiene decenas de tablas con "Parámetros" en la
  // cabecera.
  if ([columnas.parametro, columnas.analisis, columnas.afecta].some((c) => c === undefined)) return null;
  return columnas;
}

/**
 * Lee el análisis de riesgo por etapa del protocolo.
 *
 * Cuatro detalles de la tabla real que hay que resolver:
 *
 *   - La etapa no está en la tabla sino en el párrafo de antes, escrito de
 *     dos formas en el mismo documento: "Etapa: Dispensación" y "Etapa de
 *     Fabricación".
 *   - Las operaciones van como filas de una sola celda ("Consideraciones
 *     generales", "Calentamiento del agua…") en medio del cuadro.
 *   - Un parámetro que afecta a DOS atributos ocupa dos filas, con la celda
 *     del parámetro combinada en vertical: no es un parámetro nuevo, es otro
 *     atributo del mismo.
 *   - Y al revés: varios parámetros de una misma operación —el tiempo, la
 *     velocidad y la temperatura de una agitación— comparten UNA celda de
 *     clasificación, de análisis y de "Afecta", combinada en vertical sobre
 *     los tres. Es la regla de los parámetros acoplados del procedimiento,
 *     escrita en la propia tabla. Leída celda a celda, esas filas salían sin
 *     clasificación, sin análisis y sin atributo: 43 de 111 parámetros del
 *     protocolo del DOLORAL.
 *
 * Las dos últimas se resuelven igual: una celda combinada hereda el valor
 * de la de arriba en su misma columna.
 */
export function analisisDeRiesgoDe(xml) {
  const filas = [];
  let etapa = "";

  for (const b of bloques(xml)) {
    if (b.tipo === "p") {
      const m = textoDe(b.xml).match(RE_TITULO_ETAPA);
      if (m) etapa = m[1].replace(/\s+/g, " ").trim();
      continue;
    }

    const trs = [...b.xml.matchAll(RE_FILA)].map((m) => celdasConTexto(m[0]));
    if (trs.length < 2) continue;
    const columnas = columnasDeRiesgo(trs[0]);
    if (!columnas) continue;

    let operacion = "";
    let actual = null;
    // El valor de cada columna en la fila anterior, para las celdas combinadas.
    let previo = {};

    for (const celdas of trs.slice(1)) {
      const conTexto = celdas.filter((c) => c.texto);
      const combinadas = celdas.filter((c) => c.continuacion);
      if (conTexto.length === 0 && combinadas.length === 0) continue;

      // Una fila con una sola celda a lo ancho y nada combinado es el título
      // de una operación.
      if (conTexto.length === 1 && celdas.length <= 2 && combinadas.length === 0) {
        operacion = conTexto[0].texto;
        actual = null;
        previo = {};
        continue;
      }

      // Cada columna: su texto, o el de arriba si la celda viene combinada.
      const leer = (clave) => {
        const col = columnas[clave];
        if (col === undefined) return { texto: "", heredado: false };
        const celda = enColumna(celdas, col);
        if (celda?.continuacion) return { texto: previo[clave] || "", heredado: true };
        return { texto: celda?.texto || "", heredado: false };
      };
      const v = {
        parametro: leer("parametro"),
        setpoint: leer("setpoint"),
        clasificacion: leer("clasificacion"),
        analisis: leer("analisis"),
        afecta: leer("afecta"),
        rango: leer("rango"),
      };
      for (const [clave, { texto }] of Object.entries(v)) previo[clave] = texto;
      // «No afecta ningún atributo» es la respuesta NO del screening, no el
      // nombre de un atributo. Leído como nombre, entraba en el Paso 0 como un
      // atributo más, la IA le ponía severidad, y con 4 o 5 el parámetro
      // salía Crítico por no afectar a nada.
      if (diceQueNoAfecta(v.afecta.texto)) v.afecta = { ...v.afecta, texto: "" };

      // El mismo parámetro de la fila de arriba: otro atributo afectado.
      if ((v.parametro.heredado || !v.parametro.texto) && actual) {
        if (v.afecta.texto && !v.afecta.heredado && !actual.afecta.some((a) => a.atributo === v.afecta.texto)) {
          actual.afecta.push({ atributo: v.afecta.texto, rango: v.rango.texto });
        }
        continue;
      }
      if (!v.parametro.texto) continue;

      // Un parámetro nuevo que comparte racional con el de arriba hereda
      // también TODOS los atributos de aquél, no sólo el de la última fila:
      // la celda combinada de "Afecta" abarca a los dos.
      const acoplado = v.analisis.heredado && actual;
      const afecta =
        v.afecta.heredado && actual
          ? actual.afecta.map((a) => ({ ...a }))
          : v.afecta.texto
            ? [{ atributo: v.afecta.texto, rango: v.rango.texto }]
            : [];

      actual = {
        etapa,
        operacion,
        parametro: v.parametro.texto,
        setpoint: v.setpoint.texto,
        clasificacionAnterior: v.clasificacion.texto,
        analisis: v.analisis.texto.replace(/^Riesgo\s*:\s*/i, ""),
        afecta,
        // Con quién comparte racional, para poder decirlo: es la regla de los
        // parámetros acoplados, y hay que poder ver que se aplicó.
        acopladoCon: acoplado ? filas[filas.length - 1]?.acopladoCon || filas[filas.length - 1]?.parametro : null,
      };
      filas.push(actual);
    }
  }
  return filas;
}

/** Si lo escrito en «Afecta» es la negación («No afecta», «Ninguno», «N/A»). */
export function diceQueNoAfecta(texto) {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return /^(no afecta\b|ningun[oa]?\b|sin (impacto|efecto|afectacion)\b|no aplica\b|n\/?a$|-+$|—$)/.test(t);
}

// --- 3. Casar los nombres de «Afecta» con los atributos ---------------------

/**
 * Lo que la columna «Afecta» nombra y NO es un atributo de calidad, sino de
 * desempeño del proceso.
 *
 * En el protocolo del DOLORAL, los 34 parámetros clasificados "Clave" apuntan
 * todos a uno de estos tres. Es la definición misma de parámetro clave del
 * procedimiento: "esencial para el desempeño del proceso, pero que no afecta
 * atributos de calidad del producto". Así que nombrarlos en «Afecta» no es
 * una sospecha de impacto en calidad: es la respuesta SÍ a la pregunta de
 * desempeño.
 */
const DESEMPENO = /^(TIEMPO DE (PROCESO|OPERACION)|RENDIMIENTO|EQUILIBRIO DE LA PILA|DURACION|CONSISTENCIA DEL PROCESO)\b/;

function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9()+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sin paréntesis: «pH (25° C)» y «pH» son el mismo ensayo. */
function sinParentesis(texto) {
  return normalizar(String(texto ?? "").replace(/\([^)]*\)/g, " "));
}

export function esDeDesempeno(nombre) {
  return DESEMPENO.test(normalizar(nombre));
}

/**
 * Los atributos de la especificación a los que se refiere un nombre de la
 * columna «Afecta».
 *
 * Por igualdad, NO por contención. «Descripción de la gelatina» contiene
 * «Descripción» y es otro atributo: el aspecto de un intermedio, no el del
 * producto terminado. Las corridas lo separan en dos filas con severidades
 * distintas, y fundirlos por parecido es exactamente el error que hay que
 * evitar.
 *
 * Dos excepciones, las dos seguras:
 *   - el nombre del principio activo detrás: «Valoración de ibuprofeno» es la
 *     «Valoración» cuando el ensayo de la especificación es de ibuprofeno;
 *   - un grupo: «Examen microbiológico» es cada uno de los ensayos
 *     microbiológicos de la especificación.
 */
export function atributosDeLaEspecificacion(nombre, especificaciones) {
  const buscado = normalizar(nombre);
  const buscadoSinPar = sinParentesis(nombre);
  if (!buscado) return [];

  const exactos = especificaciones.filter(
    (e) => normalizar(e.nombre) === buscado || sinParentesis(e.nombre) === buscadoSinPar
  );
  if (exactos.length) return exactos;

  // «<atributo> de <principio activo>», con el activo nombrado en el ensayo.
  for (const e of especificaciones) {
    const base = normalizar(e.nombre.split(" — ")[0]);
    if (!buscado.startsWith(`${base} DE `)) continue;
    const resto = buscado.slice(base.length + 4).trim();
    if (resto && normalizar(e.ensayo).includes(resto)) return [e];
  }

  // Un grupo entero de la especificación.
  const delGrupo = especificaciones.filter((e) => e.grupo && normalizar(e.grupo) === buscado);
  return delGrupo;
}

/**
 * El Paso 0 completo cuando hay protocolo: la especificación del producto
 * terminado MÁS los atributos que sólo aparecen citados en el análisis de
 * riesgo.
 *
 * Es lo que hacen las corridas: la Tabla 2 del Paso 0 es la especificación,
 * y la Tabla 3 son los "atributos adicionales encontrados sólo en el análisis
 * de riesgo" —en el DOLORAL, los intermedios: grados Brix, porcentaje de
 * sellado, descripción de la gelatina—. Los de desempeño no entran: no son
 * atributos de calidad.
 *
 * Los adicionales se unifican sólo por mayúsculas y acentos: «Peso promedio
 * (contenido + cubierta húmeda)» y «(Contenido + cubierta humeda)» son uno;
 * «… cubierta húmeda» y «… cubierta seca» son dos, antes y después de secar.
 */
export function atributosDelProtocolo({ especificaciones = [], analisis = [] }) {
  const adicionales = new Map();
  for (const fila of analisis) {
    for (const a of fila.afecta) {
      if (esDeDesempeno(a.atributo)) continue;
      if (atributosDeLaEspecificacion(a.atributo, especificaciones).length) continue;
      const clave = normalizar(a.atributo);
      if (!adicionales.has(clave)) {
        adicionales.set(clave, {
          nombre: a.atributo.replace(/\s+/g, " ").trim(),
          criterios: a.rango ? [a.rango] : [],
          origen: "análisis de riesgo",
          etapa: fila.etapa,
          etapas: [fila.etapa],
          tipoDeDato: tipoDeDato(a.atributo, a.rango),
        });
      } else {
        const x = adicionales.get(clave);
        if (a.rango && !x.criterios.includes(a.rango)) x.criterios.push(a.rango);
        if (!x.etapas.includes(fila.etapa)) x.etapas.push(fila.etapa);
      }
    }
  }
  return [...especificaciones, ...adicionales.values()];
}

/**
 * El nombre del atributo del catálogo al que apunta cada nombre de «Afecta».
 *
 * Devuelve la lista de nombres del catálogo (puede ser más de uno si «Afecta»
 * nombra un grupo) y aparte los de desempeño, que no son atributos.
 */
export function resolverAfecta(nombres, catalogo, especificaciones) {
  const calidad = [];
  const desempeno = [];
  for (const nombre of nombres) {
    if (esDeDesempeno(nombre)) {
      if (!desempeno.includes(nombre)) desempeno.push(nombre);
      continue;
    }
    const deEsp = atributosDeLaEspecificacion(nombre, especificaciones);
    const destinos = deEsp.length
      ? deEsp.map((e) => e.nombre)
      : catalogo.filter((c) => normalizar(c.nombre) === normalizar(nombre)).map((c) => c.nombre);
    for (const d of destinos) if (!calidad.includes(d)) calidad.push(d);
  }
  return { calidad, desempeno };
}

/**
 * El producto del protocolo, de su tabla de alcance ("PRODUCTO · ETAPA ·
 * PRESENTACIÓN · TAMAÑO DE LOTE").
 *
 * Hace falta cuando se evalúa sólo con el protocolo, sin registros cargados:
 * sin esto el documento salía sin producto en el título ni en el nombre del
 * archivo. Se toma sólo el PRIMER párrafo de la celda: el segundo es el
 * principio activo ("Principio activo: Ibuprofeno…"), que no es el nombre.
 */
export function productoDe(xml) {
  for (const b of bloques(xml)) {
    if (b.tipo !== "tbl") continue;
    const trs = [...b.xml.matchAll(RE_FILA)].map((m) => m[0]);
    if (trs.length < 2) continue;
    const primeraCelda = (fila) => fila.match(/<w:tc>[\s\S]*?<\/w:tc>/)?.[0] || "";
    if (!/^PRODUCTO\b/i.test(textoDe(primeraCelda(trs[0])))) continue;
    const celda = primeraCelda(trs[1]);
    const primero = [...celda.matchAll(RE_PARRAFO)].map((m) => textoDe(m[0])).find(Boolean);
    if (primero) return primero.replace(/\s+/g, " ").trim();
  }
  return "";
}

/**
 * Lee un protocolo en Word y devuelve lo que la evaluación necesita de él.
 *
 * Cualquiera de las dos partes puede faltar —un Formato 9 en blanco no trae
 * el análisis de riesgo, un protocolo antiguo puede no traer la tabla de
 * especificaciones— y la evaluación sigue con lo que haya.
 */
export async function leerProtocoloParaCriticidad(file) {
  const { xml, nombre } = await leerProtocolo(file);
  return {
    nombre,
    producto: productoDe(xml),
    especificaciones: especificacionesDe(xml),
    analisis: analisisDeRiesgoDe(xml),
  };
}
