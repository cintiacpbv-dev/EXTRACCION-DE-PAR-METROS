// El apartado de resumen que se añade al final del protocolo actualizado.
//
// Un protocolo revisado no se entrega solo: hay que poder decir qué cambió,
// contra qué registro y de dónde sale cada valor, sin volver a comparar los
// dos documentos. Eso es lo que va aquí, dentro del propio archivo, para que
// el protocolo lleve encima su propio registro de cambios.
//
// Se escribe en el XML de Word a mano, como el resto de este módulo: montar
// un documento aparte con la librería que genera el FORMATO A09 obligaría a
// fusionar dos archivos, que es bastante más frágil que añadir párrafos al
// final del cuerpo.

const FUENTE = "Arial";
const ANCHO_UTIL = 9071; // A4 vertical con los márgenes del protocolo

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Un run con la letra del protocolo. El orden de las propiedades lo fija Word. */
function run(texto, { negrita = false, tam = 20, gris = false } = {}) {
  const props =
    `<w:rPr><w:rFonts w:ascii="${FUENTE}" w:hAnsi="${FUENTE}" w:cs="${FUENTE}"/>` +
    (negrita ? "<w:b/>" : "") +
    (gris ? '<w:color w:val="595959"/>' : "") +
    `<w:sz w:val="${tam}"/><w:szCs w:val="${tam}"/></w:rPr>`;
  return `<w:r>${props}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;
}

function parrafo(texto, opciones = {}) {
  const { antes = 120, despues = 120, ...resto } = opciones;
  return (
    `<w:p><w:pPr><w:spacing w:before="${antes}" w:after="${despues}"/>` +
    `<w:jc w:val="${opciones.centrado ? "center" : "both"}"/></w:pPr>` +
    (texto ? run(texto, resto) : "") +
    "</w:p>"
  );
}

const SALTO_DE_PAGINA = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const BORDES =
  "<w:tblBorders>" +
  ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((l) => `<w:${l} w:val="single" w:sz="4" w:space="0" w:color="7F7F7F"/>`)
    .join("") +
  "</w:tblBorders>";

function celda(texto, ancho, { negrita = false, fondo = null } = {}) {
  const props =
    `<w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>` +
    (fondo ? `<w:shd w:val="clear" w:color="auto" w:fill="${fondo}"/>` : "") +
    "<w:vAlign w:val=\"center\"/></w:tcPr>";
  const contenido =
    `<w:p><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>${run(texto, { negrita, tam: 17 })}</w:p>`;
  return `<w:tc>${props}${contenido}</w:tc>`;
}

/**
 * Una tabla con su cabecera. `anchos` reparte el ancho útil de la hoja; la
 * cabecera se repite si la tabla parte de página, que es lo normal en un
 * resumen largo.
 */
function tabla(cabecera, filas, anchos) {
  const grid = anchos.map((a) => `<w:gridCol w:w="${a}"/>`).join("");
  const cab =
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    cabecera.map((t, i) => celda(t, anchos[i], { negrita: true, fondo: "DCE6F1" })).join("") +
    "</w:tr>";
  const cuerpo = filas
    .map((f) => "<w:tr>" + f.map((t, i) => celda(t, anchos[i])).join("") + "</w:tr>")
    .join("");

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${ANCHO_UTIL}" w:type="dxa"/>${BORDES}` +
    '<w:tblLayout w:type="fixed"/></w:tblPr>' +
    `<w:tblGrid>${grid}</w:tblGrid>${cab}${cuerpo}</w:tbl>`
  );
}

function fecha() {
  return new Date().toISOString().slice(0, 10);
}

/** Dónde estaba el setpoint, dicho en corto: el paso del registro. */
function origen(entrada) {
  const ev = String(entrada.evidencia || "");
  const paso = ev.match(/^([\d.]+)\s·/);
  return paso ? `Paso ${paso[1]}` : "—";
}

/**
 * El nombre de la operación, sin la lista de equipos que la acompaña.
 * "Fundido de Polietilenglicol 3350 – Tanque con Agitador y Sistema de
 * Calentamiento + Espátula de acero inoxidable (Por fracción)" ocupa media
 * columna y lo que identifica el paso son las tres primeras palabras.
 */
function operacion(contexto) {
  return String(contexto || "")
    .split(/\s[–—-]\s/)[0]
    .replace(/\s*\(Por fracci[óo]n\)\s*$/i, "")
    .trim();
}

/**
 * Junta las entradas que dicen lo mismo.
 *
 * El protocolo declara cada setpoint en dos capítulos —el del análisis de
 * riesgo y el del diseño de la validación—, así que cada cambio aparece dos
 * veces. Repetirlo en el resumen sólo obliga a leerlo dos veces para
 * descubrir que es el mismo; se cuenta cuántos cuadros lo llevan y basta.
 */
