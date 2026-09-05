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

const COLUMNAS_INICIALES = 8;
const FILAS_INICIALES = 60;

let contadorColumnas = 0;

function columnaVacia(filas) {
  contadorColumnas += 1;
  return {
    id: `c${contadorColumnas}`,
    name: `C${contadorColumnas}`,
    type: "numeric",
    values: new Array(filas).fill(null),
  };
}

function hojaEnBlanco() {
  contadorColumnas = 0;
  return Array.from({ length: COLUMNAS_INICIALES }, () => columnaVacia(FILAS_INICIALES));
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
 */
function recalcularColumna(c, valoresTexto) {
  const tipo = detectarTipo(valoresTexto);
  const convertir = coerce(tipo);
  return { ...c, type: tipo, values: valoresTexto.map((t) => (t.trim() === "" ? null : convertir(t))) };
}

/** Los valores ya guardados, de vuelta a texto — para recalcular el tipo sin perder lo que ya había. */
function aTexto(values) {
  return values.map((v) => (v == null ? "" : String(v)));
}

export const useWorkbookStore = create((set) => ({
  columns: hojaEnBlanco(),
  resultados: [],
  graficos: [],
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

  seleccionar(seleccion) {
    set({ seleccionActual: seleccion });
  },

  renombrarColumna(id, nombre) {
    set((s) => ({ columns: s.columns.map((c) => (c.id === id ? { ...c, name: nombre } : c)) }));
  },

  agregarColumna() {
    set((s) => ({ columns: [...s.columns, columnaVacia(s.columns[0]?.values.length || FILAS_INICIALES)] }));
  },

  eliminarColumna(id) {
    set((s) => ({ columns: s.columns.filter((c) => c.id !== id) }));
  },

  agregarFilas(cantidad = 20) {
    set((s) => ({
      columns: s.columns.map((c) => ({ ...c, values: [...c.values, ...new Array(cantidad).fill(null)] })),
    }));
  },

  /**
   * Escribe una sola celda (edición manual desde la grilla) y recalcula el
   * tipo de la columna con el valor ya puesto — igual que si se acabara de
   * pegar una hoja con esa columna completa.
   */
  setCelda(colId, filaIdx, valorTexto) {
    set((s) => ({
      columns: s.columns.map((c) => {
        if (c.id !== colId) return c;
        const valoresTexto = aTexto(c.values);
        while (valoresTexto.length <= filaIdx) valoresTexto.push("");
        valoresTexto[filaIdx] = valorTexto;
        return recalcularColumna(c, valoresTexto);
      }),
    }));
  },

  /**
   * Pega un bloque rectangular (filas x columnas, ya separado en texto)
   * empezando en una celda: reparte cada columna del bloque en la columna
   * de la hoja que le corresponda a la derecha de "colIdInicio", crece las
   * columnas si el bloque trae más filas de las que hay, y recalcula el
   * tipo de cada columna tocada con su contenido ya actualizado.
   */
  pegarBloque(colIdInicio, filaIdxInicio, bloque) {
    if (bloque.length === 0) return;
    set((s) => {
      const idxInicio = s.columns.findIndex((c) => c.id === colIdInicio);
      if (idxInicio === -1) return s;
      const anchoBloque = Math.max(...bloque.map((f) => f.length));
      const filaMax = filaIdxInicio + bloque.length;
      const columns = s.columns.map((c, i) => {
        const offset = i - idxInicio;
        if (offset < 0 || offset >= anchoBloque) return c;
        const valoresTexto = aTexto(c.values);
        while (valoresTexto.length < filaMax) valoresTexto.push("");
        for (let r = 0; r < bloque.length; r++) {
          const texto = bloque[r][offset];
          if (texto === undefined) continue;
          valoresTexto[filaIdxInicio + r] = texto;
        }
        return recalcularColumna(c, valoresTexto);
      });
      return { columns };
    });
  },

  /**
   * Reemplaza toda la hoja (importar CSV/Excel). filasATablero() ya trae el
   * tipo detectado de cada columna, así que aquí sólo hace falta convertir
   * los valores con él.
   */
  cargarHoja(columnasNuevas) {
    contadorColumnas = 0;
    set({
      columns: columnasNuevas.map((c) => {
        contadorColumnas += 1;
        const convertir = coerce(c.type);
        return { id: `c${contadorColumnas}`, name: c.name, type: c.type, values: c.values.map((v) => (v == null ? null : convertir(String(v)))) };
      }),
      resultados: [],
      graficos: [],
      seleccionActual: null,
    });
  },

  limpiarHoja() {
    set({ columns: hojaEnBlanco(), resultados: [], graficos: [], seleccionActual: null });
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
