// Qué escribir al arrastrar el tirador de una selección, como en Excel.
//
// La regla es la de siempre: si lo seleccionado forma una serie, se continúa;
// si no, se repite. Lo que cambia entre una hoja de cálculo y otra es cuánto
// se esfuerza en reconocer la serie, y aquí interesa reconocer las que salen
// en un expediente: números que suben de dos en dos, fechas correlativas, y
// códigos con un número al final ("Lote 1", "M-01", "Muestra 3").

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function aNumero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Un texto que acaba en número: "Lote 7", "M-01", "Muestra3". */
function partirTextoConNumero(v) {
  if (typeof v !== "string") return null;
  const m = v.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return null;
  return { prefijo: m[1], numero: parseInt(m[2], 10), sufijo: m[3], ancho: m[2].length };
}

function unirTextoConNumero({ prefijo, sufijo, ancho }, numero) {
  // Se conservan los ceros a la izquierda: "M-01" sigue "M-02", no "M-2".
  const cifras = numero < 0 ? String(numero) : String(numero).padStart(ancho, "0");
  return `${prefijo}${cifras}${sufijo}`;
}

function esFecha(v) {
  if (typeof v !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

function diaDe(iso) {
  return Math.round(new Date(`${iso}T00:00:00Z`).getTime() / 86400000);
}

function fechaDe(dias) {
  return new Date(dias * 86400000).toISOString().slice(0, 10);
}

/** Índice en una lista de nombres (meses, días), sin distinguir tildes ni mayúsculas. */
function indiceEnLista(v, lista) {
  if (typeof v !== "string") return -1;
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return lista.findIndex((x) => norm(x) === norm(v));
}

/**
 * Continúa una selección hacia abajo (o hacia arriba, con `haciaAtras`).
 *
 * `origen` son los valores seleccionados, en orden. Devuelve `cantidad`
 * valores nuevos.
 *
 * Cuando no hay serie que reconocer, se repite el bloque entero en ciclo —que
 * es lo que hace Excel—: arrastrar dos celdas con "A" y "B" da A, B, A, B.
 */
export function continuarSerie(origen, cantidad, haciaAtras = false) {
  const utiles = origen.filter((v) => v !== null && v !== undefined && v !== "");
  if (utiles.length === 0 || cantidad <= 0) return new Array(Math.max(0, cantidad)).fill(null);

  const paso = haciaAtras ? -1 : 1;

  // --- números: una sola celda repite; dos o más marcan el paso -----------
  const numeros = origen.map(aNumero);
  if (numeros.every((n) => n !== null)) {
    if (numeros.length === 1) {
      // Una celda sola se repite, como en Excel (arrastrar "5" da 5, 5, 5…).
      return new Array(cantidad).fill(numeros[0]);
    }
    const diferencias = numeros.slice(1).map((n, i) => n - numeros[i]);
    const constante = diferencias.every((d) => Math.abs(d - diferencias[0]) < 1e-9);
    if (constante) {
      const delta = diferencias[0] * paso;
      const desde = haciaAtras ? numeros[0] : numeros[numeros.length - 1];
      // Se redondea a los decimales del origen: 0.1+0.1+0.1 en coma flotante
      // da 0.30000000000000004, y eso no debe aparecer en una hoja.
      const decimales = Math.max(...origen.map((v) => (String(v).split(".")[1] || "").length));
      const redondear = (x) => (decimales > 0 ? Number(x.toFixed(Math.min(decimales + 2, 12))) : x);
      return Array.from({ length: cantidad }, (_, k) => redondear(desde + delta * (k + 1)));
    }
  }

  // --- fechas correlativas -----------------------------------------------
  if (origen.every(esFecha)) {
    const dias = origen.map((v) => diaDe(String(v).trim()));
    const paso1 = dias.length > 1 ? dias[1] - dias[0] : 1;
    const constante = dias.slice(1).every((d, i) => d - dias[i] === paso1);
    if (constante) {
      const delta = (dias.length > 1 ? paso1 : 1) * paso;
      const desde = haciaAtras ? dias[0] : dias[dias.length - 1];
      return Array.from({ length: cantidad }, (_, k) => fechaDe(desde + delta * (k + 1)));
    }
  }

  // --- meses y días de la semana -----------------------------------------
  for (const lista of [MESES, DIAS]) {
    const indices = origen.map((v) => indiceEnLista(v, lista));
    if (indices.every((i) => i >= 0)) {
      const desde = haciaAtras ? indices[0] : indices[indices.length - 1];
      const delta = (indices.length > 1 ? (indices[1] - indices[0] + lista.length) % lista.length || 1 : 1) * paso;
      const mayuscula = /^[A-ZÁÉÍÓÚ]/.test(String(origen[0]));
      return Array.from({ length: cantidad }, (_, k) => {
        const nombre = lista[(((desde + delta * (k + 1)) % lista.length) + lista.length) % lista.length];
        return mayuscula ? nombre[0].toUpperCase() + nombre.slice(1) : nombre;
      });
    }
  }

  // --- texto con número al final: "Lote 1", "M-01" -----------------------
  const partes = origen.map(partirTextoConNumero);
  if (partes.every((p) => p !== null) && partes.every((p) => p.prefijo === partes[0].prefijo && p.sufijo === partes[0].sufijo)) {
    const nums = partes.map((p) => p.numero);
    const delta = (nums.length > 1 ? nums[1] - nums[0] : 1) * paso;
    const constante = nums.slice(1).every((n, i) => n - nums[i] === (nums.length > 1 ? nums[1] - nums[0] : 1));
    if (constante) {
      const desde = haciaAtras ? nums[0] : nums[nums.length - 1];
      return Array.from({ length: cantidad }, (_, k) => unirTextoConNumero(partes[0], desde + delta * (k + 1)));
    }
  }

  // --- nada reconocible: se repite el bloque en ciclo ---------------------
  return Array.from({ length: cantidad }, (_, k) => {
    const i = haciaAtras ? origen.length - 1 - (k % origen.length) : k % origen.length;
    return origen[i];
  });
}

export const _paraPruebas = { partirTextoConNumero, continuarSerie };
