// Estado de la hoja de trabajo del módulo de Análisis Estadístico.
//
// Guarda las columnas, no las filas: un pegado masivo de Excel llega como
// texto por columnas, los cálculos estadísticos siempre operan sobre una
// columna a la vez, y detectar o corregir el tipo de un dato (numérico,
// texto, fecha) es una decisión por columna. Guardar filas de objetos
// obligaría a transponer en cada paso.
//
// Zustand en vez de Context: con miles de filas pegadas, un Context
// re-renderiza todo lo que lo consume en cada cambio. Aquí la grilla se
// entera de los cambios en "columns" y el panel de resultados no se entera
// de nada hasta que hay un resultado nuevo.
import { create } from "zustand";
import { detectarTipo } from "./csv.js";
import { calcularFormula, esFormula } from "./formulas.js";

// Una hoja nace del tamaño de la de Minitab: columnas y filas de sobra, para
// que la vista se llene y no quede medio panel en blanco esperando. No cuesta
// nada tenerlas: sólo se dibujan las celdas que caben en pantalla, y una
// columna vacía es un array de nulos.
const COLUMNAS_INICIALES = 50;
const FILAS_INICIALES = 500;

let contadorColumnas = 0;
let contadorHojas = 0;

function columnaVacia(filas) {
  contadorColumnas += 1;
  return {
    id: `c${contadorColumnas}`,
    // Lo que escriba la persona en la fila de nombres. Nace vacío: en Minitab
    // "C1" es la etiqueta fija y la fila de debajo se deja libre.
    nombre: "",
    name: `C${contadorColumnas}`,
    type: "numeric",
    values: new Array(filas).fill(null),
    // Lo que se escribió en las celdas que llevan fórmula, tal cual, para
    // poder volver a mostrarlo al editarlas y recalcularlas cuando cambie
    // algún dato del que dependen.
    formulas: {},
  };
}

function columnasEnBlanco() {
  contadorColumnas = 0;
  return Array.from({ length: COLUMNAS_INICIALES }, () => columnaVacia(FILAS_INICIALES));
}

/** Una hoja de trabajo nueva, con su nombre correlativo — "Hoja de trabajo 3". */
function hojaNueva(columns) {
  contadorHojas += 1;
  return { id: `h${contadorHojas}`, nombre: `Hoja de trabajo ${contadorHojas}`, columns: columns || columnasEnBlanco() };
}

/** Convierte texto pegado o escrito a mano al tipo declarado de la columna. */
export function coerce(tipo) {
  return (texto) => {
    if (texto == null) return null;
    const t = String(texto).trim();
    if (t === "") return null;
    if (tipo === "numeric") {
      const n = Number(t.replace(",", "."));
      return Number.isNaN(n) ? null : n;
    }
    if (tipo === "date") {
      const d = new Date(t);
      return Number.isNaN(d.getTime()) ? t : d.toISOString().slice(0, 10);
    }
    return t;
  };
}

/**
 * Recalcula el tipo de una columna a partir de su propio contenido, como
 * hace Minitab: no se declara aparte, se deduce de lo que hay escrito.
 * "valoresTexto" son los valores ya en texto (antes de convertir), para
 * poder decidir el tipo antes de saber con qué convertirlos.
 *
 * Las celdas con fórmula no votan el tipo: lo que hay escrito en ellas es
 * "=C1*2", que como texto arrastraría toda la columna a tipo texto aunque su
 * resultado sea un número.
 */
function recalcularColumna(c, valoresTexto) {
  const sinFormulas = valoresTexto.map((t, i) => (c.formulas?.[i] ? "" : t));
  // Una columna sin nada escrito no es de texto: está vacía, y se rotula "C1"
  // a secas, como en Minitab. detectarTipo() da "text" cuando no hay ningún
  // valor que mirar, y eso marcaba "C1-T" a columnas en blanco en cuanto algo
  // las hacía recalcularse — con lo que el Asistente ya no las daba por
  // numéricas al empezar a escribirlas.
  const tipo = sinFormulas.every((t) => t.trim() === "") ? "numeric" : detectarTipo(sinFormulas);
  const convertir = coerce(tipo);
  return { ...c, type: tipo, values: valoresTexto.map((t, i) => (c.formulas?.[i] ? c.values[i] : t.trim() === "" ? null : convertir(t))) };
}