function agrupar(entradas, valor) {
  const mapa = new Map();
  for (const e of entradas) {
    // Sin distinguir mayúsculas: un capítulo escribe "Envase – Sacheteadora"
    // y el otro "ENVASE – Sacheteadora", y es el mismo paso.
    const clave = `${operacion(e.contexto)}|${e.parametro}|${e.actual}|${valor(e)}`.toUpperCase();
    const previo = mapa.get(clave);
    if (previo) previo.veces += 1;
    else mapa.set(clave, { entrada: e, veces: 1 });
  }
  return [...mapa.values()];
}

/**
 * El apartado entero, listo para insertarse antes del cierre del cuerpo.
 *
 * Se cuentan las cuatro situaciones por separado porque significan cosas
 * distintas: lo que se cambió, lo que difiere y no se aceptó, lo que ya
 * coincidía y lo que no se pudo contrastar. Esto último no es "está bien":
 * es trabajo que queda por hacer a mano, y por eso se lista entero.
 */
export function xmlResumen({ aplicados, noAplicados, iguales, sinEvidencia, registros }) {
  const partes = [SALTO_DE_PAGINA];

  partes.push(
    `<w:p><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr>${run(
      "RESUMEN DE ACTUALIZACIÓN CONTRA EL REGISTRO DE MANUFACTURA VIGENTE",
      { negrita: true, tam: 24 }
    )}</w:p>`
  );

  partes.push(
    parrafo(
      `Comparación realizada el ${fecha()} entre este protocolo y ${
        registros.length === 1 ? "el registro de manufactura" : "los registros de manufactura"
      } en vigor: ${registros.join(", ")}.`
    )
  );

  partes.push(parrafo("1. Setpoints actualizados en este protocolo", { negrita: true, antes: 240 }));
  if (aplicados.length === 0) {
    partes.push(parrafo("Ninguno: no se aplicó ningún cambio."));
  } else {
    const grupos = agrupar(aplicados, (e) => e.textoNuevo);
    partes.push(
      parrafo(
        `${grupos.length} setpoints distintos, ${aplicados.length} celdas en total (cada uno se declara en el capítulo de análisis de riesgo y en el de diseño de la validación). Van resaltados en amarillo en sus cuadros.`
      )
    );
    partes.push(
      tabla(
        ["Operación", "Parámetro", "Decía el protocolo", "Dice el registro", "Origen", "Cuadros"],
        grupos.map(({ entrada: e, veces }) => [
          operacion(e.contexto), e.parametro, e.actual, e.textoNuevo, origen(e), String(veces),
        ]),
        [2000, 1700, 1500, 1600, 1200, 1071]
      )
    );
    partes.push(parrafo(""));
  }

  partes.push(
    parrafo("2. Diferencias detectadas que NO se aplicaron", { negrita: true, antes: 240 })
  );
  if (noAplicados.length === 0) {
    partes.push(parrafo("Ninguna: se aplicaron todas las diferencias encontradas."));
  } else {
    partes.push(
      parrafo(
        "El registro dice algo distinto en estos puntos, pero el cambio se descartó al revisarlo. Se dejan anotados para que la decisión quede a la vista."
      )
    );
    partes.push(
      tabla(
        ["Operación", "Parámetro", "Dice el protocolo", "Dice el registro", "Origen", "Cuadros"],
        agrupar(noAplicados, (e) => e.propuesta).map(({ entrada: e, veces }) => [
          operacion(e.contexto), e.parametro, e.actual, e.propuesta || "—", origen(e), String(veces),
        ]),
        [2000, 1700, 1500, 1600, 1200, 1071]
      )
    );
    partes.push(parrafo(""));
  }

  partes.push(parrafo("3. Setpoints verificados sin cambio", { negrita: true, antes: 240 }));
  const confirmados = agrupar(iguales, (e) => e.actual);
  partes.push(
    parrafo(
      confirmados.length === 0
        ? "Ninguno pudo confirmarse contra el registro."
        : `${confirmados.length} setpoints del protocolo se contrastaron contra el registro vigente y dicen lo mismo: ${confirmados
            .map(({ entrada: e }) => `${e.parametro} (${e.actual})`)
            .join("; ")}.`
    )
  );

  partes.push(
    parrafo("4. Pendiente de revisar a mano", { negrita: true, antes: 240 })
  );
  if (sinEvidencia.length === 0) {
    partes.push(parrafo("Nada: todos los setpoints del protocolo pudieron contrastarse."));
  } else {
    partes.push(
      parrafo(
        `En ${agrupar(sinEvidencia, () => "").length} setpoints no se encontró en el registro una frase que fije ese valor, así que no se pudo confirmar ni desmentir. Quedan por revisar contra el registro y contra los cuadros de equipos, materiales y criterios de aceptación, que este resumen no cubre.`
      )
    );
    partes.push(
      tabla(
        ["Operación", "Parámetro", "Dice el protocolo", "Cuadros"],
        agrupar(sinEvidencia, () => "").map(({ entrada: e, veces }) => [
          operacion(e.contexto), e.parametro, e.actual, String(veces),
        ]),
        [2600, 2400, 2900, 1171]
      )
    );
    partes.push(parrafo(""));
  }

  return partes.join("");
}
