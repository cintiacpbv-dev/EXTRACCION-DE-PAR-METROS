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
import jStat from "jstat";
import { estadisticaDescriptiva, resumenBoxplot, binsHistograma, valoresNumericos } from "./descriptiva.js";

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
export function opcionHistograma(values, nombreColumna, numBins, rango) {
  const { bins, ancho, inicio } = binsHistograma(values, numBins, rango);
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

const VERDE_OK = "#008300";

/** Par de cartas (individuos + rango móvil, o Xbar + R) apiladas una sobre otra. */
function opcionParDeCartas(superior, inferior, tituloSuperior, tituloInferior, nombreEje) {
  return {
    ...BASE,
    tooltip: { ...BASE.tooltip, trigger: "axis" },
    grid: [
      { left: 64, right: 24, top: 48, height: "35%" },
      { left: 64, right: 24, top: "58%", height: "32%" },
    ],
    xAxis: [
      ejeBase({ type: "category", data: superior.puntos.map((p) => p.i + 1), gridIndex: 0, show: false }),
      ejeBase({ type: "category", data: inferior.puntos.map((p) => p.i + 1), gridIndex: 1, name: "Muestra", nameLocation: "middle", nameGap: 28 }),
    ],
    yAxis: [
      ejeBase({ type: "value", name: nombreEje[0], gridIndex: 0, scale: true }),
      ejeBase({ type: "value", name: nombreEje[1], gridIndex: 1, scale: true }),
    ],
    title: [
      { text: tituloSuperior, top: 8, left: 64, textStyle: { color: TEXTO, fontSize: 13, fontWeight: 600 } },
      { text: tituloInferior, top: "56%", left: 64, textStyle: { color: TEXTO, fontSize: 13, fontWeight: 600 } },
    ],
    series: [superior, inferior].map((carta, idx) => ({
      name: nombreEje[idx],
      type: "line",
      xAxisIndex: idx,
      yAxisIndex: idx,
      data: carta.puntos.map((p) => ({ value: p.v, itemStyle: p.fuera ? { color: ATIPICO } : undefined })),
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { color: SERIE_1, width: 1.5 },
      itemStyle: { color: SERIE_1 },
      markLine: {
        symbol: "none",
        label: { color: TEXTO_SUAVE, fontSize: 10 },
        data: [
          { yAxis: carta.cl, lineStyle: { color: VERDE_OK, type: "solid", width: 1.5 }, label: { formatter: `LC ${carta.cl.toFixed(3)}` } },
          { yAxis: carta.ucl, lineStyle: { color: SERIE_2, type: "dashed" }, label: { formatter: `LCS ${carta.ucl.toFixed(3)}` } },
          { yAxis: carta.lcl, lineStyle: { color: SERIE_2, type: "dashed" }, label: { formatter: `LCI ${carta.lcl.toFixed(3)}` } },
        ],
      },
    })),
  };
}

/** Gráfica de control individuos + rango móvil (I-MR). */
export function opcionIMR(resultado, nombreColumna) {
  return opcionParDeCartas(
    resultado.individuos,
    resultado.rangoMovil,
    `Individuos — ${nombreColumna}`,
    "Rango móvil",
    [nombreColumna, "Rango móvil"]
  );
}

/** Gráfica de control Xbar-R. */
export function opcionXbarR(resultado, nombreColumna) {
  return opcionParDeCartas(
    resultado.medias,
    resultado.rangos,
    `Xbarra — ${nombreColumna}`,
    "Rango",
    [`Media (n=${resultado.tamanoSubgrupo})`, "Rango"]
  );
}

/**
 * Histograma de capacidad: igual que opcionHistograma, pero con los
 * límites de especificación marcados como referencias verticales, para ver
 * de un vistazo cuánto del proceso cae fuera de lo permitido.
 */
export function opcionCapacidad(values, nombreColumna, { lsl, usl } = {}) {
  const datos = valoresNumericos(values);

  // El histograma tiene que abarcar los límites de especificación aunque
  // caigan fuera de los datos —un proceso capaz y bien centrado es
  // justamente cuando eso pasa—, si no las líneas de LEI/LES quedarían
  // fuera del área visible y nunca se verían. Con un margen del 5% para
  // que no queden pegadas al borde del gráfico.
  const margen = (Math.max(...datos) - Math.min(...datos)) * 0.05 || 1;
  const rango = {
    minimo: Math.min(...datos, lsl != null ? lsl - margen : Infinity),
    maximo: Math.max(...datos, usl != null ? usl + margen : -Infinity),
  };

  const { bins, ancho, inicio } = binsHistograma(datos, undefined, rango);
  const base = opcionHistograma(values, nombreColumna, bins.length, rango);

  // El eje del histograma es de categorías (una por bin), no un eje
  // numérico continuo: "markLine" con xAxis en categorías no acepta el
  // valor real de LEI/LES, pero sí acepta un índice de categoría —incluso
  // fraccional—, así que se convierte el valor a la posición de bin que le
  // corresponde. Los centros de bin son inicio + i·ancho + ancho/2, o sea
  // que el índice (posiblemente con decimales) es (valor − inicio)/ancho − 0.5.
  const aIndice = (valor) => (valor - inicio) / ancho - 0.5;

  const lineas = [];
  if (lsl != null) lineas.push({ xAxis: aIndice(lsl), lineStyle: { color: ATIPICO, type: "dashed", width: 2.5 }, label: { formatter: `LEI ${lsl}`, color: ATIPICO, fontWeight: 600 } });
  if (usl != null) lineas.push({ xAxis: aIndice(usl), lineStyle: { color: ATIPICO, type: "dashed", width: 2.5 }, label: { formatter: `LES ${usl}`, color: ATIPICO, fontWeight: 600 } });

  base.series[0].markLine = {
    symbol: "none",
    label: { color: ATIPICO, fontSize: 11 },
    data: lineas,
  };

  const fueraDeRango = datos.filter((v) => (lsl != null && v < lsl) || (usl != null && v > usl)).length;
  base.__fueraDeRango = fueraDeRango;
  base.__totalDatos = datos.length;
  return base;
}

const AMBAR_AVISO = "#c98500";

/**
 * Gráfico de componentes de varianza del Gage R&R: %Contribución (a la
 * varianza) y %Variación de estudio por componente — el mismo par de
 * barras que muestra Minitab, con la referencia del 30% que separa un
 * sistema de medición aceptable de uno que no lo es (regla de AIAG).
 */
export function opcionGageRR(resultado) {
  const componentes = resultado.componentes.filter((c) => c.nombre !== "Total");
  const nombres = componentes.map((c) => c.nombre);

  return {
    ...BASE,
    tooltip: { ...BASE.tooltip, trigger: "axis" },
    title: { text: "Componentes de varianza — Gage R&R", textStyle: { color: TEXTO, fontSize: 14, fontWeight: 600 } },
    legend: { data: ["% Contribución", "% Variación de estudio"], textStyle: { color: TEXTO_SUAVE }, top: 24 },
    grid: { left: 56, right: 24, top: 64, bottom: 60 },
    xAxis: ejeBase({ type: "category", data: nombres, axisLabel: { color: TEXTO_SUAVE, interval: 0, rotate: 20 } }),
    yAxis: ejeBase({ type: "value", name: "%", max: 100 }),
    series: [
      {
        name: "% Contribución",
        type: "bar",
        data: componentes.map((c) => c.porcentajeContribucion),
        itemStyle: { color: SERIE_1, borderRadius: [3, 3, 0, 0] },
      },
      {
        name: "% Variación de estudio",
        type: "bar",
        data: componentes.map((c) => c.porcentajeStudyVar),
        itemStyle: { color: SERIE_2, borderRadius: [3, 3, 0, 0] },
        markLine: {
          symbol: "none",
          label: { color: AMBAR_AVISO, fontSize: 11, formatter: "30% (límite AIAG)" },
          data: [{ yAxis: 30, lineStyle: { color: AMBAR_AVISO, type: "dashed", width: 2 } }],
        },
      },
    ],
  };
}

/**
 * Pareto de efectos de un diseño factorial: una barra horizontal por cada
 * efecto (principal o de interacción), de mayor a menor magnitud, en el
 * mismo orden de lectura que un diagrama de Pareto normal. Cuando hay
 * réplicas para dar significancia, los efectos con valor p < 0.05 se
 * destacan en el color de acento y el resto queda en gris — sin réplicas
 * sólo se ve la magnitud, sin fingir una significancia que no se calculó.
 */
export function opcionParetoEfectos(resultado) {
  // Ya vienen ordenados de mayor a menor |efecto|; se invierten para que,
  // en un eje de categorías (que dibuja de abajo hacia arriba), el mayor
  // quede arriba del todo, como en cualquier Pareto.
  const efectos = [...resultado.efectos].reverse();
  const etiquetas = efectos.map((e) => e.etiqueta);
  const valores = efectos.map((e) => Math.abs(e.efecto));
  const significativo = (e) => !resultado.hayReplicas || e.valorP < 0.05;

  return {
    ...BASE,
    tooltip: {
      ...BASE.tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const e = efectos[params[0].dataIndex];
        const base = `${e.etiqueta}: efecto ${e.efecto.toFixed(4)}`;
        return resultado.hayReplicas ? `${base}<br/>valor p: ${e.valorP < 0.0001 ? "< 0.0001" : e.valorP.toFixed(4)}` : base;
      },
    },
    title: { text: "Pareto de efectos", textStyle: { color: TEXTO, fontSize: 14, fontWeight: 600 } },
    grid: { left: 90, right: 32, top: 48, bottom: 40 },
    xAxis: ejeBase({ type: "value", name: "|Efecto|" }),
    yAxis: ejeBase({ type: "category", data: etiquetas }),
    series: [
      {
        type: "bar",
        data: valores.map((v, i) => ({ value: v, itemStyle: { color: significativo(efectos[i]) ? SERIE_1 : TEXTO_SUAVE } })),
        barCategoryGap: "30%",
      },
    ],
  };
}

