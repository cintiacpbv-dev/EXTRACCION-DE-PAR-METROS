// La puerta de entrada, del lado del navegador.
//
// La contraseña no se comprueba aquí: se manda a /api/entrar, que la tiene en
// una variable de entorno del servidor y responde sí o no. Por eso el paquete
// de la aplicación no contiene la contraseña por ningún lado.
//
// No se guarda nada. Ni en localStorage, ni en una cookie, ni en sessionStorage:
// la contraseña se pide al entrar y se vuelve a pedir al recargar, que es lo
// que se pidió. En una computadora compartida de planta, "haber entrado" no
// debe sobrevivir a cerrar la pestaña ni a un F5.
//
// Lo que sí sobrevive es haber entrado en ESTA página mientras no se recargue:
// eso vive en el estado de React, en memoria, y se pierde con la recarga.

/**
 * Si hace falta contraseña para entrar.
 *
 * Si la consulta falla —sin red, la función caída— se responde que no hace
 * falta, a propósito: dejar la aplicación inservible porque el servidor tuvo
 * un mal momento es peor que la puerta, que de todas formas no es una
 * cerradura (ver api/entrar.js). Quien quiera una cerradura de verdad la pone
 * en Vercel.
 */
export async function haceFaltaContrasena() {
  try {
    const r = await fetch("/api/entrar");
    if (!r.ok) return false;
    return Boolean((await r.json())?.requerida);
  } catch {
    return false;
  }
}

/** Prueba una contraseña. Devuelve { ok } o { ok: false, error }. */
export async function entrar(clave) {
  try {
    const r = await fetch("/api/entrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave }),
    });
    const datos = await r.json().catch(() => ({}));
    if (r.ok && datos?.ok) return { ok: true };
    return { ok: false, error: datos?.error || "No se pudo comprobar la contraseña." };
  } catch (err) {
    return { ok: false, error: `No se pudo contactar con el servidor: ${err.message}` };
  }
}
