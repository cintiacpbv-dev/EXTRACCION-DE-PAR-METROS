// El logo que va en el encabezado de los formatos exportados.
//
// Es apaisado (191×26 px, casi 7:1) y se muestra a esta altura en las dos
// orientaciones de página —ver ANCHO_LOGO_DXA en exportEncabezado.js—, que es
// lo que evita que un logo tan ancho se vea aplastado en la hoja vertical,
// donde hay menos sitio.

import { HUMANOVA_LOGO_BASE64 } from "../assets/humanovaLogo.js";

const LOGO_ALTO_PX = 20;
const LOGO_RATIO = 191 / 26;

let cache = null;

export function logoPorDefecto() {
  if (!cache) {
    const binario = atob(HUMANOVA_LOGO_BASE64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    cache = {
      bytes,
      tipo: "png",
      alto: LOGO_ALTO_PX,
      ancho: Math.round(LOGO_ALTO_PX * LOGO_RATIO),
    };
  }
  return cache;
}
