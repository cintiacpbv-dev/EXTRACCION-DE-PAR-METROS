// La calificación del personal, leída del consolidado de la sección.
//
// El libro trae una hoja por sección —"CBL STATUS" para cápsulas blandas,
// "ACO STATUS" para acondicionado, y así— y dentro una fila por persona y
// rol: quien fabrica y además inspecciona sale dos veces, con la fecha de
// calificación de cada rol. Es exactamente lo que pide el Formato 8, que
// lista "nombre · etapa donde interviene · fecha".
//
// Se lee con JSZip y no con ExcelJS, que es lo que usa el cronograma de
// equipos: este consolidado pasa de 2,5 MB y ExcelJS tarda más de dos
// minutos en abrirlo —lo medí— porque reconstruye estilos y fórmulas de las
// diecinueve hojas. Aquí sólo hacen falta los valores, y leyendo el XML del
// zip directamente el mismo libro se abre en un instante. A cambio hay que
// resolver a mano las cadenas compartidas, que es lo que hace `cadenas()`.

import JSZip from "jszip";
import { supabase, supabaseEnabled } from "./supabaseClient.js";

// Las hojas de sección se llaman "<SECCIÓN> STATUS". El resto del libro
// —resúmenes por fecha, listas de pendientes— no tiene esta forma y se
// descarta sola al no encontrar la fila de títulos.
const HOJA_CESADOS = /PERSONAL\s+CESADO/i;

// Los títulos que hacen falta. El libro los escribe con acentos y con
// numeritos pegados al final ("FECHA CALIFICACIÓN 5"), así que se reconocen
// por su raíz.
const COLUMNAS = [
  ["dni", /^DNI$/],
  ["nombre", /NOMBRES\s+Y\s+APELLIDOS/],
  ["rol", /^ROL$/],
  ["rolMof", /^ROL\s*MOF$/],
  ["ingreso", /FECHA\s+DE\s+INGRESO/],
  ["inicioRol", /FECHA\s+DE\s+INICIO\s+EN\s+EL\s+ROL/],
  ["calificacion", /FPRO-?\s*324\s+CALIFICACI/],
  ["fechaCalificacion", /^FECHA\s+CALIFICACI/],
  ["nota", /^NOTA\s+CALIFICACI/],
  ["observaciones", /^OBSERVACIONES/],
];

