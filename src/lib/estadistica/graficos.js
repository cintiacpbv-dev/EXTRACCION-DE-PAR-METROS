// Construye las opciones de ECharts para los gráficos del Análisis
// Estadístico.
//
// Los acentos pastel del resto de la app (--ok, --ambar, --verde, --rojo)
// están pensados para texto e iconos sobre fondo negro, no para distinguir
// series en un gráfico: son demasiado apagados y quedan demasiado cerca en
// luminosidad entre sí (falla el validador de paletas categóricas — ver
// registro de la skill de dataviz). Por eso las marcas usan una paleta
// categórica aparte, ya validada para daltonismo y contraste en modo
// oscuro, mientras que el fondo, la rejilla y el texto sí seguen los
// tokens de la app para que el gráfico se sienta parte de la página.
import { estadisticaDescriptiva, resumenBoxplot, binsHistograma } from "./descriptiva.js";

// Paleta categórica validada (dark): azul, naranja, rojo — sólo se usan los
// primeros tres puestos, que son los que superan el chequeo "todos contra
// todos" que exige un gráfico de dispersión con varios grupos.
const SERIE_1 = "#3987e5"; // azul — serie principal
const SERIE_2 = "#d95926"; // naranja — segunda serie (curva normal, grupo 2)
const SERIE_3 = "#008300"; // verde — grupo 3
const ATIPICO = "#e66767"; // rojo — puntos fuera de rango, no es una serie más

// Cromo del propio tema oscuro de la app (src/index.css), para que el
// gráfico se sienta parte de la página y no un widget pegado encima.
const TEXTO = "#ece7de";
const TEXTO_SUAVE = "#9a9285";
const BORDE = "#242320";
const SUPERFICIE = "#161513";

const BASE = {
  backgroundColor: "transparent",
  textStyle: { color: TEXTO, fontFamily: "IBM Plex Sans, sans-serif" },
  tooltip: {
    trigger: "item",
    backgroundColor: SUPERFICIE,
    borderColor: BORDE,
    textStyle: { color: TEXTO },
  },
};

function ejeBase(overrides) {
  return {
    axisLine: { lineStyle: { color: BORDE } },
    axisLabel: { color: TEXTO_SUAVE },
    splitLine: { lineStyle: { color: BORDE, type: "dashed" } },
    ...overrides,
  };
}

/** Densidad normal N(media, desvEst) evaluada en x — para superponer al histograma. */
function densidadNormal(x, media, desvEst) {
  if (!desvEst) return 0;
  const exponente = -((x - media) ** 2) / (2 * desvEst ** 2);
  return (1 / (desvEst * Math.sqrt(2 * Math.PI))) * Math.exp(exponente);
}

/**
 * Histograma con curva normal superpuesta (para juicio visual de
 * normalidad — la prueba formal, Shapiro-Wilk o Anderson-Darling, queda
 * pendiente de una fase futura hasta verificarla contra casos conocidos:
 * un algoritmo mal implementado ahí es peor que no tenerlo).
 */
export function opcionHistograma(values, nombreColumna, numBins) {
  const { bins, ancho, inicio } = binsHistograma(values, numBins);
  const stats = estadisticaDescriptiva(values);
  const etiquetas = bins.map((_, i) => (inicio + i * ancho + ancho / 2).toFixed(2));

  const curva =
    !stats.vacio && stats.desvEst > 0
      ? bins.map((_, i) => {
          const centro = inicio + i * ancho + ancho / 2;
          // Escalada para leerse junto a las barras: área del bin × densidad.
          const n = values.filter((v) => typeof v === "number").length;
          return densidadNormal(centro, stats.media, stats.desvEst) * n * ancho;
        })
      : null;

  return {
    ...BASE,
    title: { text: `Histograma — ${nombreColumna}`, textStyle: { color: TEXTO, fontSize: 14, fontWeight: 600 } },
    grid: { left: 48, right: 24, top: 48, bottom: 40 },
    xAxis: ejeBase({ type: "category", name: nombreColumna, data: etiquetas, nameTextStyle: { color: TEXTO_SUAVE } }),
    yAxis: ejeBase({ type: "value", name: "Frecuencia" }),
    series: [
      {
        name: "Frecuencia",
        type: "bar",
        data: bins,
        itemStyle: { color: SERIE_1, borderRadius: [3, 3, 0, 0] },
        barCategoryGap: "8%",
      },
      ...(curva
        ? [
            {
              name: "Normal ajustada",
              type: "line",
              data: curva,
              smooth: true,
              symbol: "none",
              lineStyle: { color: SERIE_2, width: 2 },
            },
          ]
        : []),
    ],
    legend: curva ? { data: ["Frecuencia", "Normal ajustada"], textStyle: { color: TEXTO_SUAVE }, top: 24 } : undefined,
  };
}

