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
// 14.000". El primer número tras el código es lo que manda la fórmula; el
// segundo es lo que pesó el operario, que es de ese lote y no del proceso.
const INSUMO_RE = /^(.+?)\s*\((\d{6,})\)\s*([\d.,]+)\s*([A-Za-z]+)?/;

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
  if (vacio) lineas.push(`P° de vacío: ${vacio[1]} MPa`);

  return [...new Set(lineas)];
}

// Cómo escribe el esquema las unidades del registro. El registro las pone en
// alto porque lo pone todo en alto, y algunas llevan pegado el código de la
// forma en que se dispensa —"100 KGP", "225 GPA"—; el esquema escribe sólo la
// unidad, que es lo que dice el formato ("100.000 kg", "225.000 g").
const UNIDADES = new Map(
  Object.entries({ KG: "kg", KGP: "kg", G: "g", GPA: "g", MG: "mg", ML: "mL", L: "L", LP: "L" })
);

/**
 * La unidad de cada insumo, por su código de material.
 *
 * El registro no repite la unidad en todas las líneas: escribe "AGUA
 * PURIFICADA (2500000002) 14 L" donde dispensa y "AGUA PURIFICADA
 * (2500000002) 110.235" donde vuelve a usarla. La unidad de un material es la
 * misma en todo el registro, así que se toma de donde sí la puso.
 */
export function unidadesPorCodigo(pages) {
  const unidades = new Map();

  for (const page of pages) {
    for (const linea of page.lines) {
      const m = textoIzquierdo(linea).match(INSUMO_RE);
      if (!m || !m[4]) continue;
      const unidad = UNIDADES.get(m[4].toUpperCase());
      if (unidad && !unidades.has(m[2])) unidades.set(m[2], unidad);
    }
  }

  return unidades;
}

/**
 * Los insumos que el paso agrega, con la cantidad de la fórmula.
 *
 * La cantidad va con tres decimales —"14.000 L", "0.500 g"— porque es como la
 * escribe el formato: así se lee de un vistazo que 0.5 g son medio gramo y no
 * cinco.
 */
function insumosDelPaso(renglones, unidadDe) {
  const salida = [];
  for (const r of renglones) {
    const m = r.match(INSUMO_RE);
    if (!m) continue;
    const nombre = m[1].replace(/\s+/g, " ").trim();
    if (nombre.length < 4 || /^(NOTA|PRECAUCION|VERIFICAR)/i.test(nombre)) continue;

    const numero = Number(m[3].replace(/,/g, ""));
    const cantidad = Number.isFinite(numero) ? numero.toFixed(3) : m[3].trim();
    const unidad = m[4] ? UNIDADES.get(m[4].toUpperCase()) || m[4] : unidadDe(m[2]);

    salida.push(`${nombre}: ${cantidad}${unidad ? ` ${unidad}` : ""}`);
  }
  return salida;
}

// El instructivo IVAL-P201-00 pide indicar "manual" o "visual" en el nombre
// cuando la operación la hace un operador y no una máquina: por eso el formato
// dice "DISOLVER MANUALMENTE (1)" y no "DISOLVER (1)". Se exige la palabra
// entera —"MANUALMENTE", "de forma manual"— y no el adjetivo suelto, que
// aparece en nombres de equipo ("Selladora de bolsa manual Miyako").
const ES_MANUAL = /\bMANUALMENTE\b|\b(?:EN|DE)\s+FORMA\s+MANUAL\b/i;

function verboDe(texto) {
  const encontrado = VERBOS.find(([re]) => re.test(texto));
  if (!encontrado) return null;
  return ES_MANUAL.test(texto) ? `${encontrado[1]} MANUALMENTE` : encontrado[1];
}

// Lo que el esquema anota al margen de una caja: no es otra operación, es cómo
// se hace la que ya está. En el formato van en letra pequeña y sin recuadro
// junto a la caja que acompañan —"Enjuagar 3 veces la bolsa con 0.166 kg de
// Polietilenglicol 400 en cada enjuague", "Apagar agitación".
//
// No son pasos aparte: el registro las escribe dentro del propio paso, detrás
// de la instrucción principal ("...MANTENER EN CONSTANTE AGITACION. EN PARALELO
// ENJUAGAR LA BOLSA DEL PASO 4.4.6..."), así que hay que sacarlas de dentro de
// la frase.
const NOTAS = /\b(ENJUAGAR|APAGAR|TRASVASAR|RECIRCULAR)\b/i;
// Un punto sólo cierra la frase si lo que sigue abre otra. En "cada enjuague
// con aprox. 0.166 kg" el punto es de la abreviatura, y cortar ahí dejaba la
// nota terminada en "aprox.".
const FIN_DE_FRASE = /(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/;

// Dónde acaba la nota dentro de su frase: en el punto siguiente, o donde
// empieza el papeleo del formulario.
const FIN_DE_NOTA = /\.\s+(?=[A-ZÁÉÍÓÚÑ])|(?=\b(?:REALIZADO|VERIFICADO|HORA|FECHA)\b)/;

/** Las indicaciones que este paso deja al margen, si las hay. */
function notasDelPaso(texto) {
  const limpio = texto.replace(/\s+/g, " ").trim();
  const salida = [];

  // Cada frase por separado: la nota es una de ellas, no el paso entero. "EN
  // PARALELO" también abre nota, aunque venga sin punto delante.
  for (const frase of limpio.split(FIN_DE_FRASE).flatMap((f) => f.split(/\bEN\s+PARALELO\s+/i))) {
    const m = frase.match(NOTAS);
    if (!m) continue;

    const desde = frase.slice(m.index);
    const nota = desde.split(FIN_DE_NOTA)[0].trim().replace(/[,;]$/, "");
    // Ni un jirón suelto ni el procedimiento entero.
    if (nota.length < 15 || nota.length > 200) continue;
    salida.push(nota);
  }

  return [...new Set(salida)];
}

/**
 * Las cajas en que se parte una operación unitaria.
 *
 * Un paso entra si aporta algo que dibujar: lo que se le echa, un rango o el
 * equipo. Los que sólo anotan una hora o un visto bueno se quedan fuera.
 * Cuando dos cajas comparten verbo se numeran, como en el formato.
 *
 * Los pasos que no son una operación sino una indicación sobre la anterior
 * —enjuagar el recipiente, incorporar despacio, apagar la agitación— se
 * guardan como nota de la caja a la que acompañan.
 */
export function cajasDePasos(pasos, { equiposDeTexto, unidadDe = () => "" }) {
  const cajas = [];

  for (const paso of pasos) {
    const texto = paso.renglones.join(" ");
    const verbo = verboDe(texto);
    const notas = notasDelPaso(texto);

    // Un paso que sólo deja una indicación se cuelga de la caja anterior.
    if (!verbo) {
      if (notas.length > 0 && cajas.length > 0) cajas[cajas.length - 1].notas.push(...notas);
      continue;
    }

    const insumos = insumosDelPaso(paso.renglones, unidadDe);
    const lineas = rangosDelPaso(texto);
    const equipo = equiposDeTexto(texto);
    if (insumos.length === 0 && lineas.length === 0 && equipo.length === 0) continue;

    cajas.push({ verbo, insumos, lineas, equipo, notas });
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
