// Vocabulario común de estados para clasificar un resultado estadístico.
//
// La regla de fondo (pedida explícitamente y correcta): que una prueba se
// haya podido *ejecutar* no significa que el proceso sea *bueno*. "p > 0.05"
// no es lo mismo que "normal"; "Cpk > 1.33" no es lo mismo que "validado";
// un Gage R&R que no se pudo calcular no es lo mismo que un Gage R&R malo.
// Por eso hay cinco estados y no dos (bien/mal):
//
//   FAVORABLE        — la evidencia calculada apoya la conclusión positiva.
//   REQUIERE_REVISION — hay una señal de alerta, pero no es concluyente por
//                        sí sola (p-valor límite, Cpk marginal, un solo punto
//                        fuera de control).
//   NO_FAVORABLE     — la evidencia calculada contradice la conclusión
//                        positiva.
//   NO_EVALUADO      — no se pudo calcular: faltan datos, faltan columnas,
//                        la estructura no alcanza (nunca se rellena con un
//                        supuesto para poder mostrar algo).
//   NO_CONCLUYENTE   — se calculó, pero un requisito previo no se cumple
//                        (la capacidad de un proceso inestable, por
//                        ejemplo): el número existe, pero no se puede leer
//                        como si nada.
//
// Ningún resultado estadístico se computa aparte para decidir esto: la
// clasificación siempre se arma sobre lo que ya devolvió la función de
// cálculo correspondiente (normalidad.js, spc.js, pruebas.js...).
export const ESTADO = Object.freeze({
  FAVORABLE: "FAVORABLE",
  REQUIERE_REVISION: "REQUIERE REVISIÓN",
  NO_FAVORABLE: "NO FAVORABLE",
  NO_EVALUADO: "NO EVALUADO",
  NO_CONCLUYENTE: "NO CONCLUYENTE",
});

/** El texto exacto de un estado, para usarlo como valor de celda en una tabla. */
export function etiquetaEstado(estado) {
  return ESTADO[estado] ?? estado;
}

/**
 * Clasifica una prueba de normalidad sin decir nunca "es normal" / "no es
 * normal": un valor p alto es la ausencia de evidencia en contra, no la
 * prueba de que los datos vengan de una normal.
 */
export function estadoNormalidad(valorP, alfa = 0.05) {
  if (valorP == null || Number.isNaN(valorP)) return { estado: ESTADO.NO_EVALUADO, texto: "No se pudo calcular el valor p." };
  if (valorP < alfa) {
    return {
      estado: ESTADO.REQUIERE_REVISION,
      texto:
        `Con α = ${alfa}, el contraste encuentra evidencia en contra de la normalidad (valor p = ${valorP < 0.0001 ? "< 0.0001" : valorP.toFixed(4)}). ` +
        "Conviene revisar la gráfica de probabilidad y el histograma, y valorar una transformación o un método no paramétrico antes de continuar.",
    };
  }
  return {
    estado: ESTADO.FAVORABLE,
    texto:
      `Con α = ${alfa}, el contraste no encuentra evidencia suficiente para rechazar la normalidad (valor p = ${valorP.toFixed(4)}). ` +
      "Esto no confirma que los datos sean normales: es la ausencia de evidencia en contra, y conviene mirarlo junto con la gráfica de probabilidad, el histograma y el conocimiento del proceso.",
  };
}

/**
 * Clasifica la estabilidad de un proceso a partir de los puntos fuera de
 * control de una carta (I-MR o Xbar-R). Sólo evalúa la regla 1 (puntos
 * fuera de los límites de 3σ) — las reglas de rachas y tendencias no están
 * implementadas, así que no se afirma "estable" con más alcance del que en
 * realidad se comprobó.
 */
export function estadoEstabilidad(puntosFuera) {
  if (puntosFuera == null) return { estado: ESTADO.NO_EVALUADO, texto: "No hay una carta de control calculada para este proceso." };
  if (puntosFuera === 0) {
    return {
      estado: ESTADO.FAVORABLE,
      texto: "Ningún punto cae fuera de los límites de control (regla 1, 3σ). No se evaluaron rachas ni tendencias.",
    };
  }
  return {
    estado: ESTADO.NO_FAVORABLE,
    texto: `${puntosFuera} punto(s) fuera de los límites de control (regla 1, 3σ): hay señal de causa especial, no sólo variación común.`,
  };
}

/**
 * Clasifica un índice de capacidad (Cp, Cpk, Pp o Ppk) contra un umbral, PERO
 * nunca por sí solo: se llama junto con la estabilidad del proceso, y quien
 * use el resultado debe mirar los dos.
 */
export function estadoCapacidad(indice, umbral) {
  if (indice == null || Number.isNaN(indice)) return { estado: ESTADO.NO_EVALUADO };
  if (indice >= umbral) return { estado: ESTADO.FAVORABLE };
  if (indice >= umbral * 0.85) return { estado: ESTADO.REQUIERE_REVISION };
  return { estado: ESTADO.NO_FAVORABLE };
}

/**
 * Combina la capacidad con la estabilidad: la regla explícitamente pedida
 * ("capacidad de un proceso inestable no es concluyente aunque Cpk sea
 * alto") vive aquí y en ningún otro sitio, para no repetirla ni olvidarla.
 */
