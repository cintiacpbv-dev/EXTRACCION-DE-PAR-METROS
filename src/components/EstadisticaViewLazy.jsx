import { lazy } from "react";

// La hoja tipo Excel y los gráficos (react-data-grid, ECharts) pesan varios
// megabytes que Detección de Parámetros y Análisis de Riesgo no necesitan
// para nada: cargarlos siempre metería ese peso en cada visita a la app,
// aunque nunca se abra esta sección. Con lazy() sólo se piden al navegar
// aquí, la primera vez.
//
// Vive en su propio archivo, no dentro de App.jsx: mezclar un lazy() a
// nivel de módulo con el componente grande de App confundía al Fast
// Refresh de Vite en desarrollo ("EstadisticaView is not defined" al
// entrar directo por la URL), aunque el build de producción compilaba
// bien — separarlo lo evita de raíz.
const EstadisticaViewLazy = lazy(() => import("./EstadisticaView.jsx"));
export default EstadisticaViewLazy;
