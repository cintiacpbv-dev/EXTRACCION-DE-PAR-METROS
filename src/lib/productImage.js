// Imagen que identifica a cada producto en la biblioteca, en lugar del icono
// genérico del matraz.
//
// Venga de donde venga (búsqueda en internet, archivo del equipo o enlace
// pegado), la imagen se normaliza a un PNG cuadrado y pequeño: así ocupa poco
// en la base de datos, se ve igual en todas las tarjetas y sigue disponible
// aunque el sitio de origen desaparezca.

import { supabase, supabaseEnabled } from "./supabaseClient.js";

const LADO = 256;
const LOCAL_KEY = "deteccion-parametros:imagenes:v1";

// PNG es el formato preferido —no pierde calidad y admite dibujos y logotipos
// nítidos—, pero para una fotografía es muy pesado: una miniatura de 256 px
// ronda los 150 kB, que se guardan en la base de datos y viajan en cada
// carga. Por encima de este tope se recomprime en JPEG, donde la misma
// miniatura baja a unos 15 kB sin diferencia apreciable a este tamaño.
const TOPE_PNG = 60 * 1024;

/** Dibuja la imagen recortada en cuadrado y la devuelve como data URI. */
function aPngCuadrado(img) {
  const canvas = document.createElement("canvas");
  canvas.width = LADO;
  canvas.height = LADO;
  const ctx = canvas.getContext("2d");

  // Fondo blanco: los PNG con transparencia se verían sucios sobre la tarjeta.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, LADO, LADO);

  // Recorte centrado, sin deformar la imagen.
  const lado = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - lado) / 2;
  const sy = (img.naturalHeight - lado) / 2;
  ctx.drawImage(img, sx, sy, lado, lado, 0, 0, LADO, LADO);

  const png = canvas.toDataURL("image/png");
  if (png.length <= TOPE_PNG) return png;

  const jpeg = canvas.toDataURL("image/jpeg", 0.82);
  return jpeg.length < png.length ? jpeg : png;
}

function cargarImagen(src, conCors) {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    if (conCors) img.crossOrigin = "anonymous";
    const temporizador = setTimeout(() => rechazar(new Error("La imagen tardó demasiado en cargar.")), 15000);
    img.onload = () => {
      clearTimeout(temporizador);
      resolver(img);
    };
    img.onerror = () => {
      clearTimeout(temporizador);
      rechazar(new Error("No se pudo cargar la imagen."));
    };
    img.src = src;
  });
}

/**
 * Convierte a PNG una imagen de internet. Si el servidor no permite leerla
 * desde otro dominio, el navegador impide convertirla; en ese caso se guarda
 * el enlace tal cual, que para mostrarla sigue funcionando.
 */
export async function imagenRemotaAPng(url) {
  try {
    const img = await cargarImagen(url, true);
    return { dato: aPngCuadrado(img), esEnlace: false };
  } catch {
    try {
      // Segundo intento sin CORS: sirve para comprobar que el enlace es una
      // imagen válida, aunque después no se pueda convertir.
      await cargarImagen(url, false);
      return { dato: url, esEnlace: true };
    } catch (err) {
      throw new Error(`No se pudo usar esa imagen: ${err.message}`);
    }
  }
}

/** Convierte a PNG un archivo elegido en el equipo. */
export async function archivoAPng(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await cargarImagen(url, false);
    return { dato: aPngCuadrado(img), esEnlace: false };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- persistencia -----------------------------------------------------------

export function cargarImagenesLocales() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function guardarImagenesLocales(mapa) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(mapa));
  } catch {
    // El almacenamiento local tiene un tope de unos pocos megabytes; si se
    // llena, la imagen sigue viviendo en Supabase.
  }
}

/** Lee de Supabase las imágenes de todos los productos. */
export async function cargarImagenesRemotas() {
  if (!supabaseEnabled) return {};
  const { data, error } = await supabase.from("product_images").select("familia,imagen");
  if (error || !data) return {};

  const mapa = {};
  for (const fila of data) mapa[fila.familia] = fila.imagen;
  return mapa;
}

/** Guarda (o reemplaza) la imagen de un producto. */
export async function guardarImagenRemota(familia, imagen) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase
    .from("product_images")
    .upsert({ familia, imagen }, { onConflict: "familia" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Quita la imagen de un producto y vuelve al icono por defecto. */
export async function borrarImagenRemota(familia) {
  if (!supabaseEnabled) return { ok: true, skipped: true };
  const { error } = await supabase.from("product_images").delete().eq("familia", familia);
  return error ? { ok: false, error: error.message } : { ok: true };
}