/** Boxplot de una o más columnas numéricas, lado a lado. */
export function opcionBoxplot(columnas) {
  const resumenes = columnas.map((c) => resumenBoxplot(c.values));
  const categorias = columnas.map((c) => c.name);
  const datosCaja = resumenes.map((r) => (r ? [r.minimo, r.q1, r.mediana, r.q3, r.maximo] : [0, 0, 0, 0, 0]));
  const puntosAtipicos = [];
  resumenes.forEach((r, i) => {
    if (!r) return;
    for (const v of r.atipicos) puntosAtipicos.push([i, v]);
  });

  return {
    ...BASE,
    title: { text: "Diagrama de caja", textStyle: { color: TEXTO, fontSize: 14, fontWeight: 600 } },
    grid: { left: 56, right: 24, top: 48, bottom: 40 },
    xAxis: ejeBase({ type: "category", data: categorias }),
    yAxis: ejeBase({ type: "value" }),
    series: [
      {
        name: "Caja",
        type: "boxplot",
        data: datosCaja,
        itemStyle: { color: SUPERFICIE, borderColor: SERIE_1, borderWidth: 2 },
      },
      ...(puntosAtipicos.length > 0
        ? [
            {
              name: "Atípicos",
              type: "scatter",
              data: puntosAtipicos,
              symbolSize: 8,
              itemStyle: { color: ATIPICO },
            },
          ]
        : []),
    ],
  };
}

/**
 * Dispersión de dos columnas numéricas, opcionalmente coloreada por una
 * tercera columna categórica. Se limita a los 3 primeros grupos —el resto
 * cae en "Otros"— porque a partir de ahí ningún orden de la paleta supera
 * el chequeo de daltonismo "todos contra todos" que exige un gráfico donde
 * cualquier par de puntos puede quedar uno junto al otro.
 */
export function opcionDispersion(colX, colY, colGrupo) {
  const puntos = colX.values.map((x, i) => [x, colY.values[i], colGrupo?.values[i]]).filter(([x, y]) => typeof x === "number" && typeof y === "number");

  if (!colGrupo) {
    return {
      ...BASE,
      title: { text: `${colY.name} vs. ${colX.name}`, textStyle: { color: TEXTO, fontSize: 14, fontWeight: 600 } },
      grid: { left: 56, right: 24, top: 48, bottom: 48 },
      xAxis: ejeBase({ type: "value", name: colX.name, nameLocation: "middle", nameGap: 32, scale: true }),
      yAxis: ejeBase({ type: "value", name: colY.name, nameLocation: "middle", nameGap: 44, scale: true }),
      series: [{ name: colY.name, type: "scatter", data: puntos.map(([x, y]) => [x, y]), symbolSize: 9, itemStyle: { color: SERIE_1, opacity: 0.85 } }],
    };
  }

  const gruposUnicos = [...new Set(puntos.map((p) => p[2]).filter((g) => g != null))];
  const colores = [SERIE_1, SERIE_2, SERIE_3];
  const principales = gruposUnicos.slice(0, 3);
  const series = principales.map((g, i) => ({
    name: String(g),
    type: "scatter",
    data: puntos.filter((p) => p[2] === g).map(([x, y]) => [x, y]),
    symbolSize: 9,
    itemStyle: { color: colores[i], opacity: 0.85 },
  }));
  if (gruposUnicos.length > 3) {
    series.push({
      name: "Otros",
      type: "scatter",
      data: puntos.filter((p) => !principales.includes(p[2])).map(([x, y]) => [x, y]),
      symbolSize: 9,
      itemStyle: { color: TEXTO_SUAVE, opacity: 0.6 },
    });
  }

  return {
    ...BASE,
    title: { text: `${colY.name} vs. ${colX.name}, por ${colGrupo.name}`, textStyle: { color: TEXTO, fontSize: 14, fontWeight: 600 } },
    grid: { left: 56, right: 24, top: 56, bottom: 48 },
    xAxis: ejeBase({ type: "value", name: colX.name, nameLocation: "middle", nameGap: 32, scale: true }),
    yAxis: ejeBase({ type: "value", name: colY.name, nameLocation: "middle", nameGap: 44, scale: true }),
    legend: { data: series.map((s) => s.name), textStyle: { color: TEXTO_SUAVE }, top: 24 },
    series,
  };
}