// Los porcentajes clásicos de una gráfica de probabilidad — los mismos que
// muestra Minitab en el eje vertical. El eje internamente es lineal en Z
// (la escala en la que la CDF normal es, por construcción, una recta), y
// estas marcas son sólo las etiquetas que se le ponen encima.
const MARCAS_PORCENTAJE = [0.1, 1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 99.9];

/**
 * Gráfica de probabilidad normal, para juicio de normalidad — verificada
 * contra un caso real de Minitab (ver normalidad.js): con los mismos 100
 * datos, esta misma cuenta reproduce su Media, Desv.Est., AD y valor p.
 * Los puntos deberían caer cerca de la recta si los datos son normales; una
 * curva en los extremos, como en el caso verificado, es lo que delata que
 * no lo son.
 */
export function opcionProbabilidadNormal(resultado, nombreColumna) {
  const { puntos, media, desvEst, n, ad, valorP } = resultado;
  const marcasZ = MARCAS_PORCENTAJE.map((p) => jStat.normal.inv(p / 100, 0, 1));
  const zMin = marcasZ[0];
  const zMax = marcasZ[marcasZ.length - 1];

  const datosScatter = puntos.map((p) => [p.valor, p.z]);
  const lineaAjuste = [
    [media + zMin * desvEst, zMin],
    [media + zMax * desvEst, zMax],
  ];

  return {
    ...BASE,
    tooltip: {
      ...BASE.tooltip,
      formatter: (p) =>
        p.seriesName === nombreColumna
          ? `${nombreColumna}: ${p.value[0]}<br/>percentil: ${(jStat.normal.cdf(p.value[1], 0, 1) * 100).toFixed(1)}%`
          : "",
    },
    title: { text: `Gráfica de probabilidad — ${nombreColumna}`, textStyle: { color: TEXTO, fontSize: 14, fontWeight: 600 } },
    grid: { left: 64, right: 140, top: 48, bottom: 48 },
    xAxis: ejeBase({ type: "value", name: nombreColumna, nameLocation: "middle", nameGap: 32, scale: true }),
    yAxis: ejeBase({
      type: "value",
      name: "Porcentaje",
      min: zMin,
      max: zMax,
      axisLabel: {
        color: TEXTO_SUAVE,
        customValues: marcasZ,
        formatter: (valorZ) => {
          const idx = marcasZ.findIndex((z) => Math.abs(z - valorZ) < 1e-6);
          return idx >= 0 ? `${MARCAS_PORCENTAJE[idx]}` : "";
        },
      },
      splitLine: { show: true, lineStyle: { color: BORDE, type: "dashed" } },
    }),
    series: [
      {
        name: "Normal ajustada",
        type: "line",
        data: lineaAjuste,
        symbol: "none",
        lineStyle: { color: SERIE_2, width: 1.5 },
      },
      {
        name: nombreColumna,
        type: "scatter",
        data: datosScatter,
        symbolSize: 7,
        itemStyle: { color: SERIE_1, opacity: 0.85 },
      },
    ],
    graphic: {
      type: "group",
      right: 16,
      top: 56,
      children: [
        {
          type: "rect",
          shape: { width: 128, height: 92 },
          style: { fill: SUPERFICIE, stroke: BORDE, lineWidth: 1 },
        },
        {
          type: "text",
          left: 10,
          top: 8,
          style: {
            text: [
              `N            ${n}`,
              `Media      ${media.toFixed(4)}`,
              `Desv.Est.  ${desvEst.toFixed(4)}`,
              `AD           ${ad.toFixed(3)}`,
              `Valor p     ${valorP < 0.005 ? "< 0.005" : valorP.toFixed(3)}`,
            ].join("\n"),
            fill: TEXTO_SUAVE,
            fontSize: 11,
            fontFamily: "IBM Plex Mono, monospace",
            lineHeight: 16,
          },
        },
      ],
    },
  };
}

