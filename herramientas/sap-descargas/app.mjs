// Aplicación con ventana para descargar lotes desde SAP.
//
// Levanta un servidor diminuto en esta misma computadora y abre la interfaz
// en el navegador. Se usa el servidor http que trae Node en vez de un marco
// de escritorio para no añadir cientos de megabytes de dependencias a una
// herramienta que sólo hace esto.

import http from "http";
import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import { exec } from "child_process";
import {
  AQUI,
  leerConfig,
  guardarConfig,
  abrirNavegador,
  irAlReporte,
  necesitaLogin,
  descargarLote,
  parsearLotes,
} from "./nucleo.mjs";

const PUERTO_BASE = 4599;

// Estado de la tanda en curso, que la interfaz consulta cada segundo.
const estado = {
  fase: "inicio", // inicio | esperandoLogin | listo | descargando | terminado | error
  mensaje: "",
  lotes: [],
  actual: null,
  indice: 0, // qué lote se está haciendo, para poder decir "3 de 10"
  resultados: [],
  carpeta: "",
  error: null,
};

let sesion = null; // { contexto, page, descargas, config }

function avisar(texto) {
  estado.mensaje = texto;
  console.log(`  ${texto}`);
}

// --- preparación del navegador ----------------------------------------------

async function prepararSesion() {
  if (sesion) return sesion;

  const config = await leerConfig();
  if (!config.urlInicio || /PON-AQUI/i.test(config.urlInicio)) {
    throw new Error("Falta la dirección de SAP. Ábrela una vez con 1-APRENDER.bat.");
  }

  estado.fase = "esperandoLogin";
  avisar("Abriendo SAP…");

  const { contexto, descargas } = await abrirNavegador(config);
  const page = contexto.pages()[0] || (await contexto.newPage());
  await page.goto(config.urlInicio, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(2500);

  if (await necesitaLogin(page)) {
    avisar("Inicia sesión en la ventana de SAP que se abrió. Te espero.");
    // Se espera hasta que el usuario entre; sin límite, porque puede tener
    // que resolver un segundo factor.
    for (let i = 0; i < 600; i++) {
      await page.waitForTimeout(1000);
      if (!(await necesitaLogin(page))) break;
    }
  }

  sesion = { contexto, page, descargas, config };
  estado.carpeta = descargas;
  return sesion;
}

// --- tanda de descargas ------------------------------------------------------

async function ejecutarTanda(lotes) {
  estado.resultados = [];
  estado.lotes = lotes;
  estado.indice = 0;
  estado.error = null;

  try {
    const { page, contexto, descargas, config } = await prepararSesion();

    estado.fase = "descargando";
    avisar("Abriendo el reporte…");
    await irAlReporte(page, config, avisar);

    for (const [i, lote] of lotes.entries()) {
      estado.actual = lote;
      estado.indice = i + 1;
      avisar(`Lote ${i + 1} de ${lotes.length}: buscando ${lote}…`);
      try {
        // Cada documento se añade en cuanto se resuelve, para que la
        // pantalla tenga novedades durante el minuto que tarda cada lote.
        await descargarLote(page, contexto, lote, descargas, config, avisar, (fila) =>
          estado.resultados.push(fila)
        );
      } catch (err) {
        estado.resultados.push({
          lote,
          producto: "—",
          etapa: "—",
          tipo: "—",
          estado: "error",
          detalle: err.message.split("\n")[0],
        });
        avisar(`${lote}: ${err.message.split("\n")[0]}`);
      }
      // Se vuelve a la pantalla de búsqueda para el lote siguiente.
      await irAlReporte(page, config, avisar).catch(() => {});
    }

    estado.actual = null;
    estado.fase = "terminado";
    const ok = estado.resultados.filter((r) => r.estado === "ok").length;
    avisar(`Listo: ${ok} documento(s) descargado(s).`);
  } catch (err) {
    estado.fase = "error";
    estado.error = err.message.split("\n")[0];
    avisar(`Error: ${estado.error}`);
  }
}

// --- servidor ----------------------------------------------------------------

// La página de Detección de Parámetros habla con este ayudante desde el
// navegador, así que hay que autorizar su origen. No se abre a cualquiera:
// el servidor sólo escucha en 127.0.0.1 —no es accesible desde la red— y
// además se limita a los orígenes donde vive la aplicación.
const ORIGENES = [/^https?:\/\/localhost(:\d+)?$/i, /^https?:\/\/127\.0\.0\.1(:\d+)?$/i, /^https:\/\/[\w-]+\.vercel\.app$/i, /^https:\/\/[\w-]+\.github\.io$/i];

function permitirOrigen(req, res) {
  const origen = req.headers.origin;
  if (origen && ORIGENES.some((re) => re.test(origen))) {
    res.setHeader("Access-Control-Allow-Origin", origen);
    res.setHeader("Vary", "Origin");
    // Chrome exige esto para que una página pública pueda llamar a un
    // servidor de la red local (Private Network Access).
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, datos, codigo = 200) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(cuerpo);
}

/** Recorre descargas/ y devuelve los PDF con su producto, etapa y tipo. */
async function listarArchivos(raiz) {
  const salida = [];
  const leer = async (dir) => (await readdir(dir, { withFileTypes: true }).catch(() => []));

  for (const producto of await leer(raiz)) {
    if (!producto.isDirectory()) continue;
    for (const etapa of await leer(path.join(raiz, producto.name))) {
      if (!etapa.isDirectory()) continue;
      for (const tipo of await leer(path.join(raiz, producto.name, etapa.name))) {
        if (!tipo.isDirectory()) continue;
        const dir = path.join(raiz, producto.name, etapa.name, tipo.name);
        for (const archivo of await leer(dir)) {
          if (!archivo.isFile() || !archivo.name.toLowerCase().endsWith(".pdf")) continue;
          const info = await stat(path.join(dir, archivo.name)).catch(() => null);
          salida.push({
            producto: producto.name,
            etapa: etapa.name,
            tipo: tipo.name,
            // El lote va al principio del nombre; se devuelve aparte para
            // que la página pueda saber qué está ya analizado.
            lote: archivo.name.split("_")[0],
            nombre: archivo.name,
            ruta: [producto.name, etapa.name, tipo.name, archivo.name].join("/"),
            bytes: info?.size ?? 0,
          });
        }
      }
    }
  }
  return salida;
}

async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return JSON.parse(Buffer.concat(trozos).toString("utf8") || "{}");
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    permitirOrigen(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    // Sirve para que la página sepa si el ayudante está abierto.
    if (url.pathname === "/api/salud") {
      return json(res, { ok: true, app: "sap-descargas", carpeta: estado.carpeta || "" });
    }

    if (url.pathname === "/api/archivos") {
      const config = await leerConfig();
      const raiz = path.resolve(AQUI, config.carpetaSalida || "descargas");
      return json(res, { ok: true, archivos: await listarArchivos(raiz) });
    }

    if (url.pathname === "/api/archivo") {
      const config = await leerConfig();
      const raiz = path.resolve(AQUI, config.carpetaSalida || "descargas");
      const pedida = url.searchParams.get("ruta") || "";

      // Sin esta comprobación, una ruta con ".." dejaría leer cualquier
      // archivo de la computadora a través del servidor.
      const destino = path.resolve(raiz, pedida);
      if (!destino.startsWith(raiz + path.sep) || !destino.toLowerCase().endsWith(".pdf")) {
        return json(res, { ok: false, error: "ruta no permitida" }, 400);
      }

      const cuerpo = await readFile(destino).catch(() => null);
      if (!cuerpo) return json(res, { ok: false, error: "no existe" }, 404);
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": cuerpo.length });
      return res.end(cuerpo);
    }

    if (url.pathname === "/") {
      const html = await readFile(path.join(AQUI, "interfaz.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    if (url.pathname === "/api/estado") return json(res, estado);

    if (url.pathname === "/api/descargar" && req.method === "POST") {
      if (estado.fase === "descargando") return json(res, { ok: false, error: "Ya hay una descarga en curso." }, 409);

      const { lotes: texto } = await leerCuerpo(req);
      const lotes = parsearLotes(texto);
      if (lotes.length === 0) return json(res, { ok: false, error: "No hay ningún lote que descargar." }, 400);

      ejecutarTanda(lotes); // en segundo plano; el avance se consulta aparte
      return json(res, { ok: true, lotes });
    }

    if (url.pathname === "/api/abrir-carpeta" && req.method === "POST") {
      if (estado.carpeta) exec(`explorer "${estado.carpeta}"`);
      return json(res, { ok: true });
    }

    if (url.pathname === "/api/salir" && req.method === "POST") {
      json(res, { ok: true });
      setTimeout(async () => {
        await sesion?.contexto.close().catch(() => {});
        process.exit(0);
      }, 300);
      return;
    }

    res.writeHead(404);
    res.end("no encontrado");
  } catch (err) {
    json(res, { ok: false, error: err.message }, 500);
  }
});

function escuchar(puerto, intentos = 10) {
  servidor.once("error", (err) => {
    if (err.code === "EADDRINUSE" && intentos > 0) return escuchar(puerto + 1, intentos - 1);
    console.error("No pude abrir la aplicación:", err.message);
    process.exit(1);
  });

  servidor.listen(puerto, "127.0.0.1", () => {
    const direccion = `http://localhost:${puerto}`;
    console.log(`\n  Aplicación abierta en ${direccion}`);
    console.log("  Si no se abrió sola, copia esa dirección en tu navegador.");
    console.log("\n  Deja esta ventana abierta mientras la uses.\n");
    exec(`start "" "${direccion}"`, { shell: "cmd.exe" });
  });
}

// Nunca morir con un volcado de pila en mitad de una tanda.
process.on("unhandledRejection", (motivo) => {
  const texto = motivo instanceof Error ? motivo.message.split("\n")[0] : String(motivo);
  console.error(`  (aviso interno: ${texto})`);
});

// Si la configuración aún no existe, se crea con la dirección por preguntar.
leerConfig()
  .then((c) => guardarConfig(c))
  .catch(() => {})
  .finally(() => escuchar(PUERTO_BASE));