export function estadoCapacidadFinal(indice, umbral, estabilidad) {
  const base = estadoCapacidad(indice, umbral);
  if (base.estado === ESTADO.NO_EVALUADO) return base;
  if (estabilidad?.estado === ESTADO.NO_FAVORABLE) {
    return {
      estado: ESTADO.NO_CONCLUYENTE,
      texto:
        "CAPACIDAD NO CONCLUYENTE: el proceso no presenta estabilidad estadística suficiente (hay puntos fuera de control) para una interpretación convencional de capacidad, aunque el índice se haya podido calcular como referencia técnica.",
    };
  }
  if (estabilidad?.estado === ESTADO.NO_EVALUADO) {
    return {
      ...base,
      texto: "La estabilidad del proceso no se evaluó (no hay carta de control calculada): el índice se muestra como referencia, sin confirmar que el proceso esté bajo control.",
    };
  }
  return base;
}

/** Clasifica un Gage R&R por su %Variación del estudio, el corte de AIAG. */
export function estadoGageRR(porcentajeStudyVar) {
  if (porcentajeStudyVar == null || Number.isNaN(porcentajeStudyVar)) return { estado: ESTADO.NO_EVALUADO };
  if (porcentajeStudyVar < 10) return { estado: ESTADO.FAVORABLE, texto: "Sistema de medición aceptable (AIAG: %Variación del estudio < 10%)." };
  if (porcentajeStudyVar < 30) return { estado: ESTADO.REQUIERE_REVISION, texto: "Sistema de medición marginal (AIAG: 10% ≤ %Variación del estudio < 30%); puede aceptarse según la aplicación y el costo de mejorarlo." };
  return { estado: ESTADO.NO_FAVORABLE, texto: "Sistema de medición no aceptable (AIAG: %Variación del estudio ≥ 30%)." };
}

/** Clasifica el resumen de calidadDeColumnas() (ver calidad.js). */
export function estadoCalidad(resumen) {
  if (!resumen) return { estado: ESTADO.NO_EVALUADO, texto: "Todavía no se corrió Calidad de datos." };
  const problemas = [];
  if (resumen.totalFaltantes > 0) problemas.push(`${resumen.totalFaltantes} dato(s) faltante(s)`);
  if (resumen.totalDuplicados > 0) problemas.push(`${resumen.totalDuplicados} valor(es) duplicado(s)`);
  if (resumen.totalNoNumericos > 0) problemas.push(`${resumen.totalNoNumericos} valor(es) no numérico(s) en columna(s) declaradas numéricas`);
  if (problemas.length === 0) {
    return { estado: ESTADO.FAVORABLE, texto: "Sin datos faltantes, duplicados ni valores no numéricos en las columnas evaluadas." };
  }
  return { estado: ESTADO.REQUIERE_REVISION, texto: `Se encontraron: ${problemas.join(", ")}. Revísalos antes de apoyarte en los análisis que siguen.` };
}

/**
 * Clasifica un hallazgo de asociación (correlación o regresión) entre dos
 * variables. No usa FAVORABLE/NO_FAVORABLE como "bueno/malo": encontrar una
 * asociación es información útil en cualquier de los dos sentidos, así que
 * FAVORABLE aquí significa "esta variable quedó caracterizada", y no
 * encontrar nada se marca REQUIERE_REVISION —no porque sea un mal
 * resultado, sino porque la pregunta de qué variables son críticas sigue
 * abierta y conviene seguir mirando (otra variable, otra relación no
 * lineal) antes de dar la etapa por cerrada.
 */
export function estadoAsociacion(valorP, alfa = 0.05) {
  if (valorP == null || Number.isNaN(valorP)) return { estado: ESTADO.NO_EVALUADO, texto: "No se pudo calcular el valor p." };
  if (valorP < alfa) {
    return {
      estado: ESTADO.FAVORABLE,
      texto: `Con α = ${alfa}, se encontró evidencia estadística de asociación (valor p = ${valorP < 0.0001 ? "< 0.0001" : valorP.toFixed(4)}). Asociación, no causalidad.`,
    };
  }
  return {
    estado: ESTADO.REQUIERE_REVISION,
    texto: `Con α = ${alfa}, no se encontró evidencia suficiente de asociación con esta variable (valor p = ${valorP.toFixed(4)}). No descarta una relación no lineal, ni que el factor crítico sea otra variable.`,
  };
}

/**
 * Clasifica una comparación de grupos (ANOVA, Kruskal-Wallis, t) por su
 * valor p, con el lenguaje correcto: nunca "son iguales", porque no rechazar
 * no es demostrar que no hay diferencia.
 */
export function estadoComparacion(valorP, alfa = 0.05) {
  if (valorP == null || Number.isNaN(valorP)) return { estado: ESTADO.NO_EVALUADO, texto: "No se pudo calcular el valor p." };
  if (valorP < alfa) {
    return {
      estado: ESTADO.REQUIERE_REVISION,
      texto: `Con α = ${alfa}, se detecta evidencia estadística de diferencia entre los grupos (valor p = ${valorP < 0.0001 ? "< 0.0001" : valorP.toFixed(4)}).`,
    };
  }
  return {
    estado: ESTADO.FAVORABLE,
    texto: `Con α = ${alfa}, no se detectó evidencia estadística suficiente de diferencia entre los grupos bajo el modelo y el α utilizados (valor p = ${valorP.toFixed(4)}).`,
  };
}
