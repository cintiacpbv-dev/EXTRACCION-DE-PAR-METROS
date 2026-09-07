// Fórmulas de la hoja de trabajo.
//
// Una celda que empieza por "=" es una fórmula. El vocabulario es el de una
// hoja de cálculo, con dos formas de nombrar los datos:
//
//   =C1 * 2                → la celda de C1 EN ESTA MISMA FILA, por 2
//   =PROMEDIO(C1)          → el promedio de toda la columna C1
//   =(C1 - PROMEDIO(C1)) / DESVEST(C1)
//
// Que una referencia suelta signifique "la misma fila" es lo que hace útil
// arrastrar una fórmula hacia abajo, y es también como funciona la
// calculadora de Minitab, que es de donde viene quien usa esto. Para hablar
// de la columna entera hay que decirlo con una función.
//
// El evaluador es propio y no un "eval" del navegador: aquí se escriben
// fórmulas a mano en un expediente de validación, y dejar que un texto
// cualquiera se ejecute como código sería regalar la aplicación a quien pegue
// algo raro en una celda.

const FUNCIONES_COLUMNA = {
  SUMA: (xs) => xs.reduce((a, b) => a + b, 0),
  PROMEDIO: (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN),
  MEDIA: (xs) => FUNCIONES_COLUMNA.PROMEDIO(xs),
  CONTAR: (xs) => xs.length,
  MIN: (xs) => (xs.length ? Math.min(...xs) : NaN),
  MAX: (xs) => (xs.length ? Math.max(...xs) : NaN),
  MEDIANA: (xs) => {
    if (!xs.length) return NaN;
    const o = [...xs].sort((a, b) => a - b);
    const m = Math.floor(o.length / 2);
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  },
  DESVEST: (xs) => {
    if (xs.length < 2) return NaN;
    const media = FUNCIONES_COLUMNA.PROMEDIO(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - media) ** 2, 0) / (xs.length - 1));
  },
  VARIANZA: (xs) => {
    const s = FUNCIONES_COLUMNA.DESVEST(xs);
    return Number.isNaN(s) ? NaN : s * s;
  },
  RANGO: (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : NaN),
};

const FUNCIONES_NUMERO = {
  RAIZ: Math.sqrt,
  ABS: Math.abs,
  LN: Math.log,
  LOG: Math.log10,
  EXP: Math.exp,
  REDONDEAR: (x, d = 0) => {
    const f = 10 ** d;
    return Math.round(x * f) / f;
  },
};

/**
 * Los pedazos de una fórmula: números, nombres, operadores y paréntesis.
 *
 * Dentro de una fórmula el decimal es el punto, y la coma (o el punto y coma)
 * separan argumentos. No se puede tener las dos cosas: con la coma haciendo
 * de decimal, "REDONDEAR(C1/3,2)" se leía como redondear entre "3,2" y se
 * perdía el segundo argumento. Es la misma decisión que toma Excel, que en
 * español cambia el separador a ";" justo por esto. Escribir una coma decimal
 * no rompe nada: se avisa de que ahí va un punto (ver calcularFormula).
 */
function separar(texto) {
  const piezas = [];
  const re = /\s*([A-Za-zÁÉÍÓÚÑáéíóúñ_][\w.ÁÉÍÓÚÑáéíóúñ]*|\d+(?:\.\d+)?|\*\*|[-+*/^(),;])/gy;
  let pos = 0;

  while (pos < texto.length) {
    re.lastIndex = pos;
    const m = re.exec(texto);
    if (!m) {
      if (texto.slice(pos).trim() === "") break;
      throw new Error(`No entiendo "${texto.slice(pos).trim()}"`);
    }
    piezas.push(m[1] === "**" ? "^" : m[1]);
    pos = re.lastIndex;
  }
  return piezas;
}

/**
 * Evalúa una fórmula ya sin el "=".
 *
 * `contexto` sabe resolver un nombre: `celda(nombre)` da el valor de esa
 * columna en la fila que se está calculando, y `columna(nombre)` da todos sus
 * números para las funciones de columna.
 */