/**
 * Gráfica de intervalos: para cada grupo, el intervalo de confianza de su
 * media (una línea vertical con un travesaño en cada extremo) y un punto
 * en la media — el mismo gráfico que Minitab llama "Interval Plot", para
 * comparar varios grupos de un vistazo. ECharts no trae "barras de error"
 * de fábrica; se dibujan con una serie "custom" y un renderItem propio,
 * que es la forma documentada de conseguirlas.
 */
export function opcionIntervalos(intervalos) {
  const categorias = intervalos.map((i) => i.nombre);

  function renderItem(params, api) {
    const categoria = api.value(0);
    const puntoInferior = api.coord([categoria, api.value(1)]);
    const puntoSuperior = api.coord([categoria, api.value(2)]);
    const x = puntoInferior[0];
    const mitadTravesano = 9;
    const estilo = { stroke: SERIE_1, lineWidth: 2 };
    return {
      type: "group",
      children: [
        { type: "line", shape: { x1: x, y1: puntoInferior[1], x2: x, y2: puntoSuperior[1] }, style: estilo },
        { type: "line", shape: { x1: x - mitadTravesano, y1: puntoInferior[1], x2: x + mitadTravesano, y2: puntoInferior[1] }, style: estilo },
        { type: "line", shape: { x1: x - mitadTravesano, y1: puntoSuperior[1], x2: x + mitadTravesano, y2: puntoSuperior[1] }, style: estilo },
      ],
    };
  }

  return {
    ...BASE,
    tooltip: {
      ...BASE.tooltip,
      trigger: "item",
      formatter: (p) => {
        const i = intervalos[p.dataIndex];
        return `${i.nombre}<br/>Media: ${i.media.toFixed(4)}<br/>IC ${(i.nivelConfianza * 100).toFixed(0)}%: [${i.limiteInferior.toFixed(4)}, ${i.limiteSuperior.toFixed(4)}]`;
      },
    },
    title: {
      text: `Gráfica de intervalos (IC ${(intervalos[0]?.nivelConfianza * 100 || 95).toFixed(0)}% para la media)`,
      textStyle: { color: TEXTO, fontSize: 14, fontWeight: 600 },
    },
    grid: { left: 64, right: 32, top: 56, bottom: 48 },
    xAxis: ejeBase({ type: "category", data: categorias, name: "Grupo", nameLocation: "middle", nameGap: 32 }),
    yAxis: ejeBase({ type: "value", scale: true }),
    series: [
      {
        type: "custom",
        renderItem,
        data: intervalos.map((i) => [i.nombre, i.limiteInferior, i.limiteSuperior]),
        encode: { x: 0, y: [1, 2] },
      },
      {
        type: "scatter",
        data: intervalos.map((i) => [i.nombre, i.media]),
        symbolSize: 9,
        itemStyle: { color: SERIE_2 },
      },
    ],
  };
}