/** Los valores ya guardados, de vuelta a texto — para recalcular el tipo sin perder lo que ya había. */
function aTexto(values) {
  return values.map((v) => (v == null ? "" : String(v)));
}

/** La etiqueta fija de una columna por su posición: C1, C2, C3… como Minitab. */
export function etiquetaColumna(indice) {
  return `C${indice + 1}`;
}

/**
 * Deja cada columna con un "name" utilizable.
 *
 * La fila de nombres de la hoja se deja en blanco a propósito —es de quien la
 * usa, para escribir "pH 1"—, pero todo lo demás (los títulos de los
 * gráficos, los ejes, las tablas de resultados) necesita llamar a la columna
 * de alguna forma. Sin nombre propio, se usa su etiqueta: "C1".
 *
 * Se hace aquí, en un solo sitio, en vez de repetir "c.name || C1" en las
 * treinta llamadas que lo usan.
 */
function conNombres(columns) {
  return columns.map((c, i) => {
    const propio = String(c.nombre ?? "").trim();
    const name = propio || etiquetaColumna(i);
    return c.name === name ? c : { ...c, name };
  });
}

/**
 * Lo que se muestra al abrir una celda para editarla: la fórmula tal como se
 * escribió, si la tiene, y si no el valor. Editar una celda con fórmula tiene
 * que enseñar la fórmula, no su resultado — si no, no habría forma de
 * corregirla.
 */
export function textoDeCelda(columna, fila) {
  const formula = columna?.formulas?.[fila];
  if (formula) return formula;
  const v = columna?.values?.[fila];
  return v == null ? "" : String(v);
}

/**
 * Calcula todas las fórmulas de la hoja.
 *
 * Se recalcula la hoja entera ante cualquier cambio, sin seguir qué depende
 * de qué: son hojas de unas pocas columnas y unos cientos de filas, y un
 * grafo de dependencias sería mucha maquinaria para no notar la diferencia.
 *
 * Una fórmula que no se puede calcular deja su celda vacía y guarda el motivo
 * en "errores", para poder enseñarlo en la propia celda.
 */
function recalcularFormulas(columns) {
  const porNombre = new Map();
  columns.forEach((c, i) => {
    porNombre.set(etiquetaColumna(i).toUpperCase(), i);
    const propio = String(c.name || "").trim().toUpperCase();
    // El nombre que le puso la persona también sirve para referirse a ella,
    // siempre que sea una sola palabra: "=pH 1*2" no se podría separar.
    if (propio && !/\s/.test(propio) && !porNombre.has(propio)) porNombre.set(propio, i);
  });

  const numerosDe = (indice) => columns[indice].values.filter((v) => typeof v === "number" && Number.isFinite(v));

  return columns.map((c) => {
    const claves = Object.keys(c.formulas || {});
    if (claves.length === 0) return c.errores ? { ...c, errores: undefined } : c;

    const values = [...c.values];
    const errores = {};

    for (const clave of claves) {
      const fila = Number(clave);
      const contexto = {
        celda: (nombre) => {
          const i = porNombre.get(nombre);
          return i === undefined ? null : columns[i].values[fila] ?? null;
        },
        columna: (nombre) => {
          const i = porNombre.get(nombre);
          return i === undefined ? [] : numerosDe(i);
        },
      };
      const r = calcularFormula(c.formulas[clave], contexto);
      values[fila] = r.error ? null : r.valor;
      if (r.error) errores[fila] = r.error;
    }

    // Con las fórmulas ya calculadas se puede decidir el tipo de la columna.
    // Arriba, al escribirla, las celdas con fórmula no votan —lo escrito en
    // ellas es "=PROMEDIO(C1)", que como texto arrastraría la columna entera—,
    // y una columna que sólo lleva fórmulas se quedaba sin nada que votara y
    // salía marcada "C3-T", de texto: el Asistente no la ofrecía para ningún
    // análisis aunque su contenido fueran números.
    const tipo = detectarTipo(values.map((v) => (v == null ? "" : String(v))));

    return { ...c, type: tipo, values, errores: Object.keys(errores).length ? errores : undefined };
  });
}

