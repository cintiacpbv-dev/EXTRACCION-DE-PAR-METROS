// Las cajas del esquema en la etapa de acondicionado.
//
// Acondicionar no se parte en secciones como fabricar: el registro lo escribe
// casi todo dentro de una sola operación ("OPERACION Nº 2: ACONDICIONADO") y en
// prosa —"ENCAJADO: ARMAR LA CAJA, COLOCAR 20 BLISTERS, 01 FOLLETO DENTRO"—, de
// modo que recorrer sus secciones daba dos cajas donde el formato tiene ocho.
//
// El formato, en cambio, siempre las tiene las mismas y en el mismo orden:
// codificar las cajas, armarlas, encajar, armar la caja de embalaje, embalar,
// sellar, apilar. Eso es estructura del proceso, no dato del lote, así que va
// escrito aquí — igual que en el cuadro de verificación del Formato 09
// (parsers/estandarAcondicionado.js), y con los mismos nombres para que los dos
// documentos hablen igual.
//
// Los números sí salen del registro: cuántos blísteres por caja, cómo se
// distribuyen en la de embalaje, cuántas caben en la parihuela. Lo que no esté
// en él queda en blanco.
//
// Tomado del Formato 01 de DOLORAL CB 400 mg y de la Adenda N° 4 al reporte.

import { criteriosAcondicionado } from "../parsers/acondicionado.js";
import { detectOpciones } from "../parsers/opciones.js";

export const ETAPA = "ACONDICIONADO";

// Qué insumo entra en qué operación. Se reconoce por cómo lo nombra la lista
// de materiales del registro, que es estable entre productos: la caja del
// producto, el folleto, la caja de embalaje y la cinta.
const INSUMO_DE = [
  { operacion: "Codificado de cajas", re: /^CJA\s+(?!DE\s+EMBALAJE)/i },
  { operacion: "Encajado manual", re: /^FOLLETO/i },
  { operacion: "Armado manual de cajas de embalaje", re: /^CJA\s+DE\s+EMBALAJE/i },
  { operacion: "Sellado manual de cajas de embalaje", re: /^CINTA/i },
];

// El equipo de cada operación cuando el registro no lo nombra en su lista.
// Son los del formato: en acondicionado la mayor parte del trabajo es manual
// y sus útiles no están inventariados como equipos calificables.
const EQUIPO_POR_DEFECTO = {
  "Armado manual de cajas": "Faja transportadora de acero inoxidable",
  "Encajado manual": "Faja transportadora de acero inoxidable",
  "Armado manual de cajas de embalaje": "Caballete de acero inoxidable + dispensador de cinta",
  "Embalado manual": "Caballete de acero inoxidable",
  "Sellado manual de cajas de embalaje": "Caballete de acero inoxidable + dispensador de cinta",
  "Apilamiento manual de cajas de embalaje": "Parihuela",
};

/** El equipo del inventario cuyo nombre empieza igual, si lo hay. */
function delInventario(equipos, patron) {
  return equipos.find((e) => patron.test(e));
}

/** La codificadora que se marcó en el registro, de entre las tres posibles. */
function codificadoraElegida(pages) {
  for (const bloque of detectOpciones(pages)) {
    if (!/IMPRESI[OÓ]N\s+DE\s+CAJAS/i.test(bloque.seccion || "")) continue;
    const elegida = bloque.opciones.find((o) => o.elegida);
    if (elegida) return elegida.texto;
  }
  return "";
}

/** La velocidad de faja que declara el paso de impresión de cajas. */
function velocidadDeFaja(params) {
  const p = params.find(
    (x) => /VELOCIDAD\s+DE\s+LA\s+FAJA/i.test(x.label || "") && x.setpoint
  );
  return p ? { etiqueta: p.label, rango: p.setpoint } : null;
}

/**
 * Las operaciones del acondicionado, en el orden en que las dibuja el formato.
 *
 * `params`, `equipos` e `insumos` son los que ya leyó el modelo; aquí sólo se
 * reparten entre las cajas.
 */
export function operacionesDeAcondicionado(pages, { params, equipos, insumos }) {
  const criterios = criteriosAcondicionado(pages);
  const faja = velocidadDeFaja(params);
  const codificadora = codificadoraElegida(pages);

  const cadena = [
    {
      titulo: "Codificado de cajas",
      lineas: [
        "Codificado: Según orden de acondicionado",
        ...(faja ? [`V de faja transportadora: ${faja.rango}`] : []),
      ],
      equipo: [
        codificadora || delInventario(equipos, /^CODIFICADORA|^LOTIZADORA/i),
        delInventario(equipos, /^FAJA\s+TRANSPORTADORA\s+N/i),
      ].filter(Boolean),
    },
    {
      titulo: "Armado manual de cajas",
      lineas: ["Armado de cajas: Cajas íntegras, correctamente armadas"],
    },
    {
      titulo: "Encajado manual",
      lineas: [`Contenido por caja: ${criterios.contenidoPorCaja || ""}`.trim()],
    },
    {
      titulo: "Armado manual de cajas de embalaje",
      lineas: ["Armado de cajas de embalaje: Cajas íntegras, correctamente armadas"],
    },
    {
      titulo: "Embalado manual",
      lineas: [
        `Contenido por caja de embalaje: ${criterios.contenidoCajaEmbalaje || ""}`.trim(),
        `Distribución por caja de embalaje: ${criterios.distribucionCajaEmbalaje || ""}`.trim(),
      ],
    },
    {
      titulo: "Sellado manual de cajas de embalaje",
      lineas: ["Sellado de cajas: Caja correctamente sellada"],
    },
    {
      titulo: "Apilamiento manual de cajas de embalaje",
      lineas: [
        `Número de cajas de embalaje por parihuela: ${criterios.cajasPorParihuela || ""}`.trim(),
        `Distribución por parihuela: ${criterios.distribucionParihuela || ""}`.trim(),
      ],
    },
    {
      titulo: "Producto listo para almacenar y comercializar",
      lineas: [],
    },
  ];

  return cadena.map((op) => ({
    seccion: `${ETAPA}::${op.titulo}`,
    titulo: op.titulo,
    // Un criterio que el registro no trae deja la línea colgando de sus dos
    // puntos; mejor no dibujarla y que se vea que falta.
    lineas: (op.lineas || []).filter((l) => l && !l.endsWith(":")),
    equipo: op.equipo?.length ? op.equipo : [EQUIPO_POR_DEFECTO[op.titulo]].filter(Boolean),
    insumos: insumosDe(op.titulo, insumos),
  }));
}

function insumosDe(operacion, insumos) {
  const regla = INSUMO_DE.find((r) => r.operacion === operacion);
  if (!regla) return [];

  const vistos = new Set();
  const salida = [];
  for (const i of insumos) {
    if (!regla.re.test(i.nombre)) continue;
    const texto = `${i.nombre}${i.cantidad ? `: ${i.cantidad}` : ""}`;
    if (vistos.has(texto)) continue;
    vistos.add(texto);
    salida.push(texto);
  }
  return salida;
}
