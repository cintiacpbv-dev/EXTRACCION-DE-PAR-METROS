import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La ruta base por defecto es la raíz del dominio, que es como sirven el sitio
// Vercel, Netlify y el servidor de desarrollo.
//
// GitHub Pages es la excepción: publica dentro de una subcarpeta con el nombre
// del repositorio. Por eso su flujo de despliegue define VITE_BASE_PATH; no se
// deduce aquí, porque hacerlo rompería cualquier otro hosting.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
});
