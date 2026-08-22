#!/usr/bin/env node
//
// Descarga desde SAP Fiori los RMD y las órdenes de una lista de lotes, para
// no tener que bajarlos uno a uno antes de analizarlos.
//
// Dos ideas gobiernan el diseño:
//
//  1. La sesión es tuya. El script nunca pide ni guarda tu usuario y
//     contraseña: abre un Chrome normal con un perfil propio, tú inicias
//     sesión a mano la primera vez (con SSO o el segundo factor si lo hay) y
//     esa sesión queda guardada en la carpeta del perfil. Nada sale de tu
//     computadora.
//
//  2. La navegación se aprende, no se adivina. Cada instalación de SAP
//     coloca sus aplicaciones y sus botones en sitios distintos, así que el
//     modo "aprender" te mira hacer UNA descarga y deduce de ahí cómo
//     repetirla para los demás lotes.
//
// Uso:
//   node descargar.mjs aprender     una vez, para enseñarle el camino
//   node descargar.mjs descargar    ya con la lista de lotes

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import readline from "readline/promises";
import { fileURLToPath } from "url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RUTA_CONFIG = path.join(AQUI, "config.json");
const RUTA_EJEMPLO = path.join(AQUI, "config.ejemplo.json");
const RUTA_LOTES = path.join(AQUI, "lotes.txt");
const MARCA_LOTE = "{LOTE}";

// Playwright se carga sólo cuando de verdad se va a abrir el navegador: así
// la ayuda y los avisos de configuración funcionan antes de instalar nada, en
// vez de reventar con un error de módulo no encontrado.
async function cargarNavegador() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    console.error("Falta instalar Playwright. Desde esta carpeta, ejecuta:\n");
    console.error("  npm install");
    console.error("  npm run instalar-navegador\n");
    process.exit(1);
  }
}

// Una sola interfaz de lectura para todo el programa: abrir y cerrar una por
// pregunta deja la entrada en un estado del que la siguiente ya no se
// recupera, y el script se queda colgado sin decir nada.
let lector = null;
function preguntador() {
  if (!lector) lector = readline.createInterface({ input: process.stdin, output: process.stdout });
  return lector;
}

async function preguntar(texto) {
  const respuesta = await preguntador().question(texto);
  return respuesta.trim();
}

function cerrarPreguntas() {
  lector?.close();
  lector = null;
}

/**
 * Devuelve la configuración, creándola la primera vez y preguntando la
 * dirección de SAP si todavía no está puesta. Así no hay que copiar ni editar
 * ningún archivo a mano: todo se responde en la propia ventana.
 */
