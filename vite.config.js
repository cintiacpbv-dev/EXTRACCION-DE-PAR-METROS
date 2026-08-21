import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En GitHub Pages el sitio no vive en la raíz del dominio sino en una
// subcarpeta con el nombre del repositorio, así que los archivos compilados
// deben apuntar ahí. En desarrollo se sirve desde la raíz de localhost.
// VITE_BASE_PATH permite sobrescribirlo si algún día se publica en otro lado.
const GITHUB_PAGES_BASE = "/EXTRACCION-DE-PAR-METROS/";

export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE_PATH || (command === "build" ? GITHUB_PAGES_BASE : "/"),
  plugins: [react()],
}));