/**
 * Escribe una lista de celdas —{ colIdx, filaIdx, texto }— de una vez.
 *
 * Todo lo que cambia la hoja pasa por aquí: escribir a mano, pegar un bloque,
 * arrastrar el tirador, borrar una selección. Hacerlo en una sola pasada
 * importa: recalcular tipos y fórmulas una vez por celda al pegar mil celdas
 * dejaba la pantalla colgada.
 */
function escribirCeldas(columns, cambios) {
  if (cambios.length === 0) return columns;

  const filaMax = Math.max(...cambios.map((c) => c.filaIdx)) + 1;
  const porColumna = new Map();
  for (const cambio of cambios) {
    if (!porColumna.has(cambio.colIdx)) porColumna.set(cambio.colIdx, []);
    porColumna.get(cambio.colIdx).push(cambio);
  }

  const siguientes = columns.map((c, i) => {
    const mios = porColumna.get(i);
    const necesitaCrecer = c.values.length < filaMax;
    if (!mios && !necesitaCrecer) return c;

    const valoresTexto = aTexto(c.values);
    while (valoresTexto.length < filaMax) valoresTexto.push("");
    if (!mios) return { ...c, values: valoresTexto.map((t, k) => (c.formulas?.[k] ? c.values[k] : t === "" ? null : c.values[k])) };

    const formulas = { ...(c.formulas || {}) };
    for (const { filaIdx, texto } of mios) {
      if (esFormula(texto)) {
        formulas[filaIdx] = texto;
        valoresTexto[filaIdx] = "";
      } else {
        delete formulas[filaIdx];
        valoresTexto[filaIdx] = texto ?? "";
      }
    }
    return recalcularColumna({ ...c, formulas }, valoresTexto);
  });

  return recalcularFormulas(conNombres(siguientes));
}

// Qué paneles laterales quedan abiertos. Se recuerda entre sesiones porque es
// una preferencia de cómo se trabaja, no del análisis en curso: quien tiene la
// pantalla chica cierra el Navegador y lo quiere cerrado la próxima vez.
const CLAVE_PANELES = "deteccion-parametros:estadistica:paneles:v1";

function panelesGuardados() {
  try {
    const raw = localStorage.getItem(CLAVE_PANELES);
    const p = raw ? JSON.parse(raw) : null;
    return {
      navegador: p?.navegador !== false,
      asistente: p?.asistente !== false,
      hoja: p?.hoja !== false,
      // Los laterales se pliegan solos cuando llevan un rato sin tocarse.
      // Va activado de fábrica: lo que se viene a mirar aquí es el gráfico,
      // y son esos dos paneles los que le quitan el ancho.
      auto: p?.auto !== false,
    };
  } catch {
    return { navegador: true, asistente: true, hoja: true, auto: true };
  }
}

function recordarPaneles(paneles) {
  try {
    localStorage.setItem(CLAVE_PANELES, JSON.stringify(paneles));
  } catch {
    // Sin memoria del navegador se abren todos, que es lo de siempre.
  }
}

/**
 * Devuelve el trozo de estado que deja las columnas nuevas en su sitio.
 *
 * Las columnas viven dos veces: sueltas en "columns" —de donde las leen la
 * hoja, el Asistente y los gráficos, que sólo saben de la hoja que está a la
 * vista— y dentro de su hoja en "hojas", que es lo que permite cambiar de
 * pestaña sin perder nada. Todo lo que las modifica pasa por aquí, así que
 * las dos copias no pueden separarse.
 */
function conColumnas(s, columns) {
  return {
    columns,
    hojas: s.hojas.map((h, i) => (i === s.hojaActiva ? { ...h, columns } : h)),
  };
}

const HOJA_INICIAL = hojaNueva();

