import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-reader.ts lee archivos de pdfjs-dist (standard_fonts/, cmaps/,
  // el worker) directamente del disco en tiempo de ejecución, no vía
  // import -- el file tracing de Vercel no los detecta solo y los deja
  // fuera del bundle de la función serverless si no se incluyen aquí.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/pdfjs-dist/**"],
  },
  // @napi-rs/canvas trae un binario nativo (.node) por plataforma -- el
  // bundler de Turbopack no puede empaquetarlo como un módulo ES normal
  // ("non-ecmascript placeable asset"). Se deja fuera del bundle y se
  // usa tal cual desde node_modules en tiempo de ejecución.
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