function norm(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** El número de columna de una referencia de celda ("A" = 1, "AA" = 27). */
function numeroDeColumna(letras) {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Las cadenas compartidas del libro, en su orden. */
function cadenas(xml) {
  if (!xml) return [];
  const salida = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const partes = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
    salida.push(desescapar(partes.join("")));
  }
  return salida;
}

function desescapar(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const RE_FILA = /<row[^>]*\sr="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
const RE_CELDA = /<c\s+r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>|<c\s+r="([A-Z]+)\d+"([^>]*)\/>/g;

/** Las filas de una hoja, cada una como { columna: texto }. */
function filasDe(xml, compartidas) {
  const filas = [];
  for (const fila of xml.matchAll(RE_FILA)) {
    const celdas = new Map();
    for (const c of fila[2].matchAll(RE_CELDA)) {
      const letra = c[1] || c[4];
      const atributos = c[2] || c[5] || "";
      const cuerpo = c[3] || "";
      if (!letra) continue;

      let valor = "";
      const enLinea = cuerpo.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
      const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/);
      if (enLinea) valor = desescapar(enLinea[1]);
      else if (v) {
        valor = desescapar(v[1]);
        if (/\st="s"/.test(atributos)) {
          const i = Number(valor);
          valor = Number.isInteger(i) && i < compartidas.length ? compartidas[i] : "";
        }
      }

      valor = valor.replace(/\s+/g, " ").trim();
      if (valor) celdas.set(numeroDeColumna(letra), valor);
    }
    if (celdas.size > 0) filas.push({ n: Number(fila[1]), celdas });
  }
  return filas;
}

/**
 * "2025-02". El libro guarda las fechas como número de serie de Excel, y a
 * veces como texto ("2025-12--11") o como aviso ("NO APLICA").
 */
export function mesDe(valor) {
  if (valor == null || valor === "") return null;

  const texto = String(valor).trim();
  const serie = Number(texto);
  if (Number.isFinite(serie) && serie > 20000 && serie < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + serie * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const iso = texto.match(/^(\d{4})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}`;

  const dmy = texto.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}`;

  // "NO APLICA", "EN PROCESO" y demás no son fechas: no hay fecha, y decirlo
  // así evita que una casilla de aviso pase por calificación vigente.
  return null;
}

/** Busca la fila de títulos de una hoja y sitúa cada columna que interesa. */
function localizarColumnas(filas) {
  for (const fila of filas.slice(0, 12)) {
    const titulos = [...fila.celdas].map(([col, texto]) => [col, norm(texto)]);
    if (!titulos.some(([, t]) => /NOMBRES Y APELLIDOS/.test(t))) continue;

    const mapa = {};
    for (const [clave, patron] of COLUMNAS) {
      const encontrada = titulos.find(([, t]) => patron.test(t));
      if (encontrada) mapa[clave] = encontrada[0];
    }
    if (mapa.nombre && mapa.rol) return { filaTitulos: fila.n, mapa };
  }
  return null;
}

/**
 * Lee el consolidado y devuelve una entrada por sección, con su personal.
 *
 * Una hoja que no tenga la fila de títulos no es una hoja de sección y se
 * descarta sin ruido: el libro trae además resúmenes por fecha y listas de
 * pendientes que no son personal calificado.
 */
export async function leerPersonal(arrayBuffer, { fileName = "" } = {}) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const libro = await zip.file("xl/workbook.xml")?.async("string");
  if (!libro) throw new Error("El archivo no parece un libro de Excel (no tiene xl/workbook.xml).");

  const relsXml = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) || "";
  const destino = new Map(
    [...relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?xl\//, "")])
  );
  const compartidas = cadenas(await zip.file("xl/sharedStrings.xml")?.async("string"));

  const secciones = [];
  for (const m of libro.matchAll(/<sheet\s[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const nombreHoja = desescapar(m[1]).trim();
    const parte = destino.get(m[2]);
    if (!parte) continue;

    const xml = await zip.file(`xl/${parte}`)?.async("string");
    if (!xml) continue;

    const filas = filasDe(xml, compartidas);
    const encabezado = localizarColumnas(filas);
    if (!encabezado) continue;

    const { filaTitulos, mapa } = encabezado;
    const dato = (fila, clave) => (mapa[clave] ? fila.celdas.get(mapa[clave]) || "" : "");

    const personal = [];
    for (const fila of filas) {
      if (fila.n <= filaTitulos) continue;
      const nombre = dato(fila, "nombre");
      const rol = dato(fila, "rol");
      if (!nombre || !rol) continue;

      personal.push({
        dni: dato(fila, "dni"),
        nombre,
        rol,
        rolMof: dato(fila, "rolMof"),
        calificacion: dato(fila, "calificacion"),
        fecha: mesDe(dato(fila, "fechaCalificacion")),
        fechaTexto: dato(fila, "fechaCalificacion"),
        nota: dato(fila, "nota"),
        observaciones: dato(fila, "observaciones"),
      });
    }

    if (personal.length > 0) {
      secciones.push({
        // "CBL STATUS" es la sección CBL; el rótulo "STATUS" no aporta nada.
        seccion: nombreHoja.replace(/\s*STATUS\s*$/i, "").trim() || nombreHoja,
        hoja: nombreHoja,
        cesados: HOJA_CESADOS.test(nombreHoja),
        personal,
      });
    }
  }

  if (secciones.length === 0) {
    throw new Error(
      'Ninguna hoja de ese libro tiene la forma esperada: hace falta una fila de títulos con "NOMBRES Y APELLIDOS" y "ROL".'
    );
  }

  return { fileName, leidoEl: new Date().toISOString(), secciones };
}

// --- vigencia ---------------------------------------------------------------

// Cuánto vale una calificación antes de recalificar. El consolidado no lo
// dice en ninguna columna —sólo aparece a mano en algunas observaciones
// ("vence 28-08-2026")— así que es un ajuste del panel y no una constante
// escondida en el código. Dos años es lo que sugieren esas notas.
export const ANIOS_VIGENCIA = 2;

/**
 * Si la calificación de una persona sigue vigente.
 *
 * Tres respuestas, no dos: vigente, vencida, y "sin fecha". La tercera no es
 * un incumplimiento —es que el consolidado no registra cuándo se calificó— y
 * mezclarla con lo vencido daría por caducado a quien quizá esté al día.
 */
export function vigenciaDe(fila, { anios = ANIOS_VIGENCIA, hoy = new Date() } = {}) {
  if (!fila.fecha) return { estado: "sin-fecha", vence: null };

  const [anio, mes] = fila.fecha.split("-").map(Number);
  const vence = new Date(Date.UTC(anio + anios, mes - 1, 1));
  const limite = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));

  return {
    estado: vence > limite ? "vigente" : "vencida",
    vence: `${vence.getUTCFullYear()}-${String(vence.getUTCMonth() + 1).padStart(2, "0")}`,
  };
}

// --- quién de la sección trabajó el lote --------------------------------------
//
// El registro firma con el usuario de red —"JRAMOSY"— y el consolidado con el
// nombre completo —"RAMOS YOVERA JOSE ORLANDO"—. No hay una clave común, pero
// el usuario se forma con una regla fija de la empresa: la inicial del primer
// nombre, el primer apellido entero, y la inicial del segundo apellido.
//
//   RAMOS YOVERA JOSE ORLANDO          -> J + RAMOS + Y      = JRAMOSY
//   ORDINOLA QUISPE MARCO ANTONIO      -> M + ORDINOLA + Q   = MORDINOLAQ
//   AVENDAÑO DE LA CRUZ DELFINA JUANA  -> D + AVENDAÑO + D   = DAVENDAÑOD
//
// La comprobación se hace al revés, desde el usuario, y por eso no hace falta
// saber dónde acaban los apellidos y empiezan los nombres —que en "DE LA CRUZ"
// no es evidente—: se mira que el usuario empiece por una inicial, siga con el
// primer apellido tal cual y acabe con una sola letra, la del segundo. Si algo
// de eso no encaja, no hay emparejamiento: en un expediente es mejor decir "no
// figura" que atribuirle a alguien la calificación de otro.

function sinAcentos(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Si un usuario del registro corresponde a un nombre del consolidado.
 *
 * Devuelve null cuando el nombre no tiene la forma "APELLIDO1 APELLIDO2
 * NOMBRES" con la que se construye el usuario.
 */
export function usuarioCoincide(usuario, nombreCompleto) {
  const u = sinAcentos(usuario).replace(/\s/g, "");
  const palabras = sinAcentos(nombreCompleto).split(" ").filter(Boolean);
  if (u.length < 3 || palabras.length < 3) return false;

  const apellido = palabras[0];
  const cuerpo = u.slice(1);
  if (!cuerpo.startsWith(apellido)) return false;

  // Lo que sobra tras el primer apellido es la inicial del segundo, una sola
  // letra. Más de una letra significa que el usuario no está formado así.
  const cola = cuerpo.slice(apellido.length);
  if (cola.length !== 1 || cola !== palabras[1][0]) return false;

  // Y la primera letra tiene que ser la inicial de alguno de los nombres, que
  // van detrás de los apellidos.
  return palabras.slice(1).some((w) => w[0] === u[0]);
}

// Qué rol del consolidado corresponde a cada sección del registro. El registro
// nombra la operación ("PREPARACION DEL BULK (CONTENIDO)") y el consolidado el
// rol ("FABRICACIÓN"), que es más grueso. El set up no es una operación y
// queda fuera, igual que queda fuera del tiempo de proceso en el resto de la
// aplicación.
const ROL_DE_SECCION = [
  { rol: /^FABRICACI[OÓ]N$/i, seccion: /^(FABRICACION|PREPARACION DEL BULK|PREPARACION DE LA GELATINA|GRANULACION|AMASADO|TAMIZADO|MEZCLA)/i },
  { rol: /^ENCAPSULADO$/i, seccion: /^ENCAPSULADO/i },
  { rol: /^INSPECCI[OÓ]N$/i, seccion: /^INSPECCION/i },
  { rol: /^ENVASE/i, seccion: /^ENVASE|BLISTER/i },
  { rol: /^SECADO/i, seccion: /^SECADO/i },
  { rol: /^ACONDICIONADO/i, seccion: /^ACONDICIONADO|IMPRESION DE CAJAS/i },
];

const SECCION_SIN_OPERACION = /^(SET\s*UP|DOCUMENTACI[OÓ]N)/i;

/** Las secciones del registro en las que firmó un usuario. */
function seccionesDe(documentos, usuario) {
  const vistas = new Set();
  for (const doc of documentos || []) {
    for (const [seccion, suyos] of Object.entries(doc.personnel?.porSeccion || {})) {
      if (SECCION_SIN_OPERACION.test(seccion)) continue;
      const gente = [...(suyos.operarios || []), ...(suyos.supervisores || [])];
      if (gente.some((p) => sinAcentos(p.name).replace(/\s/g, "") === sinAcentos(usuario).replace(/\s/g, ""))) {
        vistas.add(seccion);
      }
    }
  }
  return [...vistas];
}

/** Todos los usuarios que firmaron algo en los registros cargados. */
export function usuariosDelRegistro(documentos) {
  const vistos = new Set();
  for (const doc of documentos || []) {
    for (const p of doc.personnel?.operarios || []) vistos.add(p.name);
    for (const p of doc.personnel?.supervisores || []) vistos.add(p.name);
  }
  return [...vistos].sort();
}

/**
 * Cruza el personal de una sección con quien firmó los registros del lote.
 *
 * A cada fila (persona y rol) le añade:
 *   - `intervino`: la persona firmó algo en el lote;
 *   - `intervinoEnElRol`: firmó precisamente en una operación de ESE rol, que
 *     es la pregunta que de verdad importa —¿estaba calificado para lo que
 *     hizo?—;
 *   - `usuario` y `secciones`: de dónde sale la marca, para poder revisarla.
 *
 * Y devuelve aparte `sinConsolidado`: los usuarios que firmaron el registro y
 * no figuran en esta sección del consolidado. No se afirma que no estén
 * calificados —pueden ser de otra sección, y los supervisores a menudo lo
 * son—: se dice que aquí no constan, que es lo que se puede sostener.
 */
export function cruzarConRegistro(personal, documentos) {
  const usuarios = usuariosDelRegistro(documentos);

  // Un usuario que encajara con dos nombres no se atribuye a ninguno: antes
  // sin marca que con la marca en la persona equivocada.
  const dueño = new Map();
  for (const usuario of usuarios) {
    const candidatos = [...new Set(personal.map((p) => p.nombre))].filter((n) => usuarioCoincide(usuario, n));
    if (candidatos.length === 1) dueño.set(usuario, candidatos[0]);
  }

  const porNombre = new Map();
  for (const [usuario, nombre] of dueño) porNombre.set(nombre, usuario);

  const filas = personal.map((p) => {
    const usuario = porNombre.get(p.nombre) || null;
    const secciones = usuario ? seccionesDe(documentos, usuario) : [];
    const intervinoEnElRol = secciones.some((s) =>
      ROL_DE_SECCION.some((r) => r.rol.test(p.rol) && r.seccion.test(s))
    );
    return { ...p, usuario, intervino: Boolean(usuario), secciones, intervinoEnElRol };
  });

  const sinConsolidado = usuarios.filter((u) => !dueño.has(u));
  return { filas, sinConsolidado };
}

// --- el orden del proceso ------------------------------------------------
//
// El Formato 8 se lee de principio a fin del proceso: empieza en fabricación
// y acaba en acondicionado, con lo que haya en medio. El consolidado no trae
// ese orden por ningún lado —sus hojas están por sección y sus filas por
// apellido— así que va escrito aquí.
//
// Se compara por el principio del rol, que es lo que permite que "FABRICACIÓN
// 01" a "FABRICACIÓN 04" y "ENVASE 01" a "ENVASE 06" caigan con los suyos sin
// enumerarlos, y que "ACONDICIONDAO" —una errata del propio libro— caiga con
// acondicionado.
const ORDEN_DEL_PROCESO = [
  /^(DISPENSACI[OÓ]N|PREPARACI[OÓ]N DE MATERIALES)/,
  /^(LAVADO|DESCONTAMINACI[OÓ]N)/,
  /^FABRICACI[OÓ]N/,
  /^(MEZCLA|LUBRICACI[OÓ]N)/,
  /^GRANULACI[OÓ]N/,
  /^(TABLETEADO|COMPRESI[OÓ]N)/,
  /^RECUBRIMIENTO/,
  /^ENCAPSULADO/,
  /^PRE\s*-?\s*SECADO/,
  /^SECADO/,
  /^FILTRACI[OÓ]N/,
  /^INSPECCI[OÓ]N/,
  /^ENSOBRADO/,
  /^ENVASE/,
  /^FOLIADO/,
  /^CODIFICADO/,
];

// Acondicionado va el último, siempre. Lo que no sea una etapa reconocible
// —monitoreo, soporte de línea, ropería, volante interno— se queda justo
// antes: dejarlo detrás rompería la regla de que el cuadro acaba en
// acondicionado, y no hay forma de ordenar un rol de apoyo dentro del proceso
// sin inventarse dónde va.
const ACONDICIONADO = /^ACONDICION/;

/** En qué lugar del proceso va un rol. Cuanto menor, antes. */
export function ordenDeRol(rol) {
  const nombre = sinAcentos(rol);
  if (ACONDICIONADO.test(nombre)) return ORDEN_DEL_PROCESO.length + 1;
  const i = ORDEN_DEL_PROCESO.findIndex((re) => re.test(nombre));
  return i === -1 ? ORDEN_DEL_PROCESO.length : i;
}

/**
 * Ordena las filas como se recorre el proceso.
 *
 * Primero por sección —que es como se agrupa el cuadro—, y dentro de cada una
 * por la etapa del rol. Una persona con varios roles queda junta: se la sitúa
 * por el más temprano de los suyos, que es como está hecho el Formato 8 que
 * ya emitieron a mano (Avendaño aparece bajo Fabricación, y debajo su
 * Inspección).
 *
 * Las secciones se ordenan por el rol que tiene la mayoría de su gente: una
 * sección es lo que hace casi toda su gente, y así acondicionado queda al
 * final aunque alguno de los suyos aparezca además envasando.
 */
export function ordenarPorEtapa(personal) {
  const filas = [...personal];

  const primerRol = new Map();
  for (const p of filas) {
    const clave = `${p.seccion ?? ""}|${p.nombre}`;
    const orden = ordenDeRol(p.rol);
    if (!primerRol.has(clave) || orden < primerRol.get(clave)) primerRol.set(clave, orden);
  }

  const votos = new Map();
  for (const p of filas) {
    const seccion = p.seccion ?? "";
    if (!votos.has(seccion)) votos.set(seccion, new Map());
    const cuenta = votos.get(seccion);
    const orden = ordenDeRol(p.rol);
    cuenta.set(orden, (cuenta.get(orden) || 0) + 1);
  }
  const ordenDeSeccion = new Map();
  for (const [seccion, cuenta] of votos) {
    const [mayoria] = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    ordenDeSeccion.set(seccion, mayoria);
  }

  // El orden original desempata, para que dos filas iguales no se muevan de
  // sitio entre una carga y otra.
  const posicion = new Map(filas.map((p, i) => [p, i]));

  return filas.sort((a, b) => {
    const sa = a.seccion ?? "";
    const sb = b.seccion ?? "";
    if (sa !== sb) {
      const d = ordenDeSeccion.get(sa) - ordenDeSeccion.get(sb);
      if (d !== 0) return d;
      return sa.localeCompare(sb);
    }
    const pa = primerRol.get(`${sa}|${a.nombre}`);
    const pb = primerRol.get(`${sb}|${b.nombre}`);
    if (pa !== pb) return pa - pb;
    if (a.nombre !== b.nombre) return a.nombre.localeCompare(b.nombre);
    const d = ordenDeRol(a.rol) - ordenDeRol(b.rol);
    return d !== 0 ? d : posicion.get(a) - posicion.get(b);
  });
}

/** Los roles distintos de una sección, en orden alfabético. */
export function rolesDe(seccion) {
  // En el orden del proceso, no alfabético: las pastillas se leen igual que
  // el cuadro que producen.
  return [...new Set((seccion?.personal || []).map((p) => p.rol))].sort(
    (a, b) => ordenDeRol(a) - ordenDeRol(b) || a.localeCompare(b)
  );
}

/**
 * A qué sección del consolidado pertenece lo que se analizó.
 *
 * Los equipos del registro llevan el prefijo de su sección en el código MIF
 * ("CBL-E010", "CBL-BAL-01"), que es la pista más firme porque es un código,
 * no un texto escrito a mano. Si no hay equipos, se prueba con el nombre que
 * el propio registro da a la sección.
 */
export function seccionDe(documentos, secciones) {
  const nombres = (secciones || []).filter((s) => !s.cesados).map((s) => s.seccion);
  if (nombres.length === 0) return null;

  const prefijos = new Map();
  for (const doc of documentos || []) {
    for (const e of doc.equipos || []) {
      const m = String(e.codigoMif || "").match(/^([A-Z]{2,4})-/);
      if (m) prefijos.set(m[1], (prefijos.get(m[1]) || 0) + 1);
    }
  }

  const masVisto = [...prefijos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (masVisto) {
    const porCodigo = nombres.find((n) => norm(n) === norm(masVisto));
    if (porCodigo) return porCodigo;
  }

  // Sin equipos que delaten la sección, el registro la nombra en una de sus
  // casillas ("SECCION: CAPSULAS BLANDAS").
  for (const doc of documentos || []) {
    for (const p of doc.params || []) {
      if (!/^SECCION$/i.test(p.baseLabel || p.label || "")) continue;
      const valor = norm(p.value);
      const porNombre = nombres.find((n) => valor.startsWith(norm(n)) || norm(n).startsWith(valor));
      if (porNombre) return porNombre;
    }
  }

  return null;
}

// --- lo leído, guardado en este navegador ------------------------------------
//
// El consolidado se actualiza cada cierto tiempo y hay que volver a subirlo,
// pero no en cada recarga de la página. Se guarda lo ya leído —que son unos
// pocos miles de filas de texto, no el libro de 2,5 MB— para que el Formato 8
// esté listo al abrir la aplicación.

const CLAVE_LOCAL = "deteccion-parametros:personal:v1";

export function guardarPersonalLocal(libro) {
  try {
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(libro));
    return true;
  } catch {
    // No cabe: sólo significa volver a subirlo en la próxima sesión.
    return false;
  }
}

export function cargarPersonalLocal() {
  try {
    const raw = localStorage.getItem(CLAVE_LOCAL);
    const leido = raw ? JSON.parse(raw) : null;
    return Array.isArray(leido?.secciones) ? leido : null;
  } catch {
    return null;
  }
}

export function olvidarPersonalLocal() {
  try {
    localStorage.removeItem(CLAVE_LOCAL);
  } catch {
    // Nada que hacer: se queda hasta la próxima carga.
  }
}

// --- el consolidado guardado de verdad --------------------------------------
//
// Guardarlo sólo en este navegador no basta: se pierde al limpiar los datos
// del sitio, no está en la computadora de al lado, y obliga a volver a subir
// un libro que no ha cambiado. Subirlo es y sigue siendo manual —se hace
// cuando el consolidado se actualiza—, pero una vez subido se queda.
//
// Hay uno solo: el consolidado de calificación no es de un producto ni de un
// lote, así que la tabla guarda una única fila y cada carga nueva reemplaza a
// la anterior. La tabla la crea supabase_migration_v15.sql.

const CLAVE_UNICA = "personal";

/** Trae de Supabase el consolidado guardado, o null si no hay ninguno. */
export async function cargarPersonalRemoto() {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase
    .from("personal_calificacion")
    .select("personal")
    .eq("clave", CLAVE_UNICA)
    .maybeSingle();

  if (error || !data?.personal) return null;
  const guardado = data.personal;
  return Array.isArray(guardado?.secciones) ? guardado : null;
}

/** Guarda (o reemplaza) el consolidado para todas las sesiones. */
export async function guardarPersonalRemoto(libro) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase
    .from("personal_calificacion")
    .upsert({ clave: CLAVE_UNICA, personal: libro }, { onConflict: "clave" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Lo borra de la nube: quitarlo aquí debe quitarlo en todas partes. */
export async function borrarPersonalRemoto() {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase.from("personal_calificacion").delete().eq("clave", CLAVE_UNICA);
  return error ? { ok: false, error: error.message } : { ok: true };
}
