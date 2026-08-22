// Búsqueda de imágenes para ilustrar un producto.
//
// La app no tiene servidor propio, así que sólo puede consultar servicios que
// (a) no exijan una clave —una clave dentro del JavaScript que descarga el
// navegador queda a la vista de cualquiera y es facturable— y (b) permitan
// CORS. Eso descarta Google, Bing y similares, y deja dos fuentes que además
// devuelven material de licencia reutilizable, que es lo correcto para un
// documento de validación:
//
//   · Openverse          — buscador de imágenes con licencia Creative Commons
//   · Wikimedia Commons  — repositorio libre de la Fundación Wikimedia
//
// Ninguna de las dos indexa marcas comerciales de laboratorio: buscar
// "FLUIBRONCOL" devuelve cero resultados. Sirven para ilustrar por principio
// activo o por forma farmacéutica; para la caja real del producto está la
// carga manual desde el equipo.

const TIEMPO_LIMITE = 12000;

function conTiempoLimite(promesa, ms = TIEMPO_LIMITE) {
  return Promise.race([
    promesa,
    new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("La búsqueda tardó demasiado.")), ms)),
  ]);
}

async function buscarOpenverse(consulta) {
  const url =
    "https://api.openverse.org/v1/images/?page_size=12&license_type=all&q=" + encodeURIComponent(consulta);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Openverse respondió ${res.status}`);
  const json = await res.json();

  return (json.results || []).map((r) => ({
    id: `ov:${r.id}`,
    titulo: r.title || "Sin título",
    miniatura: r.thumbnail || r.url,
    url: r.url,
    autor: r.creator || null,
    licencia: [r.license, r.license_version].filter(Boolean).join(" ").toUpperCase() || null,
    origen: "Openverse",
    paginaOrigen: r.foreign_landing_url || null,
  }));
}

async function buscarCommons(consulta) {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&generator=search" +
    `&gsrsearch=${encodeURIComponent(consulta)}&gsrlimit=12&gsrnamespace=6` +
    "&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=320&format=json&origin=*";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikimedia Commons respondió ${res.status}`);
  const json = await res.json();

  const paginas = Object.values(json.query?.pages || {});
  return paginas
    .map((p) => {
      const info = p.imageinfo?.[0];
      if (!info) return null;
      // Commons también indexa PDF y vídeo; aquí sólo interesan las imágenes.
      if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(info.url || "")) return null;
      const meta = info.extmetadata || {};
      return {
        id: `wc:${p.pageid}`,
        titulo: (p.title || "").replace(/^File:/, ""),
        miniatura: info.thumburl || info.url,
        url: info.url,
        autor: meta.Artist?.value?.replace(/<[^>]+>/g, "").trim() || null,
        licencia: meta.LicenseShortName?.value || null,
        origen: "Wikimedia Commons",
        paginaOrigen: info.descriptionurl || null,
      };
    })
    .filter(Boolean);
}

/**
 * Busca en las dos fuentes a la vez y devuelve los resultados juntos. Si una
 * falla, se usa lo que devuelva la otra: es preferible mostrar la mitad de
 * los resultados que un error.
 */
export async function buscarImagenes(consulta) {
  const texto = String(consulta || "").trim();
  if (!texto) return { resultados: [], errores: [] };

  const respuestas = await Promise.allSettled([
    conTiempoLimite(buscarOpenverse(texto)),
    conTiempoLimite(buscarCommons(texto)),
  ]);

  const resultados = [];
  const errores = [];
  for (const r of respuestas) {
    if (r.status === "fulfilled") resultados.push(...r.value);
    else errores.push(r.reason?.message || "Error de búsqueda");
  }

  return { resultados, errores };
}

/**
 * Términos alternativos cuando el nombre comercial no devuelve nada, que es
 * lo habitual: se propone la primera palabra y la forma farmacéutica que
 * aparezca en el nombre del registro.
 */
export function sugerenciasDeBusqueda(nombreProducto) {
  const texto = String(nombreProducto || "");
  const sugerencias = new Set();

  const formas = [
    ["GRN", "granulado farmacéutico"],
    ["SAC", "sachet farmacéutico"],
    ["CJA", "caja de medicamento"],
    ["TAB", "tabletas"],
    ["CAP", "cápsulas"],
    ["JBE", "jarabe"],
    ["SOL", "solución"],
    ["CRE", "crema farmacéutica"],
    ["SUS", "suspensión oral"],
    ["INY", "inyectable"],
  ];
  for (const [clave, termino] of formas) {
    if (new RegExp(`\\b${clave}`, "i").test(texto)) sugerencias.add(termino);
  }

  sugerencias.add("medicamento");
  return [...sugerencias].slice(0, 4);
}
