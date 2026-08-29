// Parte una operación unitaria en las cajas que el esquema dibuja.
//
// Preparar el bulk o la gelatina es una sola sección del registro, pero en el
// esquema son varias cajas: disolver, dejar enfriar, homogeneizar, eliminar
// burbujas. Cada una de esas cajas es un paso numerado del registro
// ("4.4.4.- EN UNA OLLA DE ACERO INOXIDABLE DE 30 L, AGREGAR LO SIGUIENTE:"),
// con lo que se le echa, cuánto tiempo, a qué temperatura y con qué equipo.
//
// Los rangos se leen del propio texto del paso y no de los campos: el registro
// los escribe dentro de la frase ("AGITAR ... POR UN TIEMPO NO MENOR DE 10
// MINUTOS", "HASTA UNA TEMPERATURA ENTRE 60 °C ± 5 °C").

const PASO_RE = /^(\d+(?:\.\d+)*)\s*\.-\s*(.*)$/;

// Los recuadros de firma: su texto no es del paso.
const X_FIRMA = 465;

// El verbo con el que el esquema nombra cada paso. Se busca en el orden de la
// lista, así que lo más específico va primero.
const VERBOS = [
  [/ELIMINA\w*\s+(?:LAS\s+)?BURBUJAS|ELIMINACI[OÓ]N\s+DE\s+BURBUJAS/i, "ELIMINACIÓN DE BURBUJAS"],
  [/DEJAR\s+ENFRIAR|ENFRIAR/i, "ENFRIAR"],
  [/HOMOGEN[EI]IZAR|HOMOGENIZAR/i, "HOMOGENEIZAR"],
  [/DISOLVER|HASTA\s+COMPLETA\s+DISOLUCI[OÓ]N/i, "DISOLVER"],
  [/SEPARAR/i, "SEPARAR"],
  [/TAMIZAR/i, "TAMIZAR"],
  [/AMASAR/i, "AMASAR"],
  [/SECAR/i, "SECAR"],
  [/MEZCLAR/i, "MEZCLAR"],
  [/AGITAR/i, "AGITAR"],
  [/CALENTAR|PROGRAMAR\s+LA\s+TEMPERATURA/i, "CALENTAR"],
  [/AGREGAR|A[NÑ]ADIR/i, "AGREGAR"],
  [/VERIFICAR\s+CANTIDAD\s+POR\s+PESO|PESAR/i, "PESAR"],
];

// Una línea de insumo dentro de un paso: "AGUA PURIFICADA (2500000002) 14 L
// 14.000". El primer número tras el código es lo que manda la fórmula.
const INSUMO_RE = /^(.+?)\s*\((\d{6,})\)\s*([\d.,]+(?:\s*[A-Za-z]+)?)/;

/** Los renglones del paso, sin lo que hay en los recuadros de firma. */
function textoIzquierdo(linea) {
  const segs = (linea.segments || []).filter((s) => s.x < X_FIRMA);
  const texto = segs.length > 0 ? segs.map((s) => s.str).join(" ") : linea.text;
  return String(texto).replace(/\s+/g, " ").trim();
}

/** Los pasos numerados de cada sección del registro, con sus renglones. */
export function pasosPorSeccion(pages, esEncabezado) {
  const porSeccion = new Map();
  let seccion = null;
  let paso = null;

  const cerrar = () => {
    if (!seccion || !paso || paso.renglones.length === 0) return;
    if (!porSeccion.has(seccion)) porSeccion.set(seccion, []);
    porSeccion.get(seccion).push(paso);
  };

  for (const page of pages) {
    for (const linea of page.lines) {
      const texto = textoIzquierdo(linea);
      if (!texto) continue;

      const m = texto.match(PASO_RE);
      if (m) {
        cerrar();
        const titulo = m[2].trim();
        const nueva = esEncabezado(titulo);
        if (nueva) {
          seccion = nueva;
          paso = null;
          continue;
        }
        paso = { numero: m[1], renglones: [titulo] };
        continue;
      }

      if (paso) paso.renglones.push(texto);
    }
  }

  cerrar();
  return porSeccion;
}

