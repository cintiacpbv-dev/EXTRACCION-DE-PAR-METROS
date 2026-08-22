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

async function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = await rl.question(texto);
  rl.close();
  return respuesta.trim();
}

async function leerConfig() {
  if (!existsSync(RUTA_CONFIG)) {
    console.error(`No encuentro ${RUTA_CONFIG}. Copia config.ejemplo.json a config.json y pon la dirección de tu SAP.`);
    process.exit(1);
  }
  return JSON.parse(await readFile(RUTA_CONFIG, "utf8"));
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

  const contexto = await chromium.launchPersistentContext(perfil, {
    headless: false, // tienes que poder iniciar sesión y ver qué pasa
    acceptDownloads: true,
    viewport: null,
    args: ["--start-maximized"],
  });

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

// -------------------------------------------------------------- descargar ---

function nombreArchivo(lote, cabeceras) {
  const disposicion = cabeceras["content-disposition"] || "";
  const m = disposicion.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  const sugerido = m ? decodeURIComponent(m[1].replace(/"$/, "")) : null;
  const limpio = (sugerido || `${lote}.pdf`).replace(/[\\/:*?"<>|]+/g, "_");
  return limpio.toLowerCase().endsWith(".pdf") ? limpio : `${limpio}.pdf`;
}

async function modoDescargar() {
  const config = await leerConfig();

  if (!config.patronUrl) {
    console.error("Todavía no sé cómo descargar. Ejecuta primero:  node descargar.mjs aprender");
    process.exit(1);
  }

  const lotes = await leerLotes();
  if (lotes.length === 0) {
    console.error(`Escribe un lote por línea en ${RUTA_LOTES} y vuelve a intentarlo.`);
    process.exit(1);
  }

  const { contexto, descargas } = await abrirNavegador(config);
  const page = contexto.pages()[0] || (await contexto.newPage());
  await esperarSesion(page, config);

  console.log(`\nDescargando ${lotes.length} lote(s) en ${descargas}\n`);

  const resultado = { ok: [], vacios: [], fallos: [] };

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
if (modo === "aprender") {
  await modoAprender();
} else if (modo === "descargar") {
  await modoDescargar();
} else {
  console.log("Uso:");
  console.log("  node descargar.mjs aprender     enseñarle a SAP una vez cómo se descarga");
  console.log("  node descargar.mjs descargar    bajar todos los lotes de lotes.txt");
  process.exit(1);
}
