// La puerta de entrada, del lado del navegador.
//
// La contraseña no se comprueba aquí: se manda a /api/entrar, que la tiene en
// una variable de entorno del servidor y devuelve un vale firmado. Por eso el
// paquete de la aplicación no contiene la contraseña por ningún lado.
//
// El vale se guarda en este navegador y se revalida al abrir. Si el servidor
// dice que ya no vale —caducó, o cambiaron la contraseña, que invalida todas
// las firmas anteriores— se vuelve a pedir.

const CLAVE_LOCAL = "deteccion-parametros:acceso:v1";

export function valeGuardado() {
  try {
    return localStorage.getItem(CLAVE_LOCAL) || null;
  } catch {
    return null;
  }
}

function guardarVale(token) {
  try {
    localStorage.setItem(CLAVE_LOCAL, token);
  } catch {
    // Sin almacenamiento se entra igual, sólo que habrá que escribir la
    // contraseña en cada pestaña nueva.
  }
}

export function olvidarVale() {
  try {
    localStorage.removeItem(CLAVE_LOCAL);
  } catch {
    // Nada que hacer.
  }
}

/**
 * Qué hace falta para entrar.
 *
 * Devuelve "abierto" cuando no hay contraseña configurada, "dentro" cuando el
 * vale guardado sigue sirviendo, y "pedir" cuando hay que escribirla.
 *
 * Si la consulta falla —sin red, la función caída— se devuelve "abierto" a
 * propósito: dejar la aplicación inservible porque el servidor tuvo un mal
 * momento es peor que la puerta, que de todas formas no es una cerradura (ver
 * api/entrar.js). Quien quiera una cerradura de verdad la pone en Vercel.
 */
export async function estadoDeAcceso() {
  let requerida;
  try {
    const r = await fetch("/api/entrar");
    if (!r.ok) return "abierto";
    requerida = (await r.json())?.requerida;
  } catch {
    return "abierto";
  }

  if (!requerida) return "abierto";

  const token = valeGuardado();
  if (!token) return "pedir";

  try {
    const r = await fetch("/api/entrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (r.ok) return "dentro";
  } catch {
    // El vale existe y no se pudo comprobar: se deja pasar. La alternativa es
    // cerrarle la puerta a quien ya entró, por un fallo de red.
    return "dentro";
  }

  olvidarVale();
  return "pedir";
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
    if (r.ok && datos?.token) {
      guardarVale(datos.token);
      return { ok: true };
    }
    return { ok: false, error: datos?.error || "No se pudo comprobar la contraseña." };
  } catch (err) {
    return { ok: false, error: `No se pudo contactar con el servidor: ${err.message}` };
  }
}
