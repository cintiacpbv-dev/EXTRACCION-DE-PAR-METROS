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

// --- Del procedimiento oficial (Secuencia de elaboración del AR) ------------

/**
 * Las definiciones con las que abre el procedimiento, literales.
 *
 * Van al principio del documento porque todo lo demás se lee con ellas: un
 * «Clave» que no afecta a la calidad y un «No Clave» que sí puede hacerlo si
 * se sale de su límite amplio no son lo que la palabra sugiere a quien no
 * conoce el procedimiento.
 */
export const DEFINICIONES = [
  ["Atributo", "Cualquier propiedad física, química o microbiológica de un material de entrada o salida."],
  ["Atributo de calidad", "Una característica molecular o del producto, seleccionada por su capacidad para indicar la calidad de este. En conjunto, los atributos de calidad definen la identidad, pureza, potencia y estabilidad del producto, así como su seguridad frente a la contaminación microbiológica."],
  ["Atributo crítico de calidad (ACC)", "Una propiedad o característica física, química, biológica o microbiológica que debe estar dentro de un límite, rango o distribución apropiados para asegurar la calidad deseada del producto."],
  ["Parámetro de proceso", "Una variable de entrada o condición del proceso de manufactura que puede controlarse directamente en el proceso."],
  ["Parámetro crítico de proceso (PCP)", "Parámetro de proceso cuya variabilidad tiene impacto sobre un atributo crítico de calidad (ACC), y que por lo tanto debe ser monitoreado o controlado para asegurar que el proceso produzca la calidad deseada."],
  ["Parámetro clave de proceso", "Parámetro de proceso que debe controlarse cuidadosamente dentro de un rango estrecho y que es esencial para el desempeño del proceso. Un parámetro clave no afecta los atributos de calidad del producto: si se excede el rango aceptable, puede afectar el proceso (rendimiento, duración) pero no la calidad del producto."],
  ["Parámetro no clave de proceso", "Parámetro de proceso que ha sido demostrado como fácil de controlar, o que tiene un límite aceptable amplio. Los parámetros no claves pueden tener impacto en calidad o en desempeño de proceso si se exceden los límites aceptables."],
  ["Severidad, Probabilidad, Detectabilidad", "La Severidad se fija por el ACC en una escala de 1 a 5. La Probabilidad y la Detectabilidad pueden variar por parámetro."],
];

/** Los dos estados posibles del Paso 2, con las palabras del procedimiento. */
export const ESTADOS = {
  candidato: "Candidato a PCP",
  sinSospecha: "Sin sospecha de impacto",
};

/**
 * La pauta con la que se redacta cada análisis causa-efecto.
 *
 * El procedimiento la da con esta forma exacta, y los tres huecos son los
 * tres ingredientes obligatorios del Paso 2: el parámetro, el atributo, y el
 * origen de la sospecha.
 */
export const PAUTA_CAUSA_EFECTO =
  "Cada análisis se redacta con la pauta: «El [Parámetro] puede afectar [Atributo de Calidad] porque [origen de la sospecha]». " +
  "«Candidato a PCP»: sí hay sospecha de vínculo con algún atributo de calidad; pasa a evaluación de severidad. " +
  "«Sin sospecha de impacto»: no hay vínculo plausible con ningún atributo de calidad; pasa a la pregunta de desempeño, sin FMEA.";

/**
 * Lo que el procedimiento no dice, y cómo se resuelve.
 *
 * El texto "en revisión 2" cubre dos caminos: el candidato a PCP con atributo
 * de severidad 4-5 (Crítico) y el parámetro sin sospecha (pregunta de
 * desempeño). No dice qué pasa con un CANDIDATO a PCP cuyo atributo tiene
 * severidad 1 a 3. Las corridas lo resuelven mandándolo a la pregunta de
 * desempeño, que es lo coherente con el TR60 —sólo severidad 4-5 produce
 * Crítico— y es lo que hace esta aplicación. Se deja escrito en el documento
 * para que quien lo firme sepa que es una regla aplicada, no un olvido.
 */
export const VIA_NO_ESCRITA =
  "Criterio aplicado para el caso que el procedimiento no detalla: un «Candidato a PCP» cuyo atributo vinculado tiene " +
  "Severidad 1 a 3 no es Crítico (sólo Severidad 4-5 lo es) y se resuelve con la pregunta de desempeño de proceso, igual " +
  "que un parámetro sin sospecha.";

export const REGLA_PARTIDA =
  "El procedimiento propone estos parámetros como críticos de punto de partida, que deben verificarse en cada protocolo. " +
  "Los que la evaluación no dejó como Críticos se listan aquí con el motivo, para que la diferencia quede justificada.";

// --- El formato de Validaciones (Modelo.Formato_Evaluacion_Criticidad_Riesgo)
//
// Lo que sigue es el texto del formato vigente, literal: el documento que
// emite la aplicación sigue su orden (A → G y el anexo) y sus palabras, para
// que se pueda firmar tal cual sin reescribirlo.

