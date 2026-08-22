// Aplicación con ventana para descargar lotes desde SAP.
//
// Levanta un servidor diminuto en esta misma computadora y abre la interfaz
// en el navegador. Se usa el servidor http que trae Node en vez de un marco
// de escritorio para no añadir cientos de megabytes de dependencias a una
// herramienta que sólo hace esto.

import http from "http";
import { readFile } from "fs/promises";
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
  estado.error = null;

  try {
    const { page, contexto, descargas, config } = await prepararSesion();

    estado.fase = "descargando";
    avisar("Abriendo el reporte…");
    await irAlReporte(page, config, avisar);

    for (const lote of lotes) {
      estado.actual = lote;
      avisar(`Buscando el lote ${lote}…`);
      try {
        const filas = await descargarLote(page, contexto, lote, descargas, config, avisar);
        estado.resultados.push(...filas);
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

function json(res, datos, codigo = 200) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(cuerpo);
}

async function leerCuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return JSON.parse(Buffer.concat(trozos).toString("utf8") || "{}");
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

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
