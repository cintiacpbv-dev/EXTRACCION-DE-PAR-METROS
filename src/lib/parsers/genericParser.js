// Detector genérico de parámetros.
//
// No conoce ningún producto ni ninguna etapa: descubre los parámetros leyendo
// la estructura del propio Registro de Manufactura.
//
// La clave está en cómo el formulario coloca los datos. Una lectura registrada
// siempre aparece como dos bloques separados por un relleno ancho de espacios,
// que el PDF emite como un fragmento propio:
//
//     "TEMPERATURA (15 °C - 25 °C):"   "                    "   "21.5"
//      └────────── etiqueta ────────┘   └── relleno ancho ──┘   └valor┘
//
// mientras que una instrucción del procedimiento es texto corrido, donde los
// espacios entre palabras miden lo mismo que una letra. Medir ese relleno
// distingue los datos del texto narrativo mucho mejor que cualquier lista de
// palabras clave, y funciona igual para cualquier producto.

/** Anchura mínima del relleno de espacios que marca un salto de columna. */
const COLUMN_FILL = 25;

/** Palabras máximas en una etiqueta: por encima es una instrucción, no un dato. */
const MAX_LABEL_WORDS = 12;

const HEADER_MARKERS = [
  "REGISTRO DE MANUFACTURA",
  "Emitido:",
  "Fraccion:",
  "Página:",
  "Edi. Reg. Manuf.",
  "Autorizado/",
  "Expira:",
  "Teórico:",
  "Orden N",
];

// Trazabilidad documental (quién firmó y cuándo): se detecta, pero queda fuera
// de la vista de parámetros de proceso.
const TRACE_LABEL_RE =
  /^(NOTA|NOTAS|VERIFICADO POR|REALIZADO|POR|V°?B°?|VB|FECHA|HORA|OBSERVACIONES|EL JEFE|LOS VISTOS|R|S)\b/i;

// El recuadro de firmas que a veces invade la línea del dato.
const NOISE_VALUE_RE = /^(Realizado|VB|V°B°|Por)\b/i;

// Magnitudes y atributos de proceso: merecen estar en la tabla aunque el
// documento no imprima un setpoint junto a ellos.
const PROCESS_KEYWORDS =
  /(TEMPERATURA|HUMEDAD|VELOCIDAD|PRESION|PRESIÓN|AMPERAJE|AMPERIO|CAUDAL|FLUJO|PESO|TIEMPO|NIVEL|ALTURA|DOSIFICACION|DOSIFICACIÓN|RENDIMIENTO|MERMA|CANTIDAD|MUESTRA|CONTRAMUESTRA|pH|VOLUMEN|DENSIDAD|DUREZA|FRIABILIDAD|DESINTEGRACION|ESPESOR|DIAMETRO|DIÁMETRO|LONGITUD|TORQUE|VACIO|VACÍO|SELLADO|HERMETICIDAD|CONCENTRACION|CONCENTRACIÓN|TAMIZ|MALLA|REVOLUCION|RPM|SALA|LINEA|LÍNEA|SECCION|SECCIÓN|POSICION|POSICIÓN|CODIGO|LECTURA|CONTROL|GRADO|VISCOSIDAD|CONDUCTIVIDAD|TURBIDEZ|ASPECTO|DESCRIPCION|DESCRIPCIÓN|FRACCION|FRACCIÓN|LUZ|AJUSTE|MORDAZA|ENVASADORA|TOLVA|DISCO|SOBRE|CAJA|APILAMIENTO|EMBALAJE)/i;

// Un paréntesis final es setpoint cuando expresa un criterio de aceptación.
const SPEC_RE = /(\d|±|≥|≤|MENOR|MAYOR|NO M[AÁ]S|NO MENOS|ENTRE|APROX|REFERENCIAL|UNICA|ÚNICA|CONFORME|MANUAL)/i;

// …salvo que sea un código de material ("(1000000510)"), un descriptor de
// equipo ("(MODELO:MPC - 285)") o la fórmula del propio paso ("(4.5.2 + 4.5.3)"):
// llevan cifras pero no son criterios de aceptación.
// La fórmula referencia pasos ("4.5.2 + 4.5.3"), con dos puntos en cada
// operando; un rango de aceptación ("2.00 - 4.00") sólo tiene un decimal.
const NOT_SPEC_RE = /^\d{5,}$|:|^\d+\.\d+\.\d+\s*[-+]\s*\d+\.\d+\.\d+$/;

