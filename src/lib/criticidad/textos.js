// Los textos del Procedimiento de Evaluación de Criticidad y Riesgo que no
// salen de ningún registro.
//
// Están tomados de las dos corridas reales, con lo genérico ya redactado y
// los huecos marcados entre corchetes para completarlos en Word. Se guardan
// aquí y no en el exportador porque son la parte que se revisa y se ajusta
// —la declaración de gap de una planta no es la de otra— y conviene tenerlos
// todos juntos y en español llano, no repartidos entre plantillas.
//
// Lo que queda entre [corchetes] es a propósito: son datos que la aplicación
// NO puede saber, y dejarlos marcados es más honesto que inventarlos o que
// callarlos. El Paso 4 de las corridas lo dice con todas las letras sobre el
// equipo evaluador: "no se asumen nombres".

export const OBJETIVOS = {
  0: "Construir la lista completa de Atributos de Calidad del producto — el universo de características que podrían indicar su calidad — antes de mirar ningún parámetro de proceso.",
  1: "Fijar, una sola vez por atributo, qué tan grave sería que ese atributo fallara, de forma independiente de cualquier parámetro de proceso.",
  2: "Identificar, para cada parámetro de proceso de cada etapa, si existe sospecha de vínculo con algún Atributo de Calidad — sin evaluar todavía su gravedad.",
  3: "Determinar la clasificación final (Crítico / Clave / No Clave) de cada parámetro, usando únicamente la Severidad del atributo vinculado y la pregunta de desempeño de proceso.",
  4: "Documentar Probabilidad y Detectabilidad únicamente para los parámetros ya declarados Crítico — no para decidir su clasificación, que ya está decidida, sino para priorizar entre ellos y diseñar su estrategia de control.",
  5: "Traducir la Severidad de cada atributo en un requisito de confianza estadística para el diseño de muestreo del PPQ.",
  6: "Establecer cuándo y quién revisa esta clasificación después de cerrada, evitando que la evaluación de riesgo quede congelada.",
};

/** Las reglas que gobiernan el procedimiento, dichas donde corresponde. */
export const REGLAS = {
  umbral:
    "Umbral aplicado (ICH Q9(R1), 2023): SOLO Severidad 4 o 5 puede producir Crítico. Severidad 1-3 nunca es Crítico y se resuelve directamente por impacto en el desempeño del proceso (Clave / No Clave).",
  clasificacion:
    "Regla aplicada: si el parámetro tiene sospecha de impacto (Paso 2) y el atributo vinculado tiene Severidad 4 o 5 (Paso 1) → Crítico automático, sin evaluar Probabilidad ni Detectabilidad. En cualquier otro caso —Severidad 1-3, o sin sospecha— se resuelve con la pregunta de desempeño de proceso: ¿afecta rendimiento, tiempo o consistencia? Sí → Clave; No → No Clave.",
  noClave:
    "Regla de oro: «No Clave» es el resultado esperado y correcto cuando la respuesta a la pregunta de desempeño es NO. No existe una cuarta opción ni un motivo para subir el parámetro a Clave por costumbre.",
  npr:
    "Regla de oro: el NPR NUNCA debe usarse como criterio principal para decidir Crítico / Clave / No Clave — esa decisión la da exclusivamente el árbol de decisión basado en Severidad. Un parámetro con Severidad 5 pero Probabilidad y Detectabilidad bajas (por ejemplo NPR = 10) sigue siendo Crítico; un NPR alto no vuelve crítico a un parámetro de severidad baja.",
  acoplados:
    "Regla sobre parámetros acoplados: cuando dos o más parámetros comparten el mismo racional de riesgo, heredan la misma Severidad y el mismo atributo vinculado, sin que la separación en filas de la tabla induzca una distinción de causalidad que el racional no sostiene.",
  redundancia:
    "Regla sobre redundancia de capas: el motivo de «redundancia estructural» no se aplica como excepción dentro del árbol de decisión — se aplica antes, al definir la Severidad del atributo. Una vez fijada, el árbol se aplica igual para todos los casos, sin excepciones adicionales.",
  severidadCalculada:
    "La Severidad de cada parámetro es la más alta de los atributos a los que afecta: el daño posible es el peor de los posibles, no el promedio. Se calcula, no se transcribe.",
  confianza:
    "La Confianza no se ajusta —la fija el TR60 según la Severidad—; lo que se ajusta es la Cobertura. Mientras más alta la calificación de severidad de un atributo, más alta la confianza estadística requerida en el muestreo.",
};