function evaluar(piezas, contexto) {
  let i = 0;

  const mirar = () => piezas[i];
  const tomar = () => piezas[i++];

  function expresion() {
    let valor = termino();
    while (mirar() === "+" || mirar() === "-") {
      const op = tomar();
      const derecha = termino();
      valor = op === "+" ? valor + derecha : valor - derecha;
    }
    return valor;
  }

  function termino() {
    let valor = potencia();
    while (mirar() === "*" || mirar() === "/") {
      const op = tomar();
      const derecha = potencia();
      valor = op === "*" ? valor * derecha : valor / derecha;
    }
    return valor;
  }

  function potencia() {
    const base = unario();
    if (mirar() === "^") {
      tomar();
      // A la derecha, para que 2^3^2 sea 2^(3^2), como en una hoja de cálculo.
      return base ** potencia();
    }
    return base;
  }

  function unario() {
    if (mirar() === "-") {
      tomar();
      return -unario();
    }
    if (mirar() === "+") {
      tomar();
      return unario();
    }
    return atomo();
  }

  function atomo() {
    const pieza = tomar();
    if (pieza === undefined) throw new Error("La fórmula está incompleta");

    if (pieza === "(") {
      const valor = expresion();
      if (tomar() !== ")") throw new Error("Falta cerrar un paréntesis");
      return valor;
    }

    if (/^\d/.test(pieza)) return parseFloat(pieza);

    const nombre = pieza.toUpperCase();

    if (mirar() === "(") {
      tomar();
      const argumentos = [];
      if (mirar() !== ")") {
        argumentos.push(expresion());
        while (mirar() === "," || mirar() === ";") {
          tomar();
          argumentos.push(expresion());
        }
      }
      if (tomar() !== ")") throw new Error(`Falta cerrar el paréntesis de ${nombre}`);
      return aplicarFuncion(nombre, argumentos, piezas, contexto);
    }

    // Un nombre suelto es una celda de esta misma fila.
    const valor = contexto.celda(nombre);
    if (valor === null || valor === undefined || valor === "") return 0;
    const n = typeof valor === "number" ? valor : parseFloat(String(valor).replace(",", "."));
    if (Number.isNaN(n)) throw new Error(`${nombre} no tiene un número en esta fila`);
    return n;
  }

  function aplicarFuncion(nombre, argumentos) {
    if (FUNCIONES_NUMERO[nombre]) return FUNCIONES_NUMERO[nombre](...argumentos);
    throw new Error(`No conozco la función ${nombre}`);
  }

  // Las funciones de columna se resuelven antes de evaluar (ver
  // `resolverFuncionesDeColumna`), así que aquí sólo quedan las de número.
  const resultado = expresion();
  if (i < piezas.length) throw new Error(`Sobra "${piezas.slice(i).join(" ")}"`);
  return resultado;
}

/**
 * Sustituye PROMEDIO(C1) y compañía por su número antes de evaluar.
 *
 * Se hace aparte porque su argumento no es un número sino una columna entera:
 * mezclarlo con el resto de la evaluación obligaría a que cada valor pudiera
 * ser "un número o una lista", y a comprobarlo en cada operación.
 */
function resolverFuncionesDeColumna(texto, contexto) {
  const re = new RegExp(`\\b(${Object.keys(FUNCIONES_COLUMNA).join("|")})\\s*\\(\\s*([A-Za-z_][\\w.]*)\\s*\\)`, "gi");
  return texto.replace(re, (_, fn, columna) => {
    const valores = contexto.columna(columna.toUpperCase());
    const resultado = FUNCIONES_COLUMNA[fn.toUpperCase()](valores);
    if (!Number.isFinite(resultado)) throw new Error(`${fn.toUpperCase()}(${columna}) no se puede calcular`);
    // Entre paréntesis: si el resultado es negativo, pegarlo suelto cambiaría
    // el signo de la operación que lo rodea.
    return `(${resultado})`;
  });
}

export function esFormula(texto) {
  return typeof texto === "string" && texto.trim().startsWith("=");
}

/**
 * Calcula una fórmula. Devuelve `{ valor }` o `{ error }` — nunca lanza: una
 * fórmula mal escrita tiene que dejar un aviso en su celda, no tumbar la hoja
 * entera mientras se escribe.
 */
export function calcularFormula(texto, contexto) {
  try {
    const cuerpo = String(texto).trim().replace(/^=/, "");
    if (!cuerpo.trim()) return { error: "Fórmula vacía" };
    const sinColumnas = resolverFuncionesDeColumna(cuerpo, contexto);
    const valor = evaluar(separar(sinColumnas), contexto);
    if (!Number.isFinite(valor)) return { error: "El resultado no es un número" };
    return { valor };
  } catch (e) {
    // La confusión más probable, y la que peor se explica sola: dentro de una
    // fórmula la coma separa argumentos, así que "1,5" son dos cosas.
    if (/\d\s*,\s*\d/.test(String(texto)) && /Sobra/.test(e.message)) {
      return { error: "Dentro de una fórmula los decimales van con punto: escribe 1.5, no 1,5" };
    }
    return { error: e.message };
  }
}

export const _paraPruebas = { separar, FUNCIONES_COLUMNA };
