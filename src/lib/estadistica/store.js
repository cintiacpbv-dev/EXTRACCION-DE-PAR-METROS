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

export const useWorkbookStore = create((set) => ({
  columns: hojaEnBlanco(),
  resultados: [],
  graficos: [],

  renombrarColumna(id, nombre) {
    set((s) => ({ columns: s.columns.map((c) => (c.id === id ? { ...c, name: nombre } : c)) }));
  },

  cambiarTipoColumna(id, tipo) {
    set((s) => ({
      columns: s.columns.map((c) => {
        if (c.id !== id) return c;
        const convertir = coerce(tipo);
        return { ...c, type: tipo, values: c.values.map((v) => (v == null ? null : convertir(String(v)))) };
      }),
    }));
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

  /** Escribe una sola celda (edición manual desde la grilla). */
  setCelda(colId, filaIdx, valorTexto) {
    set((s) => ({
      columns: s.columns.map((c) => {
        if (c.id !== colId) return c;
        const valores = [...c.values];
        while (valores.length <= filaIdx) valores.push(null);
        valores[filaIdx] = coerce(c.type)(valorTexto);
        return { ...c, values: valores };
      }),
    }));
  },

  /**
   * Pega un bloque rectangular (filas x columnas, ya separado en texto)
   * empezando en una celda: reparte cada columna del bloque en la columna
   * de la hoja que le corresponda a la derecha de "colIdInicio", y crece las
   * columnas si el bloque trae más filas de las que hay.
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
        const convertir = coerce(c.type);
        const valores = [...c.values];
        while (valores.length < filaMax) valores.push(null);
        for (let r = 0; r < bloque.length; r++) {
          const texto = bloque[r][offset];
          if (texto === undefined) continue;
          valores[filaIdxInicio + r] = convertir(texto);
        }
        return { ...c, values: valores };
      });
      return { columns };
    });
  },

  /**
   * Reemplaza toda la hoja (importar CSV/Excel). Los valores llegan como
   * texto crudo (así los da el CSV, o así los deja exceljs) — sin pasarlos
   * por coerce() quedarían como string en una columna "numeric", y todo
   * cálculo estadístico los filtraría como si estuvieran vacíos.
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
    });
  },

  limpiarHoja() {
    set({ columns: hojaEnBlanco(), resultados: [], graficos: [] });
  },

  registrarResultado(titulo, contenido, advertencias = []) {
    set((s) => ({
      resultados: [...s.resultados, { id: crypto.randomUUID(), timestamp: Date.now(), titulo, contenido, advertencias }],
    }));
  },

  agregarGrafico(titulo, opciones) {
    set((s) => ({ graficos: [...s.graficos, { id: crypto.randomUUID(), titulo, opciones }] }));
  },

  eliminarResultado(id) {
    set((s) => ({ resultados: s.resultados.filter((r) => r.id !== id) }));
  },

  eliminarGrafico(id) {
    set((s) => ({ graficos: s.graficos.filter((g) => g.id !== id) }));
  },

  limpiarSalida() {
    set({ resultados: [], graficos: [] });
  },
}));
