// Motor de descarga: todo lo que sabe manejar SAP, sin nada de interfaz.
// Lo usan tanto la aplicación con ventana (app.mjs) como la línea de
// órdenes (descargar.mjs).

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RUTA_CONFIG = path.join(AQUI, "config.json");
const RUTA_EJEMPLO = path.join(AQUI, "config.ejemplo.json");

// Nombre del azulejo en la página de inicio de Fiori. Detectarlo evita que
// haya que entrar a mano a la transacción antes de empezar.
const AZULEJO = "Reporte Sobre de Lote Digital";

const SEL_LOTE = ['input[title="Número de lote"]', 'input[title*="lote" i]'];
const SEL_CONSULTA = ['[title="Ejecutar <objeto>"]', "text=Consulta"];

// Columnas de la rejilla con los documentos que interesan.
export const TIPOS = [
  { nombre: "Producción-OP", carpeta: "OP" },
  { nombre: "Producción-RMD", carpeta: "RMD" },
];

// Cl.Orden viene abreviado; se traduce al nombre de etapa que usa el resto
// de la aplicación, para que las carpetas coincidan con lo que ya se ve ahí.
const ETAPAS = { ACON: "ACONDICIONADO", ENVS: "ENVASE", FABR: "FABRICACION" };

const URL_PDF = /\.pdf(\?|$)/i;

// --- utilidades --------------------------------------------------------------

