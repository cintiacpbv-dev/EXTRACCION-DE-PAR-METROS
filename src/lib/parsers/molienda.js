// Un paso de molienda cambia tres ajustes a la vez —la malla, la velocidad
// y la posición del martillo o la cuchilla— y el registro lo redacta como
// una sola frase corrida ("(1.02 mm), VELOCIDAD ALTA, MARTILLO ADELANTE"),
// sin una columna aparte para cada dato. El detector genérico la lee entera
// como una única etiqueta fea, sin ningún criterio útil para el cuadro.
//
// El protocolo de validación de Fluixx confirma que las tres son
// parámetros de verdad, cada uno con su propia fila en el Cuadro 6 de
// análisis de riesgo (N° de malla, Velocidad, Posición) — así que aquí se
// separan igual, con el mismo nombre, en vez de dejarlas amontonadas o
// —como se intentó antes— descartarlas por parecer texto corrido.
//
// Lo que dice la frase es el ajuste fijo del procedimiento, no una lectura
// que varíe lote a lote (por eso no hay ninguna columna de valor al lado
// en el propio registro): se guarda como setpoint, igual que "TEMPERATURA
// PROGRAMADA (62 °C)".

const LECTURA_RE = /\s*—\s*Lectura\s*\d+\s*$/i;

const MOLIENDA_RE =
  /^\(?\s*([\d.,]+)\s*mm\)?\s*,?\s*(?:VELOCIDAD\s+)?(ALTA|MEDIA|BAJA)(?:\s+VELOCIDAD)?\s*,?\s*(MARTILLO|CUCHILLA)\s+(ADELANTE|ATR[ÁA]S)\s*[:.]?$/i;

export function conMolienda(params) {
  const salida = [];

  for (const p of params) {
    const label = p.label || "";
    const sinLectura = label.replace(LECTURA_RE, "").trim();
    const m = MOLIENDA_RE.exec(sinLectura);

    if (!m) {
      salida.push(p);
      continue;
    }

    const [, malla, velocidad, pieza, direccion] = m;
    // "— Lectura N" (si lo hay) se conserva en las tres filas nuevas, para
    // que sigan identificadas por su fracción como el resto del cuadro.
    const sufijo = label.slice(sinLectura.length);

    const fila = (nombre, setpoint) => ({
      ...p,
      id: `${p.id}::${nombre.replace(/\s+/g, "_")}`,
      label: `${nombre}${sufijo}`,
      baseLabel: `${nombre}${sufijo}`,
      setpoint,
      unit: "",
      valueType: "text",
      value: "",
      category: "critico",
    });

    salida.push(fila("N° de malla", `${malla} mm`));
    salida.push(fila("Velocidad", velocidad.toUpperCase()));
    salida.push(fila(`Posición (${pieza.toLowerCase()})`, direccion.toUpperCase()));
  }

  return salida;
}
