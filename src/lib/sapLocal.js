// Enlace con el ayudante de descargas de SAP.
//
// La descarga no puede hacerla esta página: necesita manejar un Chrome de
// verdad, alcanzar la red interna de la empresa y usar la sesión de SAP, y
// nada de eso está al alcance de un sitio web. Lo hace un programa que corre
// en la propia computadora (herramientas/sap-descargas) y que abre un
// servidor pequeño; aquí sólo se le habla.
//
// Se prueban varios puertos porque el ayudante busca uno libre a partir del
// 4599 si el primero está ocupado.
const PUERTOS = [4599, 4600, 4601, 4602];
const ESPERA_BUSQUEDA = 900;

let baseDetectada = null;

function conTiempo(promesa, ms) {
  return Promise.race([promesa, new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("timeout")), ms))]);
}

/** Busca el ayudante entre los puertos posibles. Devuelve su dirección o null. */
export async function buscarAyudante() {
  const candidatos = baseDetectada ? [baseDetectada, ...PUERTOS.map((p) => `http://localhost:${p}`)] : PUERTOS.map((p) => `http://localhost:${p}`);

  for (const base of [...new Set(candidatos)]) {
    try {
      const res = await conTiempo(fetch(`${base}/api/salud`), ESPERA_BUSQUEDA);
      if (!res.ok) continue;
      const datos = await res.json();
      if (datos?.app === "sap-descargas") {
        baseDetectada = base;
        return base;
      }
    } catch {
      // puerto sin nadie escuchando; se prueba el siguiente
    }
  }

  baseDetectada = null;
  return null;
}

export async function pedirEstado(base) {
  const res = await fetch(`${base}/api/estado`);
  if (!res.ok) throw new Error("El ayudante dejó de responder.");
  return res.json();
}

export async function pedirDescarga(base, lotes) {
  const res = await fetch(`${base}/api/descargar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lotes }),
  });
  const datos = await res.json();
  if (!datos.ok) throw new Error(datos.error || "No se pudo iniciar la descarga.");
  return datos;
}

export async function listarArchivos(base) {
  const res = await fetch(`${base}/api/archivos`);
  if (!res.ok) throw new Error("No pude leer la carpeta de descargas.");
  const datos = await res.json();
  return datos.archivos || [];
}

/** Trae un PDF ya descargado y lo entrega como File, listo para analizar. */
export async function traerPdf(base, archivo) {
  const res = await fetch(`${base}/api/archivo?ruta=${encodeURIComponent(archivo.ruta)}`);
  if (!res.ok) throw new Error(`No pude leer ${archivo.nombre}`);
  const blob = await res.blob();
  return new File([blob], archivo.nombre, { type: "application/pdf" });
}

/** Cuenta cuántos lotes distintos hay en lo que se pegó. */
export function contarLotes(texto) {
  return new Set(
    String(texto || "")
      .split(/[\s,;]+/)
      .map((l) => l.trim())
      .filter(Boolean)
  ).size;
}