// Criterio escrito sin paréntesis, delante del valor:
//   "NO MAS DE 1%   0.33 %"  ·  "2.00 - 4.00   2.52"
const INLINE_SPEC_RE =
  /^((?:NO M[AÁ]S DE|NO MENOS DE|MENOR (?:A|QUE|O IGUAL A)|MAYOR (?:A|QUE|O IGUAL A)|ENTRE)\s+\S+)\s+(-?\d+(?:[.,]\d+)?)\s*%?$/i;
const RANGE_SPEC_RE = /^([\d.,]+\s*-\s*[\d.,]+)\s+(-?\d+(?:[.,]\d+)?)\s*%?$/;

// Un paréntesis final que sólo contiene una unidad es unidad, no setpoint.
const UNIT_ONLY_RE =
  /^(kg|g|mg|L|mL|%|°C|ºC|psi|Hz|A|mm|cm|m|min|minutos?|Minutos?|seg|segundos?|SOB|CJA|UND|MLL|ROL|amp\/min|L\/ ?min|g\/sobre|sobres\/hora|kg\/h|unidades?)$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(:\d{2})?$/;

const NUMBER_RE =
  /^(-?(?:\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,]\d+)?)\s*(%|°C|ºC|g\/sobre|kg|g|mg|mL|L|mm|cm|psi|Hz|A|AMPERIOS?|min|seg|SOB|CJA|UND|MLL|ROL|sobres\/hora|niveles?|cajas?|sobres?)?\.?$/i;

// Nota al margen que el maquetado pega al título de la sección.
const SECTION_NOTE_RE = /\s*\((?:Colocar|Llenar|Marcar|Registrar)[^)]*\)\s*$/i;

// Encabezado que agrupa las lecturas siguientes: "FRACCION N° 2:", "NIVEL N° 3:".
const QUALIFIER_RE = /^(.{2,40}?)\s*N[°º]\s*(\d+)\s*:$/i;

function isHeaderLine(text) {
  return (
    HEADER_MARKERS.some((m) => text.includes(m)) || /^\s*(Lote|Inicio|Fin):\s*[\d:\s-]+$/.test(text)
  );
}

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function slug(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/** Posición del primer ":" que no esté dentro de un paréntesis. */
function topLevelColon(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0) return i;
  }
  return -1;
}

function parseValue(raw) {
  const s = (raw || "").trim().replace(/\s+/g, " ");

  if (s === "") return { type: "check", value: "ü" };
  if (DATE_RE.test(s) || TIME_RE.test(s) || DATETIME_RE.test(s)) return { type: "datetime", value: s };

  const m = s.match(NUMBER_RE);
  if (m) {
    const n = parseFloat(m[1].replace(/[  ]/g, "").replace(",", "."));
    if (!Number.isNaN(n)) return { type: "number", value: n, unit: m[2] || "" };
  }

  return { type: "text", value: s };
}

/** Extrae de la etiqueta el paréntesis final que sea setpoint o unidad. */
function splitLabel(rawLabel) {
  let label = rawLabel.trim().replace(/\s+/g, " ").replace(/[:.\s]+$/, "");
  let setpoint = "";
  let unit = "";

  // Una etiqueta puede arrastrar varios paréntesis: "CANTIDAD OBTENIDA (kg)
  // (4.5.2 + 4.5.3)". Se recorren de derecha a izquierda quedándose con la
  // unidad y el criterio, y descartando códigos y fórmulas.
  for (;;) {
    const m = label.match(/^(.*?)\s*\(([^()]*)\)$/);
    if (!m || m[1].trim().length === 0) break;

    const inner = m[2].trim();
    if (UNIT_ONLY_RE.test(inner)) {
      if (!unit) unit = inner;
    } else if (NOT_SPEC_RE.test(inner)) {
      // código o fórmula: se descarta
    } else if (SPEC_RE.test(inner)) {
      if (!setpoint) setpoint = inner;
      label = m[1].trim();
      break;
    } else {
      break;
    }
    label = m[1].trim();
  }

  return { label, setpoint, unit };
}