export const FORMATO = {
  secuencia: [
    { paso: "PASO 1", nombre: "Atributos de calidad y severidad" },
    { paso: "PASO 2", nombre: "Análisis causa–efecto" },
    { paso: "PASO 3", nombre: "Clasificación final" },
    { paso: "PASO 4", nombre: "FMEA (solo PCP)" },
    { paso: "PASO 5", nombre: "Vínculo estadístico" },
  ],
  alCierre:
    "Al cierre: E. Reevaluación · F. Resumen de resultados · G. Aprobaciones. Si durante la secuencia de validación aparecen desviaciones u observaciones, se actualiza el análisis de riesgo.",
  situacionesGap: [
    "No se dispone de datos de diseño de proceso (Stage 1 / DoE) generados formalmente",
    "Producto de reciente introducción, sin historial suficiente para estudios estadísticos de capacidad",
    "Se dispone de datos de diseño de proceso (indicar referencia)",
  ],
  declaracionGap:
    "Dado que no se dispone de datos de diseño de proceso (Stage 1) generados formalmente para este producto/proceso, la clasificación de PCP/ACC se basa en análisis de riesgo causa–efecto y FMEA, conforme ICH Q9 y la metodología de PDA TR60 e ISPE (2019), utilizando como insumo el conocimiento previo documentado y la experiencia de manufactura. Esta clasificación queda sujeta a confirmación o reclasificación con datos generados durante la ejecución de la validación y el programa de Verificación Continua de Proceso (CPV).",
  areasDelEquipo: [
    "Validaciones",
    "Producción",
    "Control de Calidad",
    "Aseguramiento de la Calidad",
    "Ingeniería / Mantenimiento",
    "Desarrollo / Investigación",
  ],
  tiposDeValidacion: ["Prospectiva", "Concurrente", "Revalidación"],
  matrizSeveridad: [
    { letra: "A", impacto: "Riesgo directo a seguridad o eficacia, tolerancia cero (potencia, esterilidad, ausencia de patógenos)", baja: 5, alta: 5 },
    { letra: "B", impacto: "Vínculo directo a consecuencia grave, con límite tolerable por norma", baja: 4, alta: 5 },
    { letra: "C", impacto: "Vínculo indirecto (varios pasos causales) o redundancia estructural del sistema", baja: 3, alta: 4 },
    { letra: "D", impacto: "Cosmético con posible correlación funcional", baja: 2, alta: 3 },
    { letra: "E", impacto: "Puramente estético, sin correlación funcional", baja: 1, alta: 2 },
  ],
  preguntasGuia: {
    1: "¿Una variación del atributo prácticamente no tendría consecuencia sobre la calidad, seguridad o eficacia?",
    2: "¿La variación tendría una consecuencia limitada y no comprometería razonablemente seguridad o eficacia?",
    3: "¿Existe una posibilidad razonable de que la variación afecte el desempeño o alguna característica relevante del producto, pero la evidencia no es concluyente?",
    4: "¿La variación podría afectar significativamente una característica relacionada con calidad, seguridad o eficacia?",
    5: "¿La variación podría comprometer directamente una característica esencial para la seguridad, eficacia o desempeño del producto?",
  },
  notaNoAcc:
    "Nota: \"No estar en la especificación de rutina\" no es lo mismo que \"No ACC\". Un atributo asegurado por diseño o control de proceso (sin prueba de liberación) puede seguir siendo crítico.",
  redaccionPaso2:
    "Redacción: \"El [parámetro] puede afectar [atributo] porque [origen]\". Origen: CP = conocimiento previo · L = literatura · E = experiencia · M = mecanismo físico/químico elemental. Parámetros acoplados (misma operación y mismo racional) heredan el mismo atributo.",
  reglaPaso3:
    "Candidato + ACC (S = 4–5) → PCP · Candidato con S = 1–3 o sin sospecha → ¿impacto en desempeño (rendimiento, duración, consistencia)? Sí → Clave · No → No clave. La probabilidad y detectabilidad NO deciden la clasificación.",
  ocurrencia: [
    ["Muy baja", 1, "No ha ocurrido en el último año.", "Fácilmente controlado, automatizado o con rango amplio demostrado"],
    ["Baja", 2, "Una vez en el último año.", "Rango amplio; control demostrado en plataforma similar"],
    ["Moderada", 3, "Dos veces en el último año.", "Control demostrado sin amplio margen; monitoreo activo"],
    ["Alta", 4, "Tres veces en el último año.", "Rango moderadamente estrecho; desviaciones en procesos análogos"],
    ["Muy alta", 5, "Más de tres veces en el último año.", "Rango estrecho vs. variabilidad natural; sin historial robusto"],
  ],
  detectabilidad: [
    ["Muy detectable", 1, "En las revisiones previas a la elaboración del protocolo", "Control continuo automatizado (PAT)"],
    ["Detectable", 2, "Durante la elaboración del protocolo", "Monitoreo en línea con alarmas"],
    ["Moderadamente detectable", 3, "Durante la ejecución de los lotes de validación", "Muestreo en proceso a intervalos"],
    ["Baja detectabilidad", 4, "Durante la elaboración del reporte de validación", "Detección fuera de línea, con retraso"],
    ["No puede ser detectado", 5, "Durante el mantenimiento del estado validado", "Solo en producto terminado, si acaso"],
  ],
  npr: [
    ["36 – 125", "ROJO", "Inaceptable: prioridad de atención inmediata. No realizar la validación; controlar / mitigar el riesgo a corto plazo y revisar controles antes de validar."],
    ["16 – 35", "AMARILLO", "Moderado: proceder con la validación con verificaciones y controles específicos; monitoreo reforzado / revisión periódica."],
    ["1 – 15", "VERDE", "Aceptable: proceder con la validación; monitoreo estándar. No se requiere controlar el riesgo."],
  ],
  criterioFmea:
    "Ocurrencia (O): propuesta a partir del ancho del rango de operación, porque no se contó con el historial de desviaciones / no conformidades del último año; confirmar con el historial antes de emitir. Detectabilidad (D): según el momento de la secuencia de validación en que se detectaría la falla. NPR: 36–125 Rojo (no validar sin mitigar) · 16–35 Amarillo (validar con controles específicos) · 1–15 Verde (monitoreo estándar). Registrar el análisis en el formato FASC-252 vigente «Análisis de Riesgo».",
  notaFmea:
    "S se copia del Paso 1b. Si hay desviaciones u observaciones durante la secuencia de validación, actualizar este análisis.",
  tiposDeDato: [
    ["Continuo", "Se mide como un número en una escala", "Valoración, uniformidad de dosis, peso promedio, disolución, pH"],
    ["Atributo", "Pasa / no pasa, presente / ausente", "Identidad, ausencia de microorganismos, hermeticidad"],
  ],
  notaPaso5:
    "Dato continuo → intervalo de tolerancia (Promedio ± k × DE); dato atributo → confianza-confiabilidad con cero defectos: n = ln(1 − Confianza) / ln(Cobertura). Los factores k y los tamaños de muestra se obtienen de tablas estándar (ISO 16269-6, ASTM E2586) o software estadístico; no se estiman a ojo.",
  disparadores: [
    ["Resultados del lote de transferencia", "Validaciones", "Confirmar o ajustar S / O / D con datos reales"],
    ["Resultados de cada lote de validación", "Validaciones", "Reclasificar si aplica, antes de la conclusión del estudio"],
    ["Desviaciones u observaciones durante la secuencia de validación", "Validaciones / Calidad", "Actualizar el análisis de riesgo; evaluar si el parámetro sube de clasificación"],
    ["Desviaciones en la Verificación Continua de Proceso (CPV)", "Validaciones / Calidad", "Evaluar si el parámetro requiere subir de clasificación"],
    ["Revisión periódica (anual)", "Validaciones", "Revisión formal programada de este documento"],
  ],
  conclusiones: [
    "Todos los PCP con riesgo aceptable (verde): proceder con la validación.",
    "Existen PCP con riesgo moderado (amarillo): proceder con la validación con los controles específicos definidos en el Paso 4.",
    "Existen PCP con riesgo inaceptable (rojo): NO realizar la validación hasta mitigar el riesgo.",
  ],
  aprobaciones: ["Elaborado por", "Revisado por", "Revisado por", "Aprobado por"],
  definiciones: [
    ["Atributo", "Cualquier propiedad física, química o microbiológica de un material de entrada o salida."],
    ["Atributo de calidad", "Característica molecular o del producto seleccionada por su capacidad para indicar su calidad. En conjunto definen identidad, pureza, potencia, estabilidad y seguridad frente a agentes adventicios. Las especificaciones evalúan solo un subconjunto de ellos."],
    ["Atributo crítico de calidad (ACC)", "Propiedad o característica física, química, biológica o microbiológica que debe estar dentro de un límite, rango o distribución apropiados para asegurar la calidad deseada del producto. En este formato: Severidad 4 o 5."],
    ["Parámetro de proceso", "Variable de entrada o condición del proceso de manufactura que puede controlarse directamente."],
    ["Parámetro crítico de proceso (PCP)", "Parámetro cuya variabilidad tiene impacto sobre un ACC, por lo que debe monitorearse o controlarse para asegurar la calidad deseada."],
    ["Parámetro clave de proceso", "Parámetro que debe controlarse dentro de un rango estrecho y es esencial para el desempeño del proceso (rendimiento, duración), pero no afecta atributos de calidad del producto."],
    ["Parámetro no clave de proceso", "Parámetro demostrado como fácil de controlar o con límite aceptable amplio."],
    ["Severidad (S)", "Gravedad de la falla del atributo de calidad (escala 1–5). Se fija por atributo, no por parámetro."],
    ["Ocurrencia / Probabilidad (O)", "Frecuencia de desviaciones y/o no conformidades registradas asociadas al punto evaluado. Varía por parámetro."],
    ["Detectabilidad (D)", "Momento de la secuencia de validación en que se detectaría la falla. Varía por parámetro."],
    ["NPR", "Número de prioridad de riesgo = S × O × D."],
  ],
};
