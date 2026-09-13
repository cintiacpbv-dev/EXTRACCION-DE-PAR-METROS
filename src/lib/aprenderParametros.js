// La revisión que hace que el detector aprenda solo.
//
// El problema, en una línea: el detector reconoce una magnitud por su nombre,
// y esa lista de nombres está escrita a mano para lo que la planta ya fabrica.
// Llega un producto de otra familia y sus magnitudes no están; sus lecturas
// caen en "otros", que no se muestra, y arreglarlo significaba editar el
// código y volver a desplegar.
//
// Lo que hace este módulo: cuando entra un registro de una receta y etapa que
// nunca se revisaron, le pasa a la IA SÓLO las lecturas que quedaron sueltas
// —nunca el documento entero— y guarda como vocabulario las magnitudes que
// resulten. Desde entonces esas lecturas se detectan solas, en este equipo y
// en los demás, sin volver a preguntar.
//
// Una revisión por receta y etapa, no por lote. El segundo lote de la misma
// receta no enseña nada que no enseñara el primero, y preguntarlo otra vez
// sería gastar una llamada para no encontrar nada. Por eso la marca de
// revisado se pone aunque no se haya aprendido ningún término.
//
// Tres filtros antes de creerle a la IA (ver `terminoAceptable`): el término
// tiene que aparecer de verdad en alguna de las etiquetas que se le enviaron,
// no puede ser algo que el detector ya reconocía, y no puede enganchar
// ninguna lectura de trazabilidad del mismo documento. El tercero es el que
// evita el error caro: aprender "LOTE" o "CÓDIGO" convertiría media planilla
// de trazabilidad en parámetros de proceso, en TODOS los productos.

import { magnitudesConocidas } from "./parsers/genericParser.js";
import {
  cargarRevisionesRemotas,
  cargarVocabularioLocal,
  cargarVocabularioRemoto,
  claveDeRevision,
  guardarVocabularioLocal,
  guardarVocabularioRemoto,
  marcarRevision,
  normalizarTermino,
  usarVocabulario,
  vocabularioEnUso,
} from "./vocabulario.js";

/**
 * Pone en uso lo aprendido, al abrir la aplicación.
 *
 * Manda lo de Supabase, que es lo que ven todos los equipos; lo guardado en
 * este navegador es el respaldo para cuando no hay conexión o no están las
 * credenciales, y se refresca con lo remoto cada vez que se puede.
 */
export async function iniciarVocabulario() {
  const remoto = await cargarVocabularioRemoto();
  const lista = remoto ?? cargarVocabularioLocal();
  usarVocabulario(lista);
  if (remoto) guardarVocabularioLocal(remoto);
  return vocabularioEnUso();
}

/** Las revisiones ya hechas, con el respaldo local para trabajar sin Supabase. */
const CLAVE_REVISIONES = "deteccion-parametros:revisiones:v1";

function revisionesLocales() {
  try {
    const leido = JSON.parse(localStorage.getItem(CLAVE_REVISIONES) || "[]");
    return new Set(Array.isArray(leido) ? leido : []);
  } catch {
    return new Set();
  }
}

function anotarRevisionLocal(clave) {
  try {
    const hechas = revisionesLocales();
    hechas.add(clave);
    localStorage.setItem(CLAVE_REVISIONES, JSON.stringify([...hechas]));
  } catch {
    /* sin espacio o sin permiso: la marca remota sigue valiendo */
  }
}

// La sección donde el registro lista la maquinaria. Nada de lo que hay ahí es
// un parámetro de proceso —son códigos de equipo y de instrumento— y además ya
// tiene su propio detector (parsers/equipos.js), así que no pinta nada en el
// cuadro de parámetros ni en esta revisión.
//
// Medido sobre los cuatro registros reales: de las 55 lecturas que quedan sin
// clasificar (fabricación 34, envase 6, acondicionado 7, crema 8), 41 son de
// esta sección. Quitarlas no es sólo ahorrar tres cuartas partes de lo que se
// le manda a la IA: es quitarle de delante justo las líneas con más pinta de
// parámetro que no lo son ("TERMOMETRO = SEM-TER-24"), que son las que la
// harían proponer un término malo.
const SECCION_DE_EQUIPOS = /^EQUIPOS?\s*\/|INSTRUMENTOS?\s*\/|^MATERIALES\b/i;

/** Las lecturas que el detector no supo clasificar: eso es lo que se revisa. */
export function candidatosDe(doc) {
  return (doc?.params || [])
    .filter((p) => p.category === "otros" && !SECCION_DE_EQUIPOS.test(p.section || ""))
    .map((p) => ({ seccion: p.section, label: p.label, value: p.value, unit: p.unit }));
}

/** Las etiquetas que el detector ya dio por trazabilidad en este documento. */
function etiquetasDeTrazabilidad(doc) {
  return (doc?.params || []).filter((p) => p.category === "trazabilidad").map((p) => p.label);
}

const YA_CONOCIDAS = magnitudesConocidas().map(normalizarTermino);

function engancha(termino, etiqueta) {
  return ` ${normalizarTermino(etiqueta)} `.includes(` ${termino} `);
}

