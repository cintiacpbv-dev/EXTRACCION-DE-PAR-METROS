// Extrae quién participó en cada paso del registro, diferenciando el
// recuadro "Realizado / Por" (operarios que ejecutan) del recuadro "VB"
// (supervisores que dan el visto bueno).
//
// El formulario dibuja ambos recuadros como dos columnas angostas, una junto
// a la otra, a la derecha de cada paso. Cuando un nombre de usuario no cabe
// en el ancho de la columna, el PDF lo corta a la mitad SIN espacio ni guión
// y continúa en el renglón siguiente en la misma columna — por eso un
// fragmento de 1 a 3 caracteres que sigue a otro nombre en la misma columna
// se trata como la continuación de ese nombre, no como una persona aparte.

import { matchSectionHeading } from "./genericParser.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const NAME_TOKEN_RE = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9]{0,17}$/;
const SKIP_WORDS = new Set(["POR", "VB", "REALIZADO"]);

// Distancia, en puntos, entre el inicio de la columna "VB" y el límite que
// separa ambas columnas. Los nombres del recuadro "Realizado" quedan bien a
// la izquierda de "VB - 20"; los del recuadro "VB" quedan a la derecha.
const COLUMN_MARGIN = 20;

// Cuántos renglones como máximo se revisan después de "Realizado" antes de
// dar por cerrado el bloque, aunque no se haya encontrado el corte natural.
const MAX_BLOCK_ROWS = 8;

// Los recuadros de firma empiezan siempre a esta altura de la página
// (Realizado/VB aparecen entre x=476 y x=535). Cuando la instrucción del
// paso es larga, su texto normal (que arranca en x=78) sigue ocupando
// renglones propios varias líneas después de "Realizado", en la MISMA fila
// que a veces ya trae nombres — por eso no se corta el bloque por fila, sino
// que se descarta segmento por segmento todo lo que quede a la izquierda de
// este límite.
const SIGNATURE_X_MIN = 465;

// El rótulo del recuadro de firma. Unos registros lo parten en dos trozos
// ("Realizado" y "Por") y otros lo escriben de una pieza ("Realizado Por"):
// exigir el trozo suelto dejaba a estos últimos sin ningún recuadro, y por
// tanto sin nadie en el cuadro de personal. Es lo que pasaba con los
// registros de EVACLEAN.
const ES_REALIZADO = /^Realizado\b/i;

// El control inspectivo lo hace personal de control de calidad, que no
// interviene en el acondicionado: entra a la línea, toma sus muestras y se
// va. Sus firmas no cuentan como personal del proceso, así que el paso que
// las recoge se salta entero.
//
// La decisión se toma con el renglón donde está el recuadro de firma, que es
// el primero del paso, y ahí la frase puede venir cortada: el registro de
// EVACLEAN parte "...REALIZA EL CONTROL INSPECTIVO DEL / PROCESO Y RETIRA SUS
// MUESTRAS...", de modo que exigir "CONTROL INSPECTIVO DEL PROCESO" dejaba
// entrar a Calidad. Basta con reconocer de quién habla el paso.
const PASO_AJENO_RE = /PERSONAL\s+DE\s+CONTROL\s+DE(\s+CALIDAD)?\b|CONTROL\s+INSPECTIVO/i;
const PASO_RE = /^\d+(\.\d+)*\s*\.-/;

function isNameToken(tok) {
  return NAME_TOKEN_RE.test(tok) && !SKIP_WORDS.has(tok) && !DATE_RE.test(tok) && !TIME_RE.test(tok);
}

/** Une los fragmentos de una misma columna en nombres completos. */
function mergeFragments(tokens) {
  const names = [];
  for (const tok of tokens) {
    if (tok.length <= 3 && names.length > 0) {
      names[names.length - 1] += tok;
    } else {
      names.push(tok);
    }
  }
  return names;
}

function addAll(counter, names) {
  for (const name of names) {
    counter.set(name, (counter.get(name) || 0) + 1);
  }
}

export function detectPersonnel(pages) {
  const operarios = new Map();
  const supervisores = new Map();

  // Además del total de la etapa se anota quién firmó dentro de cada sección
  // del registro. Acondicionado reparte el trabajo en dos operaciones —la
  // impresión de cajas (el "lotizado") y el acondicionado propiamente dicho—
  // que el informe lista por separado, con distinta gente y a menudo con
  // días de por medio.
  const porSeccion = new Map();
  let seccion = null;
  // Si el paso en curso es de gente ajena al proceso, sus firmas se descartan.
  let pasoAjeno = false;

  for (const page of pages) {
    const lines = page.lines;

    for (let i = 0; i < lines.length; i++) {
      const texto = String(lines[i].text || "").trim();

      if (PASO_RE.test(texto)) pasoAjeno = PASO_AJENO_RE.test(texto);

      const encabezado = matchSectionHeading(texto);
      if (encabezado) seccion = encabezado.title;

      const realizadoSeg = lines[i].segments.find((s) => ES_REALIZADO.test(s.str.trim()));
      if (!realizadoSeg || pasoAjeno) continue;

      const vbSeg = lines[i].segments.find((s) => s.str === "VB");
      const threshold = vbSeg ? vbSeg.x - COLUMN_MARGIN : Infinity;

      // Dónde empieza la columna de firmas lo dice el propio rótulo. El
      // registro de EVACLEAN la abre en x=449, antes del límite fijo, y sus
      // nombres se descartaban como si fueran texto del paso.
      const xMinimo = Math.min(SIGNATURE_X_MIN, realizadoSeg.x - 4);

      const opTokens = [];
      const supTokens = [];

      for (let j = i + 1, rows = 0; j < lines.length && rows < MAX_BLOCK_ROWS; j++, rows++) {
        const segs = lines[j].segments;
        if (segs.some((s) => ES_REALIZADO.test(s.str.trim()))) break; // empieza el siguiente bloque

        for (const seg of segs) {
          if (seg.x < xMinimo) continue; // texto normal del paso, no es del recuadro
          const tok = seg.str.trim();
          if (!tok || !isNameToken(tok)) continue;
          (seg.x >= threshold ? supTokens : opTokens).push(tok);
        }
      }

      const ops = mergeFragments(opTokens);
      const sups = vbSeg ? mergeFragments(supTokens) : [];

      addAll(operarios, ops);
      addAll(supervisores, sups);

      if (seccion) {
        if (!porSeccion.has(seccion)) {
          porSeccion.set(seccion, { operarios: new Map(), supervisores: new Map() });
        }
        const bloque = porSeccion.get(seccion);
        addAll(bloque.operarios, ops);
        addAll(bloque.supervisores, sups);
      }
    }
  }

  const toList = (counter) =>
    [...counter.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    operarios: toList(operarios),
    supervisores: toList(supervisores),
    porSeccion: Object.fromEntries(
      [...porSeccion].map(([nombre, b]) => [
        nombre,
        { operarios: toList(b.operarios), supervisores: toList(b.supervisores) },
      ])
    ),
  };
}