/** Los rangos que el paso declara en su propia frase. */
function rangosDelPaso(texto) {
  const lineas = [];
  const t = texto.replace(/\s+/g, " ");

  const tiempoMin = t.match(/TIEMPO\s+NO\s+MEN(?:OR|OS)\s+(?:DE|A)\s+(\d+)\s*(MINUTOS?|HORAS?)/i)
    || t.match(/NO\s+MEN(?:OR|OS)\s+(?:DE|A)\s+(\d+)\s*(MINUTOS?|HORAS?)/i);
  if (tiempoMin) lineas.push(`t: No menos de ${tiempoMin[1]} ${tiempoMin[2].toLowerCase()}`);

  const tiempoFijo = t.match(/(?:DURANTE|POR)\s+(\d+)\s*(MINUTOS?|HORAS?)\b/i);
  if (tiempoFijo && !tiempoMin) lineas.push(`t: ${tiempoFijo[1]} ${tiempoFijo[2].toLowerCase()}`);

  const tempMas = t.match(/(\d+(?:\.\d+)?)\s*°?C?\s*±\s*(\d+(?:\.\d+)?)\s*°C/i);
  if (tempMas) lineas.push(`T°: ${tempMas[1]} °C ± ${tempMas[2]} °C`);

  const tempRango = t.match(/ENTRE\s+(\d+(?:\.\d+)?)\s*°C\s*(?:Y|A|-)\s*(\d+(?:\.\d+)?)\s*°C/i);
  if (tempRango && !tempMas) lineas.push(`T°: ${tempRango[1]} °C - ${tempRango[2]} °C`);

  const nivel = t.match(/NIVEL\s+(\d+)/i);
  if (nivel) lineas.push(`V: Nivel ${nivel[1]}`);

  const rpm = t.match(/(\d+(?:\.\d+)?)\s*rpm/i);
  if (rpm) lineas.push(`V: ${rpm[1]} rpm`);

  const vacio = t.match(/(-?\d+\.\d+)\s*MPa/i);
  if (vacio) lineas.push(`Presión de vacío: ${vacio[1]} MPa`);

  return [...new Set(lineas)];
}

/** Los insumos que el paso agrega, con la cantidad de la fórmula. */
function insumosDelPaso(renglones) {
  const salida = [];
  for (const r of renglones) {
    const m = r.match(INSUMO_RE);
    if (!m) continue;
    const nombre = m[1].replace(/\s+/g, " ").trim();
    if (nombre.length < 4 || /^(NOTA|PRECAUCION|VERIFICAR)/i.test(nombre)) continue;
    salida.push(`${nombre}: ${m[3].trim()}`);
  }
  return salida;
}

function verboDe(texto) {
  const encontrado = VERBOS.find(([re]) => re.test(texto));
  return encontrado ? encontrado[1] : null;
}

/**
 * Las cajas en que se parte una operación unitaria.
 *
 * Un paso entra si aporta algo que dibujar: lo que se le echa, un rango o el
 * equipo. Los que sólo anotan una hora o un visto bueno se quedan fuera.
 * Cuando dos cajas comparten verbo se numeran, como en el formato.
 */
export function cajasDePasos(pasos, { equiposDeTexto }) {
  const cajas = [];

  for (const paso of pasos) {
    const texto = paso.renglones.join(" ");
    const verbo = verboDe(texto);
    if (!verbo) continue;

    const insumos = insumosDelPaso(paso.renglones);
    const lineas = rangosDelPaso(texto);
    const equipo = equiposDeTexto(texto);
    if (insumos.length === 0 && lineas.length === 0 && equipo.length === 0) continue;

    cajas.push({ verbo, insumos, lineas, equipo });
  }

  // "DISOLVER", "DISOLVER (2)"… sólo se numera lo que se repite.
  const cuantas = new Map();
  for (const c of cajas) cuantas.set(c.verbo, (cuantas.get(c.verbo) || 0) + 1);
  const vistos = new Map();

  return cajas.map((c) => {
    if ((cuantas.get(c.verbo) || 0) < 2) return { ...c, titulo: c.verbo };
    const n = (vistos.get(c.verbo) || 0) + 1;
    vistos.set(c.verbo, n);
    return { ...c, titulo: `${c.verbo} (${n})` };
  });
}
