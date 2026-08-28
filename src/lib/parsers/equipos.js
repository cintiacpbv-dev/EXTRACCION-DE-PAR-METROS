// Lector de la sección EQUIPOS / INSTRUMENTOS / MATERIALES del registro de
// manufactura: qué máquinas intervinieron en cada etapa.
//
// Es una tabla de columnas reales, no el patrón "etiqueta + relleno + valor"
// del detector genérico, así que necesita su propio lector — igual que la
// sección de insumos.
//
// El formato de la tabla cambió entre ediciones del registro. Las antiguas
// traen dos columnas (Descripción, Código SAP) y las nuevas tres, añadiendo
// el código de referencia con el que se identifica el equipo en el plan de
// calificación ("SOL-E011"). Se leen las dos: sin ese código de referencia el
// equipo se reconoce después por su código SAP, que sí está en ambas.

import { norm } from "./utils.js";

const SECCION_RE = /^\d+(\.\d+)*\.-\s*EQUIPOS\b/i;
const OTRA_SECCION_RE = /^\d+(\.\d+)*\.-\s*\S/;
const VERIFICADO_RE = /^VERIFICADO\s+POR/i;
// Cabecera de la tabla; se repite en cada página que la sección ocupa.
const CABECERA_RE = /^Descripci[óo]n\s+C[óo]digo/i;
const NOTA_RE = /^\(Colocar\b/i;

// Un código SAP son ocho dígitos ("10001665"); uno de referencia lleva la
// sección delante ("SOL-E011", "SOL-E138-A03", "ACO-UG-E05").
const SAP = String.raw`\d{8}`;
const REF = String.raw`[A-Z]{2,4}-[A-Z0-9-]*`;

// "<descripción> <SAP> <referencia>" (tres columnas), "<descripción> <SAP>" o
// "<descripción> <referencia>" (dos). La referencia puede venir como "-"
// cuando el equipo no tiene una.
const FILA_RE = new RegExp(
  String.raw`^(.+?)\s+(${SAP}|${REF})(?:\s+(${REF}|-))?$`
);

/**
 * Un equipo se da por calificable cuando su código SAP empieza por 1.
 *
 * Es lo que separa las máquinas de todo lo demás que la misma tabla enumera:
 * las balanzas y el termómetro llevan códigos que empiezan por 4 (son
 * instrumentos, van al plan de calibración), y las mallas, bines, mangas y
 * utensilios no tienen código SAP sino uno de accesorio ("SOL-E48-A07",
 * "SOL-UG-F07"). Comprobado contra el Formato 3 de FLUIBRONCOL: sus
 * diecisiete equipos son exactamente los que cumplen esta condición.
 */
export function esEquipoCalificable(equipo) {
  return /^1\d{7}$/.test(equipo.codigoSap || "");
}

/** Equipos declarados en la sección, en el orden en que aparecen. */
export function detectEquipos(pages) {
  const equipos = [];
  const vistos = new Set();
  let dentro = false;

  for (const page of pages) {
    for (const linea of page.lines) {
      const texto = norm(linea.text).trim();
      if (!texto) continue;

      if (!dentro) {
        if (SECCION_RE.test(texto)) dentro = true;
        continue;
      }

      if (VERIFICADO_RE.test(texto) || OTRA_SECCION_RE.test(texto)) {
        dentro = false;
        continue;
      }

      if (CABECERA_RE.test(texto) || NOTA_RE.test(texto)) continue;

      const m = texto.match(FILA_RE);
      if (!m) continue;

      const [, descripcion, primero, segundo] = m;
      const esSap = new RegExp(`^${SAP}$`).test(primero);
      const codigoSap = esSap ? primero : null;
      // En la tabla de tres columnas el código de referencia va detrás del
      // SAP; en la de dos, cuando no hay SAP, el propio código es el de
      // referencia. El guion significa "sin referencia".
      const referencia = segundo && segundo !== "-" ? segundo : esSap ? null : primero;

      const clave = `${codigoSap || ""}|${referencia || ""}|${descripcion}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);

      equipos.push({
        descripcion: descripcion.replace(/\s{2,}/g, " ").trim(),
        codigoSap,
        codigoMif: referencia,
      });
    }
  }

  return equipos;
}
