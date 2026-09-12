// Función serverless de Vercel: la puerta de entrada a la aplicación.
//
// La contraseña vive SÓLO aquí, en una variable de entorno sin el prefijo
// VITE_. Esa distinción es la razón de que esto sea una función de servidor y
// no cuatro líneas en el navegador: Vite mete en el paquete todo lo que
// empiece por VITE_, así que una contraseña comprobada en el navegador se
// puede leer abriendo el código de la página. Aquí no sale nunca del servidor;
// lo único que se devuelve es un sí o un no.
//
// No se guarda ninguna sesión: la contraseña se pide en cada entrada y en cada
// recarga, a propósito. Un equipo compartido en planta no debe quedar abierto
// porque alguien entró por la mañana.
//
// Qué protege y qué no, dicho claro:
//
//   SÍ  — que alguien que llegue a la dirección vea la aplicación y sus datos
//         sin más. Es la puerta que se pidió.
//   NO  — a quien sepa programar. Todo el código de la aplicación se
//         descarga en el navegador, y la clave anónima de Supabase va dentro,
//         con políticas que hoy permiten leer y escribir a cualquiera. Para
//         cerrar eso de verdad hacen falta o la protección de despliegue de
//         Vercel (una casilla, cierra el sitio entero antes de servirlo) o
//         autenticación de Supabase con políticas por usuario.
//
// Mientras APP_PASSWORD no esté configurada, la puerta queda abierta y la
// aplicación funciona como siempre: así, publicar este cambio no deja a nadie
// fuera antes de tiempo.

import { timingSafeEqual } from "crypto";

function clave() {
  return process.env.APP_PASSWORD || "";
}

/** Compara sin delatar en cuánto tiempo falla, que es por dónde se adivina. */
function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  // Sin contraseña configurada no hay puerta. Se dice explícitamente para que
  // la aplicación no tenga que adivinarlo.
  if (!clave()) {
    res.status(200).json({ requerida: false });
    return;
  }

  // GET: ¿hace falta contraseña? Es lo único que la aplicación necesita saber
  // antes de dibujar nada.
  if (req.method === "GET") {
    res.status(200).json({ requerida: true });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido." });
    return;
  }

  let cuerpo = req.body;
  if (typeof cuerpo === "string") {
    try {
      cuerpo = JSON.parse(cuerpo);
    } catch {
      res.status(400).json({ error: "Cuerpo de la petición inválido." });
      return;
    }
  }

  if (typeof cuerpo?.clave !== "string" || cuerpo.clave === "") {
    res.status(400).json({ error: "Falta la contraseña." });
    return;
  }

  if (!iguales(cuerpo.clave, clave())) {
    // Un poco de espera: hace inviable probar contraseñas a mansalva sin
    // molestar a quien sólo se equivocó al teclear.
    await new Promise((r) => setTimeout(r, 600));
    res.status(401).json({ ok: false, error: "Contraseña incorrecta." });
    return;
  }

  res.status(200).json({ ok: true });
}
