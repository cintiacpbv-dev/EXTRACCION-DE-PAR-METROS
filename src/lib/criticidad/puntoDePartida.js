// Los parámetros críticos "de punto de partida" del procedimiento.
//
// La Secuencia de elaboración del AR (Tabla 4) lista, por forma
// farmacéutica, los parámetros que la planta ya sabe que suelen ser críticos,
// con su fundamento. Y lo dice con cuidado: "pueden servir como punto de
// partida, sin embargo estos deben ser verificados en cada protocolo de
// validación correspondiente".
//
// Por eso aquí NO deciden nada. La clasificación la sigue dando la severidad
// del atributo, como manda el árbol de decisión. Lo que hacen es avisar: si un
// parámetro de esta lista sale Clave o No Clave, algo no cuadra —o el
// atributo al que apunta tiene una severidad demasiado baja, o el análisis
// de riesgo no lo vinculó a nada— y quien valida tiene que mirarlo. Es
// exactamente la verificación que el procedimiento pide.

const LISTA = [
  // --- EN PARÁMETROS GENERALES
  { forma: "General", parametro: "Peso de IFA(s)", fundamento: "Su variabilidad afecta directamente en el ensayo de valoración.",
    re: /\bpeso\b.*\b(ifa|principio activo|activo)\b/i },

  // --- EN PRODUCTOS SÓLIDOS ORALES
  { forma: "Sólidos orales", parametro: "Pre compresión (Granulación seca) o Amasado (Granulación húmeda)", fundamento: "Su variabilidad puede afectar la homogeneidad de la mezcla; se requiere un rango estrecho o, en caso sea manual, algún patrón de referencia.",
    re: /\b(pre\s*-?\s*compresi|amasado)/i },
  { forma: "Sólidos orales", parametro: "Mezcla final (mezcla directa)", fundamento: "Su variabilidad puede ocasionar una desmezcla del producto.",
    re: /\bmezcla final\b/i },
  { forma: "Sólidos orales", parametro: "Ajuste de dosificación en el tabletado / encapsulado", fundamento: "Su variabilidad puede ocasionar dosis individuales no uniformes.",
    re: /\b(ajuste de (la )?dosificaci|peso de llenado)/i, etapa: /tablet|encapsul/i },
  { forma: "Sólidos orales", parametro: "Temperaturas y presiones de atomización en el recubrimiento", fundamento: "Su variabilidad puede ocasionar dosis individuales no uniformes.",
    re: /\b(temperatura|presi[oó]n)\b.*\batomizaci/i },
  { forma: "Sólidos orales", parametro: "Ajuste de dosificación en envase de polvos para suspensión de dosis unitaria", fundamento: "Su variabilidad puede ocasionar dosis individuales no uniformes.",
    re: /\bajuste de (la )?dosificaci/i, etapa: /polvo|suspensi/i },
  { forma: "Sólidos orales", parametro: "Etiquetado en frascos de polvos para suspensión (volumen de reconstitución)", fundamento: "Su variabilidad puede ocasionar variabilidad en el volumen y la valoración.",
    re: /\betiquetado\b.*\breconstituci|\bvolumen de reconstituci/i },

  // --- EN PRODUCTOS SEMISÓLIDOS
  { forma: "Semisólidos", parametro: "Homogeneización para la emulsión entre fases y formación de una crema", fundamento: "Su variabilidad puede alterar la formación de la crema y su uniformidad.",
    re: /\bhomogeneiza/i, etapa: /emulsi/i },
  { forma: "Semisólidos", parametro: "Homogeneizaciones con adición directa del IFA (cremas, geles, ungüentos, óvulos)", fundamento: "Su variabilidad puede alterar la distribución homogénea del IFA en el producto.",
    re: /\bhomogeneiza/i, etapa: /\b(ifa|principio activo)\b/i },

  // --- EN PRODUCTOS LÍQUIDOS ESTÉRILES / POLVOS ESTÉRILES
  { forma: "Estériles", parametro: "Enrase final", fundamento: "Su variabilidad afecta directamente a la valoración y efectividad del producto.",
    re: /\benrase\b/i },
  { forma: "Estériles", parametro: "Tamaño de poro y material de la membrana en la filtración esterilizante", fundamento: "Su variabilidad afecta directamente en la esterilidad del producto.",
    re: /\b(tama[ñn]o de poro|membrana)\b/i },
  { forma: "Estériles", parametro: "Temperaturas de secado primario y secundario en un liofilizado", fundamento: "Su variabilidad afecta directamente el adecuado secado del producto liofilizado.",
    re: /\bsecado (primario|secundario)\b|\bliofiliz/i },
  { forma: "Estériles", parametro: "Temperaturas, tiempos y velocidad de la faja de despirogenización", fundamento: "Su variabilidad por debajo de lo requerido afecta a la esterilidad.",
    re: /\bdespirogen/i },
  { forma: "Estériles", parametro: "Porcentaje de polietileno por zona en formación de ampollas PEBD", fundamento: "Su variabilidad puede afectar la formación adecuada de la ampolla PEBD.",
    re: /\bpolietileno\b.*\bzona\b|\bpebd\b/i },
  { forma: "Estériles", parametro: "Ajuste de dosificación (monodosis)", fundamento: "Su variabilidad influye directamente en la efectividad del producto; sus rangos deben ser estrechos o exactos.",
    re: /\bmonodosis\b/i },
  { forma: "Estériles", parametro: "Sellado de viales, ampollas, frascos goteros o bolsas", fundamento: "Su variabilidad puede entregar un deficiente sellado afectando la esterilidad del producto.",
    re: /\bsellado\b/i, etapa: /\b(vial|ampolla|gotero|bolsa|estéril|esteril)/i },
  { forma: "Estériles", parametro: "Inspección de partículas visibles", fundamento: "Su variabilidad puede entregar productos con partículas, siendo este proceso el último filtro de inspección antes del acondicionado.",
    re: /\bpart[ií]culas visibles\b/i },
  { forma: "Estériles", parametro: "Inspección de microfisuras (ampollas)", fundamento: "Su variabilidad puede dejar pasar productos no herméticos afectando la esterilidad del producto.",
    re: /\bmicrofisura/i },
  { forma: "Estériles", parametro: "Temperatura y tiempo en esterilización terminal", fundamento: "Su variabilidad afecta directamente a la esterilidad del producto final.",
    re: /\besterilizaci[oó]n terminal\b|\bautoclave\b/i },

  // --- EN PRODUCTOS LÍQUIDOS NO ESTÉRILES
  { forma: "Líquidos no estériles", parametro: "Homogeneizaciones con adición directa del IFA en suspensiones", fundamento: "Su variabilidad afecta la distribución homogénea del IFA en suspensiones.",
    re: /\bhomogeneiza/i, etapa: /suspensi/i },
];