export const DECLARACION_DE_GAP =
  "Dado que no se dispone de datos de diseño de proceso (Stage 1) generados formalmente para este producto/proceso, " +
  "la clasificación de CPP/CQA se basa en análisis de riesgo causa-efecto y FMEA, conforme ICH Q9 y la metodología de " +
  "PDA TR60 e ISPE (2019), utilizando como insumo el conocimiento previo documentado y la experiencia de manufactura. " +
  "Esta clasificación queda sujeta a confirmación o reclasificación con datos generados durante la ejecución del PPQ y " +
  "el programa de Verificación Continua de Proceso (CPV).";

export const EQUIPO_MULTIDISCIPLINARIO =
  "Este campo debe completarse con los responsables reales antes de emitir el documento formalmente — no se asumen nombres. " +
  "Integrantes: [Producción] · [Aseguramiento de la Calidad] · [Control de Calidad] · [Validaciones] · [Ingeniería / Mantenimiento].";

/** Paso 6 — los disparadores de reevaluación, tal como los traen las corridas. */
export const PLAN_DE_REEVALUACION = [
  { disparador: "Resultados del lote de transferencia", responsable: "Validaciones", accion: "Confirmar o ajustar S/P/D con data real" },
  { disparador: "Resultados de cada lote PPQ", responsable: "Validaciones", accion: "Reclasificar si aplica, antes de la conclusión del PPQ" },
  { disparador: "Desviaciones en CPV", responsable: "Validaciones / Calidad", accion: "Evaluar si el parámetro requiere subir de clasificación" },
  { disparador: "Revisión periódica (anual)", responsable: "Validaciones", accion: "Revisión formal programada de este documento" },
];

export const NOTA_DE_PROCEDENCIA =
  "Esta corrida se elaboró con los registros de manufactura cargados en la aplicación y, cuando se subió, con el protocolo " +
  "del producto. Las filas marcadas «Propuesta por IA» son un borrador que hay que revisar y sustentar antes de firmar: " +
  "la referencia bibliográfica, cuando la hay, respalda el mecanismo descrito, no el nivel de impacto ni el veredicto de " +
  "criticidad. Los parámetros sin data histórica quedan señalados en el Paso 6 para revisarse cuando exista.";

/**
 * Cómo se traduce el nivel de confianza en un requisito de muestreo real.
 *
 * Se explica en el documento porque el número suelto no dice nada: quien lee
 * el protocolo de validación tiene que poder reconstruir de dónde salió el
 * tamaño de muestra.
 */
export const EXPLICACION_ESTADISTICA = [
  "Para un atributo de dato continuo (por ejemplo, el dosaje del principio activo) se usa un intervalo de tolerancia: " +
    "Límite = Promedio ± k × Desviación estándar, con k determinado por el nivel de confianza, la cobertura y el número de datos.",
  "Para un atributo de tipo pasa/no pasa (por ejemplo, esterilidad o identidad) se usa confianza-confiabilidad con cero " +
    "defectos: n = ln(1 − Confianza) / ln(Cobertura).",
  "Los factores exactos (k, tablas de confianza-confiabilidad) se obtienen de tablas estadísticas estándar (ISO 16269-6, " +
    "ASTM E2586) o de software estadístico.",
  "Esta tabla es el puente directo entre la evaluación de riesgo y el diseño de muestreo y el número de lotes del " +
    "protocolo de validación.",
];

/** Por qué un parámetro conviene revisarlo cuando haya data histórica. */
export const MOTIVOS_DE_REVISION = {
  sinCriterio:
    "El registro no le imprime un criterio de aceptación, así que su clasificación se apoya sólo en el racional del análisis de riesgo.",
  sinMargen:
    "Elevado a Crítico por ausencia de margen conocido: no consta el rango del equipo frente al rango de operación.",
  sinRespaldo:
    "La sospecha de impacto la propuso la IA y no se encontró respaldo bibliográfico que la sustente.",
};