export const useWorkbookStore = create((set) => ({
  hojas: [HOJA_INICIAL],
  hojaActiva: 0,
  columns: HOJA_INICIAL.columns,
  resultados: [],
  graficos: [],
  paneles: panelesGuardados(),
  // Qué resultado o gráfico se muestra en el visor principal — como el
  // Navegador de Minitab, que abre en grande lo último que se generó, y de
  // ahí en adelante lo que se elija de la lista.
  seleccionActual: null,
  // Sólo para esta sección: el resto de la app se comprometió con un único
  // tema oscuro, pero la hoja de trabajo y las tablas de resultados se
  // leen igual de bien —o mejor, para quien está acostumbrada a Minitab—
  // en claro, así que aquí sí vale la pena dejarlo a elección.
  temaClaro: false,

  alternarTema() {
    set((s) => ({ temaClaro: !s.temaClaro }));
  },

  /** Abre o cierra un panel lateral ("navegador", "asistente" u "hoja"). */
  alternarPanel(cual) {
    set((s) => {
      const paneles = { ...s.paneles, [cual]: !s.paneles[cual] };
      recordarPaneles(paneles);
      return { paneles };
    });
  },

  /**
   * Cambia el título de un gráfico o de una tabla de resultados.
   *
   * El título es lo que identifica al elemento en el Navegador y lo que se
   * imprime encima del gráfico al exportarlo, así que poder corregirlo
   * importa: "Histograma — C1" no dice nada en un protocolo, "Uniformidad de
   * contenido — lote 2074686" sí.
   */
  renombrarSalida(tipo, id, titulo) {
    set((s) =>
      tipo === "grafico"
        ? { graficos: s.graficos.map((g) => (g.id === id ? { ...g, titulo } : g)) }
        : { resultados: s.resultados.map((r) => (r.id === id ? { ...r, titulo } : r)) }
    );
  },

  seleccionar(seleccion) {
    set({ seleccionActual: seleccion });
  },

  renombrarColumna(id, nombre) {
    // Renombrar puede cambiar a qué apunta una fórmula que use ese nombre.
    set((s) => conColumnas(s, recalcularFormulas(conNombres(s.columns.map((c) => (c.id === id ? { ...c, nombre } : c))))));
  },

  agregarColumna() {
    set((s) => conColumnas(s, conNombres([...s.columns, columnaVacia(s.columns[0]?.values.length || FILAS_INICIALES)])));
  },

  eliminarColumna(id) {
    // Al quitar una columna, las etiquetas C1, C2… de las que vienen detrás
    // se corren, y con ellas lo que significan las fórmulas que las nombran.
    set((s) => conColumnas(s, recalcularFormulas(conNombres(s.columns.filter((c) => c.id !== id)))));
  },

  agregarFilas(cantidad = 20) {
    set((s) => conColumnas(s, s.columns.map((c) => ({ ...c, values: [...c.values, ...new Array(cantidad).fill(null)] }))));
  },

  /** Escribe una celda (edición manual desde la hoja). */
  setCelda(colIdx, filaIdx, valorTexto) {
    set((s) => conColumnas(s, escribirCeldas(s.columns, [{ colIdx, filaIdx, texto: valorTexto }])));
  },

  /**
   * Escribe muchas celdas de una vez: pegar un bloque, arrastrar el tirador,
   * borrar o cortar una selección. `cambios` son { colIdx, filaIdx, texto }.
   */
  setCeldas(cambios) {
    set((s) => conColumnas(s, escribirCeldas(s.columns, cambios)));
  },

  /**
   * Pega un bloque rectangular (filas x columnas, ya separado en texto)
   * empezando en una celda: cada columna del bloque cae en la columna que le
   * toca a la derecha del inicio, y la hoja crece si el bloque trae más filas
   * de las que hay.
   */
  pegarBloque(colIdxInicio, filaIdxInicio, bloque) {
    if (bloque.length === 0) return;
    set((s) => {
      const cambios = [];
      for (let r = 0; r < bloque.length; r++) {
        for (let k = 0; k < bloque[r].length; k++) {
          const colIdx = colIdxInicio + k;
          if (colIdx >= s.columns.length) continue;
          cambios.push({ colIdx, filaIdx: filaIdxInicio + r, texto: bloque[r][k] ?? "" });
        }
      }
      return conColumnas(s, escribirCeldas(s.columns, cambios));
    });
  },

  // ---- Hojas de trabajo ---------------------------------------------
  // Varias hojas en el mismo proyecto, como en Minitab: los datos de cada
  // lote, de cada producto o de cada estudio en la suya, sin tener que
  // vaciar la anterior para empezar la siguiente. Los resultados y los
  // gráficos son del proyecto entero y no de una hoja: un informe compara
  // cosas de varias.

  agregarHoja() {
    set((s) => {
      const hoja = hojaNueva();
      return { hojas: [...s.hojas, hoja], hojaActiva: s.hojas.length, columns: hoja.columns };
    });
  },

  elegirHoja(indice) {
    set((s) => {
      const i = Math.max(0, Math.min(s.hojas.length - 1, indice));
      return { hojaActiva: i, columns: s.hojas[i].columns };
    });
  },

  renombrarHoja(indice, nombre) {
    set((s) => ({ hojas: s.hojas.map((h, i) => (i === indice ? { ...h, nombre: nombre.trim() || h.nombre } : h)) }));
  },

  /** Cierra una hoja. Nunca deja el proyecto sin ninguna. */
  eliminarHoja(indice) {
    set((s) => {
      if (s.hojas.length <= 1) return {};
      const hojas = s.hojas.filter((_, i) => i !== indice);
      const activa = Math.max(0, Math.min(hojas.length - 1, s.hojaActiva > indice ? s.hojaActiva - 1 : s.hojaActiva));
      return { hojas, hojaActiva: activa, columns: hojas[activa].columns };
    });
  },

  /**
   * Importar CSV/Excel. filasATablero() ya trae el tipo detectado de cada
   * columna, así que aquí sólo hace falta convertir los valores con él.
   *
   * Lo importado entra en una hoja nueva y no encima de la que se está
   * usando —igual que "Abrir hoja de trabajo" en Minitab—: así traer un
   * archivo no borra lo que ya se tenía escrito ni deja colgados los
   * resultados que salieron de esos datos.
   */
  cargarHoja(columnasNuevas, nombre) {
    contadorColumnas = 0;
    const columns = columnasNuevas.map((c) => {
      contadorColumnas += 1;
      const convertir = coerce(c.type);
      return { id: `c${contadorColumnas}`, nombre: c.name || "", name: c.name || `C${contadorColumnas}`, type: c.type, formulas: {}, values: c.values.map((v) => (v == null ? null : convertir(String(v)))) };
    });
    set((s) => {
      const base = hojaNueva(columns);
      const hoja = nombre ? { ...base, nombre } : base;
      return { hojas: [...s.hojas, hoja], hojaActiva: s.hojas.length, columns };
    });
  },

  /** Vacía la hoja que se está usando; las demás y los resultados siguen. */
  limpiarHoja() {
    set((s) => conColumnas(s, columnasEnBlanco()));
  },

  // Lo último que se genera se abre solo en el visor, como en Minitab: no
  // hace falta ir a buscarlo a la lista para verlo la primera vez.
  registrarResultado(titulo, contenido, advertencias = []) {
    const id = crypto.randomUUID();
    set((s) => ({
      resultados: [...s.resultados, { id, timestamp: Date.now(), titulo, contenido, advertencias }],
      seleccionActual: { tipo: "resultado", id },
    }));
  },

  agregarGrafico(titulo, opciones) {
    const id = crypto.randomUUID();
    set((s) => ({
      graficos: [...s.graficos, { id, timestamp: Date.now(), titulo, opciones }],
      seleccionActual: { tipo: "grafico", id },
    }));
  },

  eliminarResultado(id) {
    set((s) => ({
      resultados: s.resultados.filter((r) => r.id !== id),
      seleccionActual: s.seleccionActual?.tipo === "resultado" && s.seleccionActual.id === id ? null : s.seleccionActual,
    }));
  },

  eliminarGrafico(id) {
    set((s) => ({
      graficos: s.graficos.filter((g) => g.id !== id),
      seleccionActual: s.seleccionActual?.tipo === "grafico" && s.seleccionActual.id === id ? null : s.seleccionActual,
    }));
  },

  limpiarSalida() {
    set({ resultados: [], graficos: [], seleccionActual: null });
  },
}));