export const PARAMETROS_DE_PARTIDA = LISTA.map(({ forma, parametro, fundamento }) => ({ forma, parametro, fundamento }));

/**
 * La forma farmacéutica del producto, para saber qué parte de la lista le
 * toca.
 *
 * Hace falta: "Sellado de viales, ampollas, frascos goteros o bolsas" es de
 * productos ESTÉRILES —el cierre del envase primario, que protege la
 * esterilidad—, y sin filtrar por forma se enganchaba con el "Tiempo de
 * sellado de bolsas" de la cápsula blanda, que es la bolsa donde se embolsa
 * el granel entre etapas. Mismo verbo, riesgo completamente distinto.
 *
 * Devuelve null si no se puede saber; entonces se mira la lista entera, que
 * es lo prudente para algo que sólo avisa.
 */
export function formaDelProducto(...textos) {
  const t = textos.filter(Boolean).join(" ").toLowerCase();
  if (!t) return null;
  if (/inyectable|ampolla|\bvial|est[ée]ril|liofiliz|parenteral|oft[áa]lmic/.test(t)) return "Estériles";
  if (/crema|\bcrm\b|\bgel\b|ung[üu]ento|[óo]vulo|pomada|emulsi[óo]n t[óo]pica/.test(t)) return "Semisólidos";
  if (/tableta|c[áa]psula|\bcap\b|comprimido|gragea|granulado|polvo para suspensi/.test(t)) return "Sólidos orales";
  if (/jarabe|suspensi[óo]n oral|soluci[óo]n oral|elixir|gotas orales/.test(t)) return "Líquidos no estériles";
  return null;
}