// Acondicionado divide su procedimiento en operaciones numeradas
// ("4.4.1.- OPERACION N° 1: IMPRESION DE CAJAS", "4.4.16.- OPERACION Nº 2:
// ACONDICIONADO") que son trabajos distintos, a menudo con días de por medio:
// en el lote 2075526 las cajas se imprimieron el 22 de julio y el
// acondicionado se hizo el 2 de agosto. Son encabezados de sección aunque
// lleven dos puntos, que es lo que normalmente delata una pareja
// "etiqueta: valor" y no un título.
const OPERACION_RE = /^OPERACI[OÓ]N\s*N\s*[°ºo.]*\s*\d+\s*:\s*\S/i;

export function matchSectionHeading(text) {
  const m = text.match(/^(\d+(?:\.\d+)*)\s*\.-\s*(.+)$/);
  if (!m) return null;

  let title = m[2].replace(SECTION_NOTE_RE, "").trim().replace(/:$/, "").trim();

  // El título de la operación arrastra una aclaración entre paréntesis que lo
  // pasa de largo ("...IMPRESION DE CAJAS (NUMERO DE LOTE Y FECHA DE EXPIRA
  // Y/O TEXTO ADICIONAL)"); se queda con el nombre de la operación.
  const esOperacion = OPERACION_RE.test(title);
  if (esOperacion) title = title.replace(/\s*\([^)]*\)\s*$/, "").trim();

  if (!title || title.length > 70) return null;
  if (/^\d/.test(title)) return null;
  if (/\b(Realizado|VB|V°B°)\b/i.test(title)) return null;
  if (/:\s*\S/.test(title) && !esOperacion) return null;

  return { title: title.toUpperCase() };
}

/**
 * Corta la línea por el primer relleno ancho de espacios. Devuelve etiqueta y
 * valor, o null si la línea no tiene salto de columna.
 */
