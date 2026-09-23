// El fondo claro, para toda la aplicación.
//
// Empezó siendo sólo del Análisis Estadístico (el claro de Minitab: hoja
// blanca, grises azulados y celeste como color de trabajo) y ahora se puede
// elegir en cualquier sección. Es una sola preferencia: el botón de la barra
// superior y el de la hoja de trabajo cambian lo mismo, y se recuerda en este
// navegador —es una comodidad de quien mira la pantalla, no un dato que tenga
// que compartirse—.
//
// El cambio de colores lo hace el CSS (html[data-tema="claro"] en index.css):
// aquí sólo se decide y se recuerda cuál está puesto.

import { create } from "zustand";

const CLAVE = "deteccion-parametros:tema:v1";

function leerGuardado() {
  try {
    return localStorage.getItem(CLAVE) === "claro";
  } catch {
    return false;
  }
}

function aplicar(claro) {
  if (typeof document === "undefined") return;
  if (claro) document.documentElement.dataset.tema = "claro";
  else delete document.documentElement.dataset.tema;
}

export const useTema = create((set, get) => ({
  claro: leerGuardado(),

  alternar() {
    const claro = !get().claro;
    try {
      localStorage.setItem(CLAVE, claro ? "claro" : "oscuro");
    } catch {
      // Sin almacenamiento el cambio vale igual, sólo que no se recuerda.
    }
    aplicar(claro);
    set({ claro });
  },
}));

// Se pone antes de pintar nada, para no enseñar un destello oscuro al abrir
// con el claro elegido.
aplicar(useTema.getState().claro);