async function leerConfig() {
  if (!existsSync(RUTA_CONFIG)) {
    await writeFile(RUTA_CONFIG, await readFile(RUTA_EJEMPLO, "utf8"), "utf8");
  }

  const config = JSON.parse(await readFile(RUTA_CONFIG, "utf8"));

  if (!config.urlInicio || /PON-AQUI/i.test(config.urlInicio)) {
    console.log("\nAntes de empezar necesito saber por dónde entras a SAP.");
    console.log("Abre SAP en tu navegador como siempre y copia la dirección de la barra de arriba.\n");

    let url = "";
    while (!/^https?:\/\//i.test(url)) {
      url = await preguntar("Pega aquí la dirección de SAP: ");
      if (!/^https?:\/\//i.test(url)) console.log("  Tiene que empezar por http:// o https://. Inténtalo otra vez.");
    }

    config.urlInicio = url;
    await guardarConfig(config);
    console.log("  Guardada. No te la volveré a pedir.\n");
  }

  return config;
}

async function guardarConfig(config) {
  await writeFile(RUTA_CONFIG, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function leerLotes() {
  if (!existsSync(RUTA_LOTES)) return [];
  const texto = await readFile(RUTA_LOTES, "utf8");
  return texto
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

/** Abre el navegador con el perfil persistente, donde vive la sesión de SAP. */
async function abrirNavegador(config) {
  const chromium = await cargarNavegador();
  const perfil = path.resolve(AQUI, config.perfilNavegador || ".perfil-sap");
  const descargas = path.resolve(AQUI, config.carpetaSalida || "descargas");
  await mkdir(descargas, { recursive: true });

  let contexto;
  try {
    contexto = await chromium.launchPersistentContext(perfil, {
      headless: false, // tienes que poder iniciar sesión y ver qué pasa
      acceptDownloads: true,
      viewport: null,
      args: ["--start-maximized"],
    });
  } catch (err) {
    const detalle = err.message.split("\n")[0];

    // Puede estar la librería instalada pero faltar el navegador que usa:
    // son dos descargas distintas y una puede quedarse a medias.
    if (/Executable doesn't exist|playwright install/i.test(err.message)) {
      console.error("\nFalta el navegador que usa el script (es una descarga aparte de la librería).");
      console.error("Vuelve a abrir 1-APRENDER.bat: ahora lo instala solo.\n");
      console.error("Si aun así falla, ejecuta desde esta carpeta:  npx playwright install chromium\n");
      process.exit(1);
    }

    console.error("\nNo se pudo abrir el navegador.");
    console.error(`  ${detalle}\n`);
    if (/spawn|EPERM|EACCES/i.test(detalle)) {
      console.error("Ese mensaje suele venir del antivirus, de permisos, o de que ya hay");
      console.error("otra ventana del script abierta usando el mismo perfil.");
      console.error("Cierra las ventanas que hayan quedado y vuelve a intentarlo.\n");
    }
    console.error("Si sigue sin funcionar, cópiame este texto.\n");
    process.exit(1);
  }

  return { contexto, descargas };
}

/** Espera a que confirmes que ya estás dentro de SAP. */
async function esperarSesion(page, config) {
  await page.goto(config.urlInicio, { waitUntil: "domcontentloaded" }).catch(() => {});
  console.log("\nSe abrió SAP en el navegador.");
  console.log("Si te pide credenciales, inicia sesión ahora (queda guardada para las próximas veces).");
  await preguntar("Cuando veas tu pantalla de inicio de SAP, pulsa Enter aquí… ");
}

// --------------------------------------------------------------- aprender ---

async function modoAprender() {
  const config = await leerConfig();
  const { contexto, descargas } = await abrirNavegador(config);
  const page = contexto.pages()[0] || (await contexto.newPage());

  await esperarSesion(page, config);

  const lote = await preguntar("\n¿Qué lote vas a descargar ahora, exactamente como lo escribes en SAP? ");
  if (!lote) {
    console.error("Sin lote no puedo reconocer el patrón. Cancelo.");
    await contexto.close();
    process.exit(1);
  }

  console.log("\nAhora descarga ESE lote a mano, como haces siempre. Te estoy mirando…\n");

  const capturas = [];

  // Una descarga de verdad (el navegador dispara el evento "download").
  contexto.on("page", (p) => vigilar(p));
  vigilar(page);

  function vigilar(p) {
    p.on("download", async (d) => {
      capturas.push({ tipo: "descarga", url: d.url(), archivo: d.suggestedFilename() });
      console.log(`  · descarga detectada: ${d.suggestedFilename()}`);
    });
    // Algunos Fiori muestran el PDF incrustado en vez de descargarlo.
    p.on("response", async (r) => {
      const tipo = (r.headers()["content-type"] || "").toLowerCase();
      if (tipo.includes("pdf")) {
        capturas.push({ tipo: "respuesta", url: r.url(), metodo: r.request().method() });
        console.log(`  · PDF servido en: ${r.url().slice(0, 110)}`);
      }
    });
  }

  await preguntar("Cuando el PDF se haya descargado (o abierto), pulsa Enter aquí… ");

  if (capturas.length === 0) {
    console.error("\nNo detecté ningún PDF. Puede que SAP lo genere en una ventana aparte.");
    console.error("Vuelve a intentarlo, y si sigue sin verse, cuéntame cómo es la pantalla.");
    await contexto.close();
    process.exit(1);
  }

  // Se prefiere una descarga real; si no la hubo, vale la respuesta PDF.
  const elegida = capturas.find((c) => c.tipo === "descarga") || capturas[0];
  console.log(`\nURL usada:\n  ${elegida.url}`);

  if (!elegida.url.includes(lote)) {
    console.log(`\nEsa URL no contiene el lote "${lote}".`);
    console.log("Significa que SAP no identifica el documento por la dirección, sino por el estado de la sesión.");
    console.log("La descarga directa no va a servir: hay que guiar la interfaz paso a paso.");
    console.log("Pásame esta URL y una captura de la pantalla de búsqueda y te preparo ese modo.");
    config.patronUrl = null;
    config.urlEjemplo = elegida.url;
    await guardarConfig(config);
    await contexto.close();
    return;
  }

  const patron = elegida.url.split(lote).join(MARCA_LOTE);
  config.patronUrl = patron;
  config.urlEjemplo = elegida.url;
  await guardarConfig(config);

  console.log(`\nPatrón aprendido y guardado en config.json:\n  ${patron}`);
  console.log("\nYa puedes escribir tus lotes en lotes.txt y ejecutar:  node descargar.mjs descargar");
  if ((elegida.metodo || "GET") !== "GET") {
    console.log(`\nAviso: la petición era ${elegida.metodo}, no GET. Si la descarga masiva falla, avísame.`);
  }

  await contexto.close();
}

// --------------------------------------------------------------- explorar ---

// Lo que se extrae de cada marco de la pantalla. Sólo estructura: qué campos,
// botones y columnas hay y cómo referirse a ellos. No se vuelca el contenido
// de la tabla.
const RECONOCER_PANTALLA = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const texto = (el) => (el.innerText || el.textContent || "").trim().slice(0, 60);

  const campos = [...document.querySelectorAll("input, textarea, select")]
    .filter(visible)
    .slice(0, 60)
    .map((el) => ({
      etiqueta: el.title || el.getAttribute("aria-label") || "",
      id: el.id || "",
      name: el.getAttribute("name") || "",
      tipo: el.type || el.tagName.toLowerCase(),
      valor: (el.value || "").slice(0, 20),
    }));

  const botones = [...document.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]")]
    .filter(visible)
    .map((el) => ({ texto: texto(el), titulo: el.title || "", id: el.id || "" }))
    .filter((b) => b.texto || b.titulo)
    .slice(0, 60);

  const tablas = [...document.querySelectorAll("table")].filter(visible).slice(0, 4).map((t) => {
    const filaCab = t.querySelector("tr");
    const cabeceras = filaCab
      ? [...filaCab.children].map((c, i) => ({ i, texto: texto(c) })).filter((c) => c.texto)
      : [];
    return { id: t.id || "", filas: t.rows.length, cabeceras: cabeceras.slice(0, 30) };
  });

  return { titulo: document.title, campos, botones, tablas };
})()`;

// La rejilla de resultados (ALV) no se deja leer con el volcado general: sus
// celdas de icono son enlaces sueltos dentro de una maraña de tablas
// anidadas. Se busca de forma dirigida por el texto de las columnas.
const RECONOCER_REJILLA = `(() => {
  const texto = (el) => (el.innerText || el.textContent || "").trim().slice(0, 40);
  const CLAVES = /Producci|RMD|OP\\b|Almac|Calidad/i;

  // Toda la fila de cabecera que mencione las columnas que interesan.
  const cabeceras = [...document.querySelectorAll("th, td")]
    .filter((c) => CLAVES.test(texto(c)) && texto(c).length < 30)
    .slice(0, 40)
    .map((c) => ({ texto: texto(c), id: c.id || "", clase: (c.className || "").slice(0, 40) }));

  // Cualquier cosa pulsable de la rejilla: los iconos son enlaces o imágenes.
  const pulsables = [...document.querySelectorAll("a, img, area, [onclick]")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .slice(0, 120)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      titulo: el.title || el.getAttribute("alt") || "",
      texto: texto(el),
      href: (el.getAttribute("href") || "").slice(0, 60),
    }))
    .filter((e) => e.id || e.titulo);

  return { cabeceras, pulsables };
})()`;

/** Devuelve el primer selector de la lista que exista en el ámbito dado. */
async function localizar(ambito, candidatos, descripcion) {
  for (const sel of candidatos) {
    const loc = ambito.locator(sel).first();
    if ((await loc.count()) > 0) return { loc, sel };
  }
  throw new Error(`No encontré ${descripcion}. Probé: ${candidatos.join(" | ")}`);
}

const SEL_LOTE = ['input[title="Número de lote"]', 'input[title*="lote" i]', "#M0\\:46\\:\\:\\:3\\:64"];
const SEL_CONSULTA = ['[title="Ejecutar <objeto>"]', "text=Consulta", "#M0\\:46\\:\\:\\:6\\:7"];

/**
 * Vuelca la estructura de la pantalla, para poder escribir los selectores
 * exactos del modo guiado.
 *
 * Hace falta porque el SAP GUI dibujado en el navegador genera
 * identificadores propios ("M0:46:::0:") que no se pueden adivinar desde
 * fuera y que además cambian entre pantallas.
 *
 * De paso hace él mismo la búsqueda del lote: así queda comprobado que los
 * selectores ya conocidos funcionan, en vez de darlos por buenos.
 */
async function modoExplorar() {
  const config = await leerConfig();
  const { contexto } = await abrirNavegador(config);
  const page = contexto.pages()[0] || (await contexto.newPage());

  await page.goto(config.urlInicio, { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log("\n─────────────────────────────────────────────────────");
  console.log(" Espera a que cargue 'Reporte Sobre de Lote Digital'.");
  console.log(" No hace falta que busques nada: lo hago yo.");
  console.log("─────────────────────────────────────────────────────\n");

  const lote = await preguntar("¿Qué lote uso de ejemplo? ");
  await preguntar("Cuando veas la pantalla de búsqueda, pulsa Enter aquí… ");

  const informe = [];
  informe.push(`Explorado el ${new Date().toISOString()}`);

  // --- Se intenta la búsqueda con los selectores ya conocidos --------------
  const marco = page.frames().find((f) => /webgui/i.test(f.url()));
  if (marco && lote) {
    informe.push(`\nMARCO DE LA TRANSACCIÓN: ${marco.name()}`);
    try {
      const campo = await localizar(marco, SEL_LOTE, "el campo del lote");
      await campo.loc.fill(lote);
      informe.push(`  campo del lote  -> OK con  ${campo.sel}`);

      const boton = await localizar(marco, SEL_CONSULTA, "el botón Consulta");
      await boton.loc.click();
      informe.push(`  botón Consulta  -> OK con  ${boton.sel}`);

      await page.waitForTimeout(4000); // que la rejilla termine de pintarse
      console.log("  Búsqueda lanzada. Leyendo la tabla de resultados…\n");
    } catch (err) {
      informe.push(`  FALLO: ${err.message}`);
      console.log(`  No pude buscar solo: ${err.message}`);
      await preguntar("Haz tú la búsqueda y pulsa Enter cuando veas la tabla… ");
    }

    // --- Estructura de la rejilla de resultados ---------------------------
    try {
      // Al pulsar Consulta la transacción repinta el marco entero, así que la
      // referencia anterior ya no vale y hay que volver a buscarlo.
      const marcoActual = page.frames().find((f) => /webgui/i.test(f.url())) || marco;
      const rejilla = await marcoActual.evaluate(RECONOCER_REJILLA);
      informe.push(`\n-- COLUMNAS DE LA REJILLA (${rejilla.cabeceras.length}) --`);
      for (const c of rejilla.cabeceras) informe.push(`  "${c.texto}" id="${c.id}" clase="${c.clase}"`);

      informe.push(`\n-- ELEMENTOS PULSABLES DE LA REJILLA (${rejilla.pulsables.length}) --`);
      for (const p of rejilla.pulsables) {
        informe.push(`  <${p.tag}> id="${p.id}" titulo="${p.titulo}" texto="${p.texto}" href="${p.href}"`);
      }
    } catch (err) {
      informe.push(`\nNo pude leer la rejilla: ${err.message}`);
    }
  }

  for (const frame of page.frames()) {
    let datos;
    try {
      datos = await frame.evaluate(RECONOCER_PANTALLA);
    } catch {
      continue; // marcos de otro dominio, que no se pueden leer
    }
    if (datos.campos.length === 0 && datos.botones.length === 0 && datos.tablas.length === 0) continue;

    informe.push("\n" + "=".repeat(60));
    informe.push(`MARCO: ${frame.name() || "(principal)"}`);
    informe.push(`URL:   ${frame.url().slice(0, 160)}`);
    informe.push(`TÍTULO: ${datos.titulo}`);

    informe.push(`\n-- CAMPOS (${datos.campos.length}) --`);
    for (const c of datos.campos) {
      informe.push(`  etiqueta="${c.etiqueta}" id="${c.id}" name="${c.name}" tipo=${c.tipo} valor="${c.valor}"`);
    }

    informe.push(`\n-- BOTONES (${datos.botones.length}) --`);
    for (const b of datos.botones) {
      informe.push(`  texto="${b.texto}" titulo="${b.titulo}" id="${b.id}"`);
    }

    for (const t of datos.tablas) {
      informe.push(`\n-- TABLA id="${t.id}" (${t.filas} filas) --`);
      for (const c of t.cabeceras) informe.push(`  columna ${c.i}: "${c.texto}"`);
    }
  }

  const destino = path.join(AQUI, "diagnostico.txt");
  await writeFile(destino, informe.join("\n"), "utf8");

  console.log(`\nGuardado en:\n  ${destino}\n`);
  console.log("Ábrelo con el Bloc de notas y cópiame el contenido.");
  console.log("Sólo lleva nombres de campos, botones y columnas — no los datos de la tabla.\n");

  await contexto.close();
}

// ----------------------------------------------------------------- grabar ---

/**
 * Abre SAP con la sesión ya iniciada y el Inspector de Playwright, que va
 * escribiendo el código de cada clic mientras trabajas.
 *
 * Se reutiliza el perfil del paso 1 a propósito: grabar desde una ventana
 * limpia obligaría a teclear la contraseña, y el Inspector la dejaría
 * escrita en texto plano dentro del código generado.
 */
async function modoGrabar() {
  const config = await leerConfig();
  const { contexto } = await abrirNavegador(config);
  const page = contexto.pages()[0] || (await contexto.newPage());

  await page.goto(config.urlInicio, { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log("\nSe abrió SAP y el Inspector de Playwright.");
  console.log("Pulsa 'Record' en el Inspector y haz una descarga completa de un lote.");
  console.log("Al terminar, copia el texto del Inspector y cierra las ventanas.\n");

  // Abre el Inspector adjunto a esta sesión, con el botón de grabar.
  await page.pause();

  await contexto.close();
}

// -------------------------------------------------------------- descargar ---

function nombreArchivo(lote, cabeceras) {
  const disposicion = cabeceras["content-disposition"] || "";
  const m = disposicion.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  const sugerido = m ? decodeURIComponent(m[1].replace(/"$/, "")) : null;
  const limpio = (sugerido || `${lote}.pdf`).replace(/[\\/:*?"<>|]+/g, "_");
  return limpio.toLowerCase().endsWith(".pdf") ? limpio : `${limpio}.pdf`;
}

/**
 * Ejecuta, para un lote, la secuencia de pasos grabada en config.guiado.
 *
 * Hace falta cuando el PDF no tiene una dirección propia —el caso del SAP
 * GUI dibujado en el navegador (ITS WebGUI), donde el documento se genera al
 * vuelo en un sitio temporal ligado a la sesión—. Ahí la única vía es
 * manejar la transacción igual que una persona.
 */
async function ejecutarPasos(page, pasos, lote) {
  const conLote = (t) => String(t ?? "").split(MARCA_LOTE).join(lote);

  // La transacción suele venir dentro de un iframe del launchpad.
  const ambito = (paso) => (paso.marco ? page.frameLocator(paso.marco) : page);

  for (const paso of pasos) {
    switch (paso.accion) {
      case "ir":
        await page.goto(conLote(paso.url), { waitUntil: "domcontentloaded" });
        break;
      case "escribir":
        await ambito(paso).locator(paso.selector).fill(conLote(paso.texto));
        break;
      case "clic":
        await ambito(paso).locator(paso.selector).click();
        break;
      case "pulsar":
        await ambito(paso).locator(paso.selector || "body").press(paso.tecla || "Enter");
        break;
      case "esperar":
        await page.waitForTimeout(paso.ms || 1000);
        break;
      default:
        throw new Error(`Paso desconocido: ${paso.accion}`);
    }
  }
}

async function descargarGuiado(config, lotes, contexto, page, descargas) {
  const pasos = config.guiado?.pasos || [];
  const resultado = { ok: [], fallos: [] };

  for (const lote of lotes) {
    try {
      // La descarga se espera a la vez que se dan los pasos: si se esperara
      // después, el evento ya habría pasado.
      const esperaDescarga = page.waitForEvent("download", { timeout: config.guiado?.esperaMs || 60000 });
      await ejecutarPasos(page, pasos, lote);
      const descarga = await esperaDescarga;

      const nombre = `${lote}_${descarga.suggestedFilename()}`.replace(/[\\/:*?"<>|]+/g, "_");
      const destino = path.join(descargas, nombre);
      await descarga.saveAs(destino);

      resultado.ok.push(lote);
      console.log(`  ✓ ${lote} — ${nombre}`);
    } catch (err) {
      resultado.fallos.push(`${lote}: ${err.message.split("\n")[0]}`);
      console.log(`  ✗ ${lote} — ${err.message.split("\n")[0]}`);
    }
  }

  return resultado;
}

async function modoDescargar() {
  const config = await leerConfig();
  const tieneGuiado = (config.guiado?.pasos || []).length > 0;

  if (!config.patronUrl && !tieneGuiado) {
    console.error("Todavía no sé cómo se descarga en tu SAP.");
    console.error("Abre primero 1-APRENDER.bat y hazme una descarga de ejemplo.");
    process.exit(1);
  }

  const lotes = await leerLotes();
  if (lotes.length === 0) {
    console.error("No hay ningún lote que descargar.");
    console.error(`Abre lotes.txt con el Bloc de notas, escribe un lote por línea, guarda y vuelve a intentarlo.`);
    console.error(`  ${RUTA_LOTES}`);
    process.exit(1);
  }

  const { contexto, descargas } = await abrirNavegador(config);
  const page = contexto.pages()[0] || (await contexto.newPage());
  await esperarSesion(page, config);

  console.log(`\nDescargando ${lotes.length} lote(s) en ${descargas}\n`);

  const resultado = { ok: [], vacios: [], fallos: [] };

  // Cuando el PDF no tiene dirección propia se maneja la transacción paso a
  // paso; si la tiene, basta pedirla, que es mucho más rápido y estable.
  if (tieneGuiado && !config.patronUrl) {
    const r = await descargarGuiado(config, lotes, contexto, page, descargas);
    resultado.ok = r.ok;
    resultado.fallos = r.fallos;
    console.log(`\nListo: ${r.ok.length} descargado(s), ${r.fallos.length} con error.`);
    if (r.ok.length > 0) console.log(`\nArrastra la carpeta "${path.basename(descargas)}" a la aplicación.`);
    if (r.fallos.length > 0) {
      console.log("\nErrores:");
      for (const f of r.fallos) console.log(`  · ${f}`);
    }
    await contexto.close();
    return;
  }

  for (const lote of lotes) {
    const url = config.patronUrl.split(MARCA_LOTE).join(encodeURIComponent(lote));
    try {
      // La petición hereda las cookies del navegador, así que va autenticada.
      const respuesta = await contexto.request.get(url, { timeout: 60000 });

      if (!respuesta.ok()) {
        resultado.fallos.push(`${lote}: HTTP ${respuesta.status()}`);
        console.log(`  ✗ ${lote} — HTTP ${respuesta.status()}`);
        continue;
      }

      const cabeceras = respuesta.headers();
      const cuerpo = await respuesta.body();

      // Si la sesión caducó, SAP devuelve la página de login con estado 200:
      // se detecta porque lo que llega no es un PDF.
      const esPdf =
        (cabeceras["content-type"] || "").toLowerCase().includes("pdf") ||
        cuerpo.subarray(0, 5).toString("latin1") === "%PDF-";

      if (!esPdf) {
        resultado.vacios.push(lote);
        console.log(`  ✗ ${lote} — la respuesta no es un PDF (¿lote inexistente o sesión caducada?)`);
        continue;
      }

      const destino = path.join(descargas, nombreArchivo(lote, cabeceras));
      await writeFile(destino, cuerpo);
      resultado.ok.push(lote);
      console.log(`  ✓ ${lote} — ${path.basename(destino)} (${Math.round(cuerpo.length / 1024)} kB)`);
    } catch (err) {
      resultado.fallos.push(`${lote}: ${err.message}`);
      console.log(`  ✗ ${lote} — ${err.message}`);
    }
  }

  console.log(`\nListo: ${resultado.ok.length} descargado(s), ${resultado.vacios.length} sin PDF, ${resultado.fallos.length} con error.`);
  if (resultado.ok.length > 0) {
    console.log(`\nArrastra la carpeta "${path.basename(descargas)}" a la aplicación para analizarlos.`);
  }
  if (resultado.fallos.length > 0) {
    console.log("\nErrores:");
    for (const f of resultado.fallos) console.log(`  · ${f}`);
  }

  await contexto.close();
}

// ------------------------------------------------------------------ main ---

const modo = process.argv[2];
try {
  if (modo === "aprender") {
    await modoAprender();
  } else if (modo === "explorar") {
    await modoExplorar();
  } else if (modo === "grabar") {
    await modoGrabar();
  } else if (modo === "descargar") {
    await modoDescargar();
  } else {
    console.log("Uso:");
    console.log("  node descargar.mjs aprender     enseñarle a SAP una vez cómo se descarga");
    console.log("  node descargar.mjs explorar     leer la estructura de la pantalla (campos y botones)");
    console.log("  node descargar.mjs grabar       grabar los pasos con el Inspector de Playwright");
    console.log("  node descargar.mjs descargar    bajar todos los lotes de lotes.txt");
    process.exitCode = 1;
  }
} finally {
  cerrarPreguntas();
}