function splitByColumnFill(segments) {
  const index = segments.findIndex((s) => s.str.trim() === "" && s.width >= COLUMN_FILL);
  if (index <= 0 || index === segments.length - 1) return null;

  const join = (arr) =>
    arr
      .map((s) => s.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  return {
    label: join(segments.slice(0, index)),
    value: join(segments.slice(index + 1)),
  };
}

function classify(label, parsed, setpoint) {
  if (TRACE_LABEL_RE.test(label)) return "trazabilidad";
  if (parsed.type === "datetime") return "trazabilidad";
  if (parsed.type === "check") return "verificacion";
  if (parsed.type === "number") return setpoint || PROCESS_KEYWORDS.test(label) ? "critico" : "otros";
  if (setpoint || PROCESS_KEYWORDS.test(label)) return "critico";
  return "otros";
}

/**
 * Recorre el documento y devuelve la lista ordenada de parámetros detectados.
 * Los encabezados del tipo "FRACCION N° 2:" se usan para calificar las lecturas
 * que vienen debajo, de modo que cada repetición queda identificada por su
 * fracción en vez de amontonarse en una sola fila.
 */
export function detectParameters(pages) {
  const found = [];
  const counters = new Map();
  let section = "GENERAL";
  let qualifier = "";

  for (const page of pages) {
    const lines = page.lines.filter((l) => !isHeaderLine(l.text));

    for (const line of lines) {
      const heading = matchSectionHeading(line.text);
      if (heading) {
        section = heading.title;
        qualifier = "";
        continue;
      }

      // La sección INSUMOS ya tiene su propio lector de tabla (parsers/
      // insumos.js), con las columnas de código, cantidad y UM bien
      // separadas. Aquí el patrón "etiqueta + relleno + valor" del detector
      // genérico la lee mal —arrastra código, cantidad pedida y recibida
      // pegados en un solo valor— y encima algún material puede colar por
      // "crítico" y duplicar, mal, lo que el cuadro de materiales ya muestra
      // bien.
      if (section === "INSUMOS") continue;

      // Un paso nuevo cierra el grupo de lecturas anterior: lo que venga
      // después ya no pertenece a la fracción o al nivel que se estaba llenando.
      const startsNewStep = /^\s*\d+(?:\.\d+)*\s*\.-/.test(line.text);
      if (startsNewStep) qualifier = "";

      const split = splitByColumnFill(line.segments);
      const plain = line.text.replace(/^\s*\d+(?:\.\d+)*\s*\.-\s*/, "").trim();

      let rawLabel;
      let rawValue;

      if (split) {
        rawLabel = split.label.replace(/^\s*\d+(?:\.\d+)*\s*\.-\s*/, "").trim();
        rawValue = split.value;
      } else {
        // Sin salto de columna sólo se aceptan dos formas: el encabezado que
        // agrupa lecturas, y la línea corta "ETIQUETA: valor".
        const q = plain.match(QUALIFIER_RE);
        if (q) {
          qualifier = `${q[1].trim()} N° ${q[2]}`;
          continue;
        }

        const colon = topLevelColon(plain);
        if (colon <= 0) continue;
        rawLabel = plain.slice(0, colon);
        rawValue = plain.slice(colon + 1);
        if (words(rawLabel).length > 6) continue;
      }

      if (NOISE_VALUE_RE.test(rawValue)) continue;
      if (rawLabel.length < 2 || rawLabel.startsWith("-")) continue;
      if (!/[A-Za-zÀ-ÿ]/.test(rawLabel)) continue;
      if (words(rawLabel).length > MAX_LABEL_WORDS) continue;

      // Cuando la etiqueta lleva su propio ":" y además hay valor en la columna,
      // lo que va tras los dos puntos es el criterio y no parte del nombre:
      //   "PORCENTAJE DE HUMEDAD SUPERIOR: NO MAS DE 1%" | "0.33 %"
      let setpointFromColon = "";
      const innerColon = topLevelColon(rawLabel);
      if (split && innerColon > 0) {
        const tail = rawLabel.slice(innerColon + 1).trim();
        if (tail) setpointFromColon = tail;
        rawLabel = rawLabel.slice(0, innerColon);
      }

      const { label: baseLabel, setpoint: parenSetpoint, unit: parenUnit } = splitLabel(rawLabel);
      if (baseLabel.length < 2) continue;

      let setpoint = parenSetpoint || setpointFromColon;
      let valueText = rawValue.trim();

      // Si el criterio viene pegado delante del valor, manda ése: está más
      // cerca del dato que cualquier paréntesis de la etiqueta.
      const inline = valueText.match(INLINE_SPEC_RE) || valueText.match(RANGE_SPEC_RE);
      if (inline) {
        setpoint = inline[1].trim();
        valueText = inline[2];
      }

      const parsed = parseValue(valueText);

      // Encabezados de tabla ("Descripción | Código Cantidad UM Cant. Recib."):
      // etiqueta y valor sin una sola cifra, sin criterio y con varias palabras.
      if (
        parsed.type === "text" &&
        !setpoint &&
        !/\d/.test(baseLabel) &&
        !/\d/.test(parsed.value) &&
        words(parsed.value).length >= 3
      ) {
        continue;
      }

      if (!split || innerColon <= 0) {
        if (parsed.type === "text" && words(baseLabel).length > 4) continue;
      }

      // Ruido de firmas: una palabra suelta seguida de otra, sin cifras.
      if (parsed.type === "text" && words(baseLabel).length === 1 && words(parsed.value).length <= 2) {
        if (!/\d/.test(parsed.value) && !PROCESS_KEYWORDS.test(baseLabel)) continue;
      }
      if (parsed.type === "text" && parsed.value.length > 80) continue;

      const label = qualifier ? `${baseLabel} · ${qualifier}` : baseLabel;
      const category = classify(baseLabel, parsed, setpoint);

      const counterKey = `${section}|${label}`;
      const n = (counters.get(counterKey) || 0) + 1;
      counters.set(counterKey, n);

      found.push({
        id: `${slug(section)}__${slug(label)}__${hash(counterKey)}__${n}`,
        section,
        label,
        baseLabel: label,
        occurrence: n,
        counterKey,
        setpoint,
        unit: parsed.unit || parenUnit || "",
        valueType: parsed.type === "number" ? "number" : "text",
        value: parsed.value,
        category,
        page: page.index,
      });
    }
  }

  // Sólo se numera como "Lectura N" lo que realmente se repite.
  for (const p of found) {
    if (counters.get(p.counterKey) > 1) {
      p.label = `${p.baseLabel} — Lectura ${p.occurrence}`;
    }
  }

  return found;
}