/**
 * Si un término propuesto se puede guardar.
 *
 * Devuelve el motivo del rechazo (una cadena) o null si pasa. Se devuelve el
 * motivo y no un booleano porque estos rechazos se enseñan en el panel: que
 * la IA propuso "LOTE" y se descartó es justamente lo que hay que poder ver.
 */
export function terminoAceptable(termino, { etiquetas, trazabilidad, enUso }) {
  const t = normalizarTermino(termino);
  if (t.length < 4) return "demasiado corto";
  if (YA_CONOCIDAS.some((c) => t === c || engancha(c, t))) return "el detector ya la reconocía";
  if ((enUso || []).some((v) => normalizarTermino(v.termino) === t)) return "ya estaba aprendida";
  if (!etiquetas.some((e) => engancha(t, e))) return "no aparece en ninguna lectura del registro";
  const choca = (trazabilidad || []).find((e) => engancha(t, e));
  if (choca) return `engancharía trazabilidad ("${choca}")`;
  return null;
}

/**
 * Revisa un registro, si su receta y etapa no se revisaron antes.
 *
 * Devuelve qué pasó, siempre — también cuando no había nada que preguntar —
 * para que el panel pueda decirlo en vez de quedarse callado.
 */
export async function revisarRegistro(doc, { revisadas, fetchImpl = fetch } = {}) {
  const producto = doc?.familia || doc?.meta?.producto || doc?.producto;
  const etapa = doc?.stage || doc?.meta?.stage;
  const receta = doc?.meta?.receta || null;
  const clave = claveDeRevision({ producto, receta, etapa });

  if (doc?.kind === "orden") return { clave, estado: "omitido", motivo: "es una orden de producción" };
  if (!producto || !etapa) return { clave, estado: "omitido", motivo: "sin producto o sin etapa" };
  if (revisadas?.has(clave)) return { clave, estado: "omitido", motivo: "ya revisado" };

  const candidatos = candidatosDe(doc);
  if (candidatos.length === 0) {
    await marcarRevision({ producto, receta, etapa }, { candidatos: 0, aprendidos: 0 });
    anotarRevisionLocal(clave);
    revisadas?.add(clave);
    return { clave, producto, etapa, estado: "sin candidatos", aprendidos: [], descartados: [] };
  }

  let respuesta;
  try {
    respuesta = await fetchImpl("/api/aprender-parametros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ producto, etapa, candidatos, conocidos: magnitudesConocidas() }),
    });
  } catch (err) {
    return { clave, producto, etapa, estado: "error", motivo: err.message };
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.json().catch(() => ({}));
    // Sin marcar como revisado: un fallo de la IA no es una revisión hecha, y
    // el registro tiene que poder volver a intentarse más adelante.
    return { clave, producto, etapa, estado: "error", motivo: detalle.error || `HTTP ${respuesta.status}` };
  }

  const { terminos = [] } = await respuesta.json().catch(() => ({}));
  const etiquetas = candidatos.map((c) => c.label);
  const trazabilidad = etiquetasDeTrazabilidad(doc);
  const enUso = vocabularioEnUso();

  const aprendidos = [];
  const descartados = [];
  for (const t of terminos) {
    const motivo = terminoAceptable(t?.termino, { etiquetas, trazabilidad, enUso: [...enUso, ...aprendidos] });
    if (motivo) {
      descartados.push({ termino: t?.termino, motivo });
      continue;
    }
    aprendidos.push({
      termino: normalizarTermino(t.termino),
      etiqueta: t.etiqueta || null,
      producto,
      receta,
      etapa,
      origen: "ia",
      motivo: t.motivo || null,
    });
  }

  if (aprendidos.length > 0) {
    await guardarVocabularioRemoto(aprendidos);
    const lista = [...enUso, ...aprendidos];
    usarVocabulario(lista);
    guardarVocabularioLocal(lista);
  }

  await marcarRevision(
    { producto, receta, etapa },
    { candidatos: candidatos.length, aprendidos: aprendidos.length }
  );
  anotarRevisionLocal(clave);
  revisadas?.add(clave);

  return { clave, producto, etapa, estado: "revisado", candidatos: candidatos.length, aprendidos, descartados };
}

/**
 * Revisa una tanda de registros, uno por receta y etapa.
 *
 * En serie y no en paralelo a propósito: cada llamada puede tardar casi un
 * minuto y las claves de la IA son las mismas que usa el análisis de riesgo.
 * Esto corre en segundo plano y nadie lo está esperando, así que puede ir
 * despacio; lo que no puede es quitarle las claves a lo que sí se espera.
 */
export async function revisarTanda(documentos, { onAvance } = {}) {
  const remotas = await cargarRevisionesRemotas();
  const revisadas = remotas ?? revisionesLocales();
  for (const clave of revisionesLocales()) revisadas.add(clave);

  const resultados = [];
  const vistas = new Set();

  for (const doc of documentos || []) {
    const clave = claveDeRevision({
      producto: doc?.familia || doc?.meta?.producto,
      receta: doc?.meta?.receta || null,
      etapa: doc?.stage || doc?.meta?.stage,
    });
    // Dos lotes de la misma receta y etapa en la misma tanda: uno basta.
    if (vistas.has(clave)) continue;
    vistas.add(clave);

    const resultado = await revisarRegistro(doc, { revisadas });
    resultados.push(resultado);
    if (resultado.estado !== "omitido") onAvance?.(resultado);
  }
  return resultados;
}
