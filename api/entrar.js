// Función serverless de Vercel: la puerta de entrada a la aplicación.
//
// La contraseña vive SÓLO aquí, en una variable de entorno sin el prefijo
// VITE_. Esa distinción es la razón de que esto sea una función de servidor y
// no cuatro líneas en el navegador: Vite mete en el paquete todo lo que
// empiece por VITE_, así que una contraseña comprobada en el navegador se
// puede leer abriendo el código de la página. Aquí no sale nunca del
// servidor; lo que viaja es un vale firmado.
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

import { createHmac, timingSafeEqual } from "crypto";

// Cuánto vale un vale antes de volver a pedir la contraseña. Una jornada
// larga: lo bastante para no estorbar, lo bastante poco para que un equipo
// prestado no quede abierto para siempre.
const HORAS_DE_VALE = 12;

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

function firmar(expira) {
  return createHmac("sha256", clave()).update(String(expira)).digest("hex");
}

/** El vale: cuándo caduca y una firma que sólo se puede hacer con la clave. */
function emitirVale() {
  const expira = Date.now() + HORAS_DE_VALE * 3600 * 1000;
  return { token: `${expira}.${firmar(expira)}`, expira };
}

function valeValido(token) {
  const [expira, firma] = String(token || "").split(".");
  if (!expira || !firma) return false;
  if (!/^\d+$/.test(expira) || Number(expira) < Date.now()) return false;
  return iguales(firma, firmar(expira));
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
    res.status(200).json({ requerida: true, horas: HORAS_DE_VALE });
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

  // Renovar: la aplicación pregunta al abrir si el vale que guardó sigue
  // sirviendo, sin volver a pedir la contraseña.
  if (cuerpo?.token) {
    if (valeValido(cuerpo.token)) res.status(200).json({ ok: true });
    else res.status(401).json({ ok: false, error: "El acceso caducó." });
    return;
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

  res.status(200).json({ ok: true, ...emitirVale() });
}