/** Deja un texto utilizable como nombre de carpeta en Windows. */
export function nombreSeguro(texto, porDefecto = "SIN NOMBRE") {
  const limpio = String(texto || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return limpio || porDefecto;
}

/**
 * Un PDF de verdad empieza por "%PDF-" y termina por "%%EOF". El visor pide
 * el archivo por tramos, así que sin esta comprobación se guarda como bueno
 * el primer fragmento de un kilobyte.
 */
export function esPdfCompleto(cuerpo) {
  if (!cuerpo || cuerpo.length < 5000) return false;
  if (cuerpo.subarray(0, 5).toString("latin1") !== "%PDF-") return false;
  return cuerpo.subarray(-1500).toString("latin1").includes("%%EOF");
}

export async function leerConfig() {
  if (!existsSync(RUTA_CONFIG)) {
    await writeFile(RUTA_CONFIG, await readFile(RUTA_EJEMPLO, "utf8"), "utf8");
  }
  return JSON.parse(await readFile(RUTA_CONFIG, "utf8"));
}

export async function guardarConfig(config) {
  await writeFile(RUTA_CONFIG, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function cargarNavegador() {
  const { chromium } = await import("playwright");
  return chromium;
}

/**
 * Si el fallo es que ya no hay navegador con el que trabajar.
 *
 * Cerrar la ventana de SAP a mitad —al terminar una tanda, o porque estorba—
 * es lo más normal del mundo, pero Playwright lo cuenta como un error de
 * programación: "Target page, context or browser has been closed". Reconocerlo
 * permite volver a abrir en vez de dejar la herramienta inservible hasta que
 * se reinicie entera.
 */
export function navegadorCerrado(err) {
  const texto = String(err?.message || err || "");
  return /has been closed|Target closed|Target crashed|browser has disconnected|Protocol error/i.test(texto);
}

/** Si esta sesión sigue sirviendo, o la ventana ya se cerró. */
export function sesionViva(sesion) {
  if (!sesion?.page || !sesion?.contexto) return false;
  try {
    return !sesion.page.isClosed() && sesion.contexto.pages().length > 0;
  } catch {
    return false;
  }
}

export async function abrirNavegador(config) {
  const chromium = await cargarNavegador();
  const perfil = path.resolve(AQUI, config.perfilNavegador || ".perfil-sap");
  const descargas = path.resolve(AQUI, config.carpetaSalida || "descargas");
  await mkdir(descargas, { recursive: true });

  const contexto = await chromium.launchPersistentContext(perfil, {
    headless: false, // hay que poder iniciar sesión y ver qué ocurre
    acceptDownloads: true,
    viewport: null,
    args: ["--start-maximized"],
  });

  return { contexto, descargas };
}

async function localizar(ambito, candidatos, descripcion) {
  for (const sel of candidatos) {
    const loc = ambito.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  throw new Error(`no encuentro ${descripcion}`);
}

const marcoWebGui = (page) => page.frames().find((f) => /webgui/i.test(f.url()));

// --- navegación --------------------------------------------------------------

/**
 * Deja la transacción del reporte lista para buscar.
 *
 * Primero se prueba la dirección directa, que es lo más rápido; si con ella
 * no aparece la transacción —porque el enlace lleve a la página de inicio o
 * la sesión abra ahí— se busca el azulejo por su nombre y se pulsa, para que
 * no haya que entrar a mano.
 */
export async function irAlReporte(page, config, avisar = () => {}) {
  await page.goto(config.urlInicio, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2500);

  if (marcoWebGui(page)) return true;

  avisar(`Buscando el azulejo «${AZULEJO}» en la página de inicio…`);
  const azulejo = page.getByText(AZULEJO, { exact: true }).first();

  if ((await azulejo.count().catch(() => 0)) === 0) {
    throw new Error(`no encuentro «${AZULEJO}» en la página de inicio de SAP`);
  }

  await azulejo.click({ timeout: 15000 });
  for (let i = 0; i < 20 && !marcoWebGui(page); i++) await page.waitForTimeout(1000);

  if (!marcoWebGui(page)) throw new Error("el reporte no terminó de abrirse");
  return true;
}

/** ¿Hay sesión iniciada? Se deduce de que la página no pida credenciales. */
export async function necesitaLogin(page) {
  const campos = await page
    .locator('input[type="password"]')
    .count()
    .catch(() => 0);
  return campos > 0;
}

// --- lectura de la rejilla ---------------------------------------------------

// La rejilla numera sus celdas como "grid#C102#fila,columna": la fila 0 es la
// cabecera y cada fila siguiente una etapa del lote. Se leen los nombres de
// las columnas en vez de fijar su número, y se anota si la celda del
// documento trae icono: cuando no lo trae, ese PDF no está cargado en SAP.
const LEER_REJILLA = `(() => {
  const celdas = [...document.querySelectorAll('[id^="grid#"]')];
  if (celdas.length === 0) return null;

  const partes = celdas[0].id.match(/^(grid#[^#]+#)(\\d+),(\\d+)$/);
  if (!partes) return null;
  const prefijo = partes[1];

  const cabecera = {};
  const filas = new Set();
  for (const c of celdas) {
    const m = c.id.match(/^grid#[^#]+#(\\d+),(\\d+)$/);
    if (!m) continue;
    const fila = Number(m[1]);
    if (fila === 0) {
      const t = (c.innerText || c.textContent || "").trim();
      if (t) cabecera[t] = Number(m[2]);
    } else {
      filas.add(fila);
    }
  }

  const leer = (fila, col) => {
    if (col === undefined) return "";
    const el = document.getElementById(prefijo + fila + "," + col);
    return el ? (el.innerText || el.textContent || "").trim() : "";
  };

  const conIcono = (fila, col) => {
    if (col === undefined) return false;
    const el = document.getElementById(prefijo + fila + "," + col);
    if (!el) return false;
    // El icono es una imagen o un elemento hijo; una celda vacía significa
    // que ese documento no está cargado.
    return el.querySelector("img, span[class*=icon], a") !== null || el.innerHTML.trim().length > 0;
  };

  const datos = [...filas].sort((a, b) => a - b).map((fila) => ({
    fila,
    producto: leer(fila, cabecera["Texto breve de material"]),
    clOrden: leer(fila, cabecera["Cl.Orden"]),
    seccion: leer(fila, cabecera["Sección"]),
    iconos: {
      "Producción-OP": conIcono(fila, cabecera["Producción-OP"]),
      "Producción-RMD": conIcono(fila, cabecera["Producción-RMD"]),
    },
  }));

  return { prefijo, cabecera, datos };
})()`;

// --- visor -------------------------------------------------------------------

async function hayVisorAbierto(marco) {
  if (!marco) return false;
  return (
    (await marco
      .locator('embed[type*="pdf"], object[type*="pdf"], iframe[src*=".pdf"]')
      .count()
      .catch(() => 0)) > 0
  );
}

/** Cierra la ventana del visor y comprueba que se cerró de verdad. */
async function cerrarVisor(marco, page) {
  if (!(await hayVisorAbierto(marco))) return true;

  for (const sel of ['button:has-text("OK")', '[title="Cancelar"]', '[title="Cerrar"]', 'text="OK"']) {
    for (const ambito of [marco, page]) {
      const loc = ambito.locator(sel).last();
      if ((await loc.count().catch(() => 0)) === 0) continue;
      await loc.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(700);
      if (!(await hayVisorAbierto(marco))) return true;
    }
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(700);
  return !(await hayVisorAbierto(marco));
}

// --- descarga de un lote -----------------------------------------------------

/**
 * Busca un lote y baja los PDF de todas sus etapas.
 *
 * Los archivos se ordenan en carpetas producto / etapa / tipo, que es como
 * se consultan después. Devuelve una lista de resultados con el estado de
 * cada documento: descargado, no cargado en SAP, o con error.
 */
/**
 * Las muestras médicas se reconocen por las dos emes mayúsculas seguidas de
 * su descripción ("CJA FLUIBRONCOL ORAL 600 GRNx2MM LTM"). Se compara
 * respetando mayúsculas: "48mm" y "200 mm/s" son medidas, no muestras.
 */
export function esMuestraMedica(texto) {
  return /MM/.test(String(texto || ""));
}

export async function descargarLote(
  page,
  contexto,
  lote,
  raiz,
  config,
  avisar = () => {},
  alResultado = () => {},
  { omitirMM = false } = {}
) {
  // Cada documento se anuncia en cuanto se resuelve, no al final del lote:
  // una tanda tarda cerca de un minuto por lote y, sin esto, la pantalla se
  // queda sin novedades el tiempo suficiente para parecer colgada.
  const resultados = {
    lista: [],
    push(fila) {
      this.lista.push(fila);
      alResultado(fila);
    },
  };
  let marco = marcoWebGui(page);
  if (!marco) throw new Error("la transacción no está abierta");

  const campo = await localizar(marco, SEL_LOTE, "el campo del lote");
  await campo.fill(lote);
  const consulta = await localizar(marco, SEL_CONSULTA, "el botón Consulta");
  await consulta.click();

  await page.waitForTimeout(config.reporteLote?.esperaRejillaMs || 5000);
  marco = marcoWebGui(page);
  if (!marco) throw new Error("la transacción desapareció al consultar");

  const rejilla = await marco.evaluate(LEER_REJILLA);
  if (!rejilla || rejilla.datos.length === 0) {
    throw new Error("la búsqueda no devolvió ninguna etapa");
  }

  for (const fila of rejilla.datos) {
    const producto = nombreSeguro(fila.producto, "PRODUCTO SIN NOMBRE");
    const etapa = nombreSeguro(ETAPAS[fila.clOrden] || fila.clOrden || fila.seccion, "SIN ETAPA");

    // Se descarta antes de abrir ningún PDF, que es donde está el tiempo.
    if (omitirMM && esMuestraMedica(fila.producto)) {
      avisar(`${lote} · ${etapa}: muestra médica (MM), omitida`);
      resultados.push({ lote, producto, etapa, tipo: "—", estado: "omitido", detalle: "muestra médica (MM)" });
      continue;
    }

    for (const tipo of TIPOS) {
      const col = rejilla.cabecera[tipo.nombre];
      const base = { lote, producto, etapa, tipo: tipo.carpeta };

      if (col === undefined) {
        resultados.push({ ...base, estado: "falta", detalle: `la columna ${tipo.nombre} no está en el reporte` });
        continue;
      }

      // Celda sin icono: el documento no está cargado en SAP. Se anota sin
      // pulsar, que ahorra la espera completa por cada hueco.
      if (!fila.iconos[tipo.nombre]) {
        // Sin detalle: la propia etiqueta ya dice que no está en SAP.
        resultados.push({ ...base, estado: "falta", detalle: "" });
        avisar(`${lote} · ${etapa} · ${tipo.carpeta}: no está cargado en SAP`);
        continue;
      }

      if (!(await cerrarVisor(marcoWebGui(page) || marco, page))) {
        throw new Error("no consigo cerrar la ventana del visor");
      }

      const celda = (marcoWebGui(page) || marco).locator(`[id="${rejilla.prefijo}${fila.fila},${col}"]`);
      if ((await celda.count().catch(() => 0)) === 0) {
        // Sin detalle: la propia etiqueta ya dice que no está en SAP.
        resultados.push({ ...base, estado: "falta", detalle: "" });
        continue;
      }

      // El .catch() se pone al crear la promesa, no al esperarla: si el clic
      // falla antes, quedaría un rechazo sin recoger y eso tumba el proceso.
      const esperaPdf = page
        .waitForResponse((r) => URL_PDF.test(r.url()), { timeout: config.reporteLote?.esperaPdfMs || 45000 })
        .catch(() => null);

      const clic = await celda.click({ timeout: 15000 }).then(
        () => true,
        () => false
      );
      const respuesta = clic ? await esperaPdf : null;

      if (!respuesta) {
        resultados.push({ ...base, estado: "falta", detalle: "el icono no abrió ningún PDF" });
        avisar(`${lote} · ${etapa} · ${tipo.carpeta}: no abrió ningún PDF`);
        await cerrarVisor(marcoWebGui(page) || marco, page);
        continue;
      }

      // El visor pide el PDF por tramos, así que la respuesta visible puede
      // ser sólo un trozo: se vuelve a pedir entero con la misma sesión.
      let cuerpo = null;
      try {
        cuerpo = await (await contexto.request.get(respuesta.url(), { timeout: 60000 })).body();
      } catch {
        cuerpo = await respuesta.body().catch(() => null);
      }

      if (!esPdfCompleto(cuerpo)) {
        resultados.push({ ...base, estado: "error", detalle: "lo descargado no era un PDF completo" });
        await cerrarVisor(marcoWebGui(page) || marco, page);
        continue;
      }

      const carpeta = path.join(raiz, producto, etapa, tipo.carpeta);
      await mkdir(carpeta, { recursive: true });
      const archivo = `${lote}_${etapa}_${tipo.carpeta}.pdf`;
      await writeFile(path.join(carpeta, archivo), cuerpo);

      resultados.push({
        ...base,
        estado: "ok",
        detalle: `${Math.round(cuerpo.length / 1024)} kB`,
        ruta: path.join(producto, etapa, tipo.carpeta, archivo),
      });
      avisar(`${lote} · ${etapa} · ${tipo.carpeta}: descargado`);

      await cerrarVisor(marcoWebGui(page) || marco, page);
    }
  }

  return resultados.lista;
}

/** Separa el texto pegado por el usuario en una lista de lotes. */
export function parsearLotes(texto) {
  return [
    ...new Set(
      String(texto || "")
        .split(/[\s,;]+/)
        .map((l) => l.replace(/#.*$/, "").trim())
        .filter(Boolean)
    ),
  ];
}