/**
 * Si un parámetro es uno de los de punto de partida del procedimiento.
 *
 * Se busca en el nombre del parámetro y, cuando la entrada lo pide, también
 * en la operación y la etapa: "Ajuste de dosificación" sólo es de partida en
 * el tabletado o el encapsulado, no en cualquier sitio donde se dosifique.
 */
function coincide(e, parametro) {
  const nombre = `${parametro?.magnitud || ""} ${parametro?.ejemplo || ""}`;
  const contexto = `${parametro?.seccion || ""} ${parametro?.etapa || ""}`;
  if (!e.re.test(nombre) && !e.re.test(`${nombre} ${contexto}`)) return false;
  if (e.etapa && !e.etapa.test(`${nombre} ${contexto}`)) return false;
  return true;
}

export function puntoDePartidaDe(parametro, forma = null) {
  for (const e of LISTA) {
    // Lo general vale para todos; lo de una forma, sólo para esa forma.
    if (forma && e.forma !== "General" && e.forma !== forma) continue;
    if (coincide(e, parametro)) return { parametro: e.parametro, fundamento: e.fundamento, forma: e.forma };
  }
  return null;
}

/**
 * La lista de PCP de referencia del formato (3.2), contestada para este
 * producto: por cada entrada que corresponde a su forma farmacéutica, qué
 * parámetros de la evaluación la cubren (con su N°) y cómo quedaron. Las
 * entradas de otras formas se resumen en una fila «N/A».
 */
export function verificacionDeReferencia(filas, { forma = null, numeros = new Map(), CRITICO } = {}) {
  const salida = [];
  for (const e of LISTA) {
    if (forma && e.forma !== "General" && e.forma !== forma) continue;
    const suyas = filas.filter((f) => coincide(e, f));
    const n = suyas.map((f) => numeros.get(f.id)).filter(Boolean).sort((a, b) => a - b);
    const noCriticas = suyas.filter((f) => f.clasificacion !== CRITICO);
    salida.push({
      forma: e.forma,
      parametro: e.parametro,
      fundamento: e.fundamento,
      aplica: suyas.length > 0 ? "Sí" : "No",
      numeros: n,
      nota:
        suyas.length === 0
          ? "No se encontró en el registro evaluado."
          : noCriticas.length
            ? `${noCriticas.length} no quedaron PCP (${noCriticas.map((f) => `${f.magnitud}: ${f.clasificacion || "pendiente"}`).join("; ")}): justificar.`
            : "",
    });
  }
  if (forma) {
    const otras = [...new Set(LISTA.map((e) => e.forma).filter((x) => x !== "General" && x !== forma))];
    salida.push({
      forma: "Otras",
      parametro: `Demás parámetros de la lista (${otras.join(", ").toLowerCase()})`,
      fundamento: `No corresponden a la forma farmacéutica (${forma.toLowerCase()}).`,
      aplica: "N/A",
      numeros: [],
      nota: "",
    });
  }
  return salida;
}

/**
 * Los parámetros de partida que la evaluación NO dejó como Críticos.
 *
 * Es la verificación que pide el procedimiento: la lista es un punto de
 * partida, y cuando la evaluación se aparta de él hay que poder decir por
 * qué. No es un error por sí mismo —puede haber un buen motivo— pero es lo
 * primero que va a preguntar quien revise.
 */
export function partidaSinConfirmar(filas, CRITICO, forma = null) {
  return filas
    .map((f) => ({ fila: f, partida: puntoDePartidaDe(f, forma) }))
    .filter(({ fila, partida }) => partida && fila.clasificacion !== CRITICO)
    .map(({ fila, partida }) => ({
      etapa: fila.etapa,
      parametro: fila.magnitud,
      clasificacion: fila.clasificacion || "Pendiente",
      partida: partida.parametro,
      fundamento: partida.fundamento,
      motivo: !fila.sospecha
        ? "El análisis no lo vincula a ningún atributo de calidad."
        : `Su atributo vinculado tiene severidad ${fila.severidad ?? "sin fijar"}, por debajo de 4.`,
    }));
}
