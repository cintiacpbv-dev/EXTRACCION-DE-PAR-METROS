import { useState } from "react";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { estadisticaDescriptiva } from "../lib/estadistica/descriptiva.js";
import { opcionBoxplot, opcionDispersion, opcionHistograma, opcionIMR, opcionXbarR, opcionCapacidad } from "../lib/estadistica/graficos.js";
import { tUnaMuestra, tDosMuestras, tPareada, pruebaVarianzas, proporcionUnaMuestra, correlacion } from "../lib/estadistica/pruebas.js";
import { graficaIndividuosMR, graficaXbarR, capacidadProceso } from "../lib/estadistica/spc.js";
import { IconAlert, IconFlask } from "./Icons.jsx";

const ACCIONES = [
  { id: "descriptiva", nombre: "Estadística descriptiva", minColumnas: 1, maxColumnas: null, ayuda: "Elige una o más columnas numéricas." },
  { id: "histograma", nombre: "Histograma", minColumnas: 1, maxColumnas: 1, ayuda: "Elige una columna numérica." },
  { id: "boxplot", nombre: "Diagrama de caja", minColumnas: 1, maxColumnas: null, ayuda: "Elige una o más columnas numéricas, para compararlas lado a lado." },
  { id: "dispersion", nombre: "Diagrama de dispersión", minColumnas: 2, maxColumnas: 3, ayuda: "Elige X e Y (numéricas); una tercera columna de texto es opcional, para colorear por grupo." },
  { id: "correlacion", nombre: "Correlación", minColumnas: 2, maxColumnas: null, ayuda: "Elige dos columnas numéricas para el detalle, o más de dos para una matriz." },
  {
    id: "t1",
    nombre: "Prueba t (1 muestra)",
    minColumnas: 1,
    maxColumnas: 1,
    ayuda: "Elige una columna numérica y da el valor de referencia con el que quieres comparar la media.",
    extras: [{ key: "mu0", label: "Valor de referencia (μ₀)", tipo: "number", valorInicial: 0 }],
  },
  { id: "t2", nombre: "Prueba t (2 muestras)", minColumnas: 2, maxColumnas: 2, ayuda: "Elige dos columnas numéricas independientes entre sí." },
  { id: "tpareada", nombre: "Prueba t pareada", minColumnas: 2, maxColumnas: 2, ayuda: "Elige dos columnas numéricas medidas sobre los mismos sujetos, fila a fila (antes/después)." },
  { id: "varianzas", nombre: "Prueba de varianzas (F)", minColumnas: 2, maxColumnas: 2, ayuda: "Elige dos columnas numéricas para comparar su variación." },
  {
    id: "proporcion1",
    nombre: "Prueba de proporción (1 muestra)",
    minColumnas: 1,
    maxColumnas: 1,
    ayuda: "Elige una columna de texto con dos valores posibles (ej. Conforme/No conforme).",
    extras: [
      { key: "valorExito", label: 'Valor considerado "éxito" (tal cual aparece en la columna)', tipo: "text", valorInicial: "" },
      { key: "p0", label: "Proporción de referencia (p₀, entre 0 y 1)", tipo: "number", valorInicial: 0.5, paso: 0.01 },
    ],
  },
  { id: "imr", nombre: "Gráfica de control I-MR", minColumnas: 1, maxColumnas: 1, ayuda: "Elige una columna numérica, en el orden en que se midió (una medición por fila)." },
  {
    id: "xbarr",
    nombre: "Gráfica de control Xbar-R",
    minColumnas: 1,
    maxColumnas: 1,
    ayuda: "Elige una columna numérica. Los datos se agrupan de a tantas filas seguidas como el tamaño de subgrupo, en el orden de la hoja.",
    extras: [{ key: "subgrupo", label: "Tamaño de subgrupo (2 a 10)", tipo: "number", valorInicial: 5 }],
  },
  {
    id: "capacidad",
    nombre: "Análisis de capacidad (Cp/Cpk/Pp/Ppk)",
    minColumnas: 1,
    maxColumnas: 1,
    ayuda: "Elige una columna numérica y da al menos un límite de especificación.",
    extras: [
      { key: "lsl", label: "Límite inferior de especificación (LEI, opcional)", tipo: "number", valorInicial: "" },
      { key: "usl", label: "Límite superior de especificación (LES, opcional)", tipo: "number", valorInicial: "" },
      { key: "subgrupo", label: "Tamaño de subgrupo para Cp/Cpk (opcional; vacío = sólo Pp/Ppk)", tipo: "number", valorInicial: "" },
    ],
  },
];

const GRUPOS = [
  { nombre: "Descriptiva y gráficos", ids: ["descriptiva", "histograma", "boxplot", "dispersion", "correlacion"] },
  { nombre: "Pruebas de hipótesis", ids: ["t1", "t2", "tpareada", "varianzas", "proporcion1"] },
  { nombre: "Control de calidad (SPC)", ids: ["imr", "xbarr", "capacidad"] },
];

function formatearNumero(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n.toFixed(4)).toLocaleString("es-PE", { maximumFractionDigits: 4 });
}

function formatearP(p) {
  if (p == null || Number.isNaN(p)) return "—";
  return p < 0.0001 ? "< 0.0001" : formatearNumero(p);
}

function tablaDescriptiva(columnasSeleccionadas) {
  const encabezados = ["Columna", "N", "N faltante", "Media", "Mediana", "Desv. Est.", "Mínimo", "Q1", "Q3", "Máximo", "Asimetría"];
  const filas = columnasSeleccionadas.map((c) => {
    const r = estadisticaDescriptiva(c.values);
    if (r.vacio) return [c.name, String(r.n), String(r.faltantes), "—", "—", "—", "—", "—", "—", "—", "—"];
    return [
      c.name,
      String(r.n),
      String(r.faltantes),
      formatearNumero(r.media),
      formatearNumero(r.mediana),
      formatearNumero(r.desvEst),
      formatearNumero(r.minimo),
      formatearNumero(r.q1),
      formatearNumero(r.q3),
      formatearNumero(r.maximo),
      formatearNumero(r.asimetria),
    ];
  });
  return { encabezados, filas };
}

function tablaMatrizCorrelacion(columnasSeleccionadas) {
  const encabezados = ["", ...columnasSeleccionadas.map((c) => c.name)];
  const filas = columnasSeleccionadas.map((fila) => [
    fila.name,
    ...columnasSeleccionadas.map((col) => {
      if (fila === col) return "1";
      const r = correlacion(fila.values, col.values);
      return r.error ? "—" : formatearNumero(r.r);
    }),
  ]);
  return { encabezados, filas };
}

export default function AnalysisAssistant() {
  const columns = useWorkbookStore((s) => s.columns);
  const registrarResultado = useWorkbookStore((s) => s.registrarResultado);
  const agregarGrafico = useWorkbookStore((s) => s.agregarGrafico);
  const [accionId, setAccionId] = useState(ACCIONES[0].id);
  const [seleccion, setSeleccion] = useState([]);
  const [extras, setExtras] = useState({});
  const [aviso, setAviso] = useState("");

  const accion = ACCIONES.find((a) => a.id === accionId);
  const columnasSeleccionadas = columns.filter((c) => seleccion.includes(c.id));

  function cambiarAccion(id) {
    setAccionId(id);
    setAviso("");
    const nueva = ACCIONES.find((a) => a.id === id);
    const iniciales = {};
    for (const e of nueva.extras || []) iniciales[e.key] = e.valorInicial;
    setExtras(iniciales);
  }

  function alternarColumna(id) {
    setAviso("");
    setSeleccion((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function valorExtra(key, tipo) {
    const v = extras[key];
    if (v === "" || v == null) return null;
    return tipo === "number" ? Number(v) : v;
  }

  function ejecutar() {
    setAviso("");
    if (columnasSeleccionadas.length < accion.minColumnas) {
      setAviso(`Selecciona al menos ${accion.minColumnas} columna(s). ${accion.ayuda}`);
      return;
    }
    if (accion.maxColumnas && columnasSeleccionadas.length > accion.maxColumnas) {
      setAviso(`Selecciona como máximo ${accion.maxColumnas} columna(s) para esto. ${accion.ayuda}`);
      return;
    }

    if (accion.id === "descriptiva") {
      const noNumericas = columnasSeleccionadas.filter((c) => c.type !== "numeric");
      registrarResultado(
        `Estadística descriptiva: ${columnasSeleccionadas.map((c) => c.name).join(", ")}`,
        tablaDescriptiva(columnasSeleccionadas),
        noNumericas.map((c) => `"${c.name}" no es numérica: sus valores se ignoran en los cálculos.`)
      );
    } else if (accion.id === "histograma") {
      const [c] = columnasSeleccionadas;
      if (c.type !== "numeric") {
        setAviso(`"${c.name}" no es una columna numérica.`);
        return;
      }
      agregarGrafico(`Histograma — ${c.name}`, opcionHistograma(c.values, c.name));
    } else if (accion.id === "boxplot") {
      const noNumericas = columnasSeleccionadas.filter((c) => c.type !== "numeric");
      if (noNumericas.length === columnasSeleccionadas.length) {
        setAviso("Ninguna de las columnas elegidas es numérica.");
        return;
      }
      agregarGrafico(`Diagrama de caja — ${columnasSeleccionadas.map((c) => c.name).join(", ")}`, opcionBoxplot(columnasSeleccionadas.filter((c) => c.type === "numeric")));
    } else if (accion.id === "dispersion") {
      const [x, y, grupo] = columnasSeleccionadas;
      if (x.type !== "numeric" || y.type !== "numeric") {
        setAviso("Las dos primeras columnas (X e Y) deben ser numéricas.");
        return;
      }
      agregarGrafico(`${y.name} vs. ${x.name}`, opcionDispersion(x, y, grupo));
    } else if (accion.id === "correlacion") {
      const noNumericas = columnasSeleccionadas.filter((c) => c.type !== "numeric");
      if (noNumericas.length > 0) {
        setAviso(`Todas las columnas deben ser numéricas ("${noNumericas[0].name}" no lo es).`);
        return;
      }
      if (columnasSeleccionadas.length === 2) {
        const [a, b] = columnasSeleccionadas;
        const r = correlacion(a.values, b.values);
        if (r.error) {
          setAviso(r.error);
          return;
        }
        registrarResultado(`Correlación: ${a.name} vs. ${b.name}`, {
          encabezados: ["N", "r de Pearson", "gl", "t", "Valor p"],
          filas: [[String(r.n), formatearNumero(r.r), String(r.gl), formatearNumero(r.t), formatearP(r.valorP)]],
        });
      } else {
        registrarResultado(`Matriz de correlación: ${columnasSeleccionadas.map((c) => c.name).join(", ")}`, tablaMatrizCorrelacion(columnasSeleccionadas));
      }
    } else if (accion.id === "t1") {
      const [c] = columnasSeleccionadas;
      const mu0 = valorExtra("mu0", "number") ?? 0;
      const r = tUnaMuestra(c.values, mu0);
      if (r.error) {
        setAviso(r.error);
        return;
      }
      registrarResultado(`Prueba t (1 muestra): ${c.name}`, {
        encabezados: ["N", "Media", "Desv. Est.", "μ₀", "t", "gl", "Valor p"],
        filas: [[String(r.n), formatearNumero(r.media), formatearNumero(r.desvEst), formatearNumero(r.mu0), formatearNumero(r.t), String(r.gl), formatearP(r.valorP)]],
      });
    } else if (accion.id === "t2") {
      const [a, b] = columnasSeleccionadas;
      const r = tDosMuestras(a.values, b.values);
      if (r.error) {
        setAviso(r.error);
        return;
      }
      registrarResultado(`Prueba t (2 muestras): ${a.name} vs. ${b.name}`, {
        encabezados: ["Columna", "N", "Media", "Desv. Est.", "Diferencia", "t (Welch)", "gl", "Valor p"],
        filas: [
          [a.name, String(r.nA), formatearNumero(r.mediaA), formatearNumero(r.desvEstA), "", "", "", ""],
          [b.name, String(r.nB), formatearNumero(r.mediaB), formatearNumero(r.desvEstB), "", "", "", ""],
          [`Diferencia (${a.name} − ${b.name})`, "", "", "", formatearNumero(r.diferencia), formatearNumero(r.t), formatearNumero(r.gl), formatearP(r.valorP)],
        ],
      });
    } else if (accion.id === "tpareada") {
      const [a, b] = columnasSeleccionadas;
      const r = tPareada(a.values, b.values);
      if (r.error) {
        setAviso(r.error);
        return;
      }
      registrarResultado(`Prueba t pareada: ${a.name} − ${b.name}`, {
        encabezados: ["N pares", "Media diferencia", "Desv. Est. diferencia", "t", "gl", "Valor p"],
        filas: [[String(r.nPares), formatearNumero(r.mediaDiferencia), formatearNumero(r.desvEst), formatearNumero(r.t), String(r.gl), formatearP(r.valorP)]],
      });
    } else if (accion.id === "varianzas") {
      const [a, b] = columnasSeleccionadas;
      const r = pruebaVarianzas(a.values, b.values);
      if (r.error) {
        setAviso(r.error);
        return;
      }
      registrarResultado(`Prueba de varianzas: ${a.name} vs. ${b.name}`, {
        encabezados: ["Columna", "N", "Varianza", "Desv. Est.", "F", "gl (num.)", "gl (den.)", "Valor p"],
        filas: [
          [a.name, String(r.nA), formatearNumero(r.varianzaA), formatearNumero(r.desvEstA), "", "", "", ""],
          [b.name, String(r.nB), formatearNumero(r.varianzaB), formatearNumero(r.desvEstB), "", "", "", ""],
          [`F = Var(${a.name}) / Var(${b.name})`, "", "", "", formatearNumero(r.F), String(r.glA), String(r.glB), formatearP(r.valorP)],
        ],
      });
    } else if (accion.id === "proporcion1") {
      const [c] = columnasSeleccionadas;
      const valorExito = valorExtra("valorExito", "text");
      const p0 = valorExtra("p0", "number");
      if (!valorExito) {
        setAviso('Escribe qué valor de la columna cuenta como "éxito".');
        return;
      }
      if (p0 == null || p0 <= 0 || p0 >= 1) {
        setAviso("La proporción de referencia (p₀) debe estar entre 0 y 1.");
        return;
      }
      const r = proporcionUnaMuestra(c.values, valorExito, p0);
      if (r.error) {
        setAviso(r.error);
        return;
      }
      if (r.exitos === 0) {
        setAviso(`Ningún valor de "${c.name}" coincide exactamente con "${valorExito}". Revisa mayúsculas y espacios.`);
        return;
      }
      registrarResultado(`Prueba de proporción: ${c.name} = "${valorExito}"`, {
        encabezados: ["N", "Éxitos", "Proporción muestral", "p₀", "z", "Valor p"],
        filas: [[String(r.n), String(r.exitos), formatearNumero(r.pMuestra), formatearNumero(r.p0), formatearNumero(r.z), formatearP(r.valorP)]],
      });
    } else if (accion.id === "imr") {
      const [c] = columnasSeleccionadas;
      if (c.type !== "numeric") {
        setAviso(`"${c.name}" no es una columna numérica.`);
        return;
      }
      const r = graficaIndividuosMR(c.values);
      if (r.error) {
        setAviso(r.error);
        return;
      }
      agregarGrafico(`I-MR — ${c.name}`, opcionIMR(r, c.name));
    } else if (accion.id === "xbarr") {
      const [c] = columnasSeleccionadas;
      const subgrupo = valorExtra("subgrupo", "number");
      if (c.type !== "numeric") {
        setAviso(`"${c.name}" no es una columna numérica.`);
        return;
      }
      const r = graficaXbarR(c.values, subgrupo);
      if (r.error) {
        setAviso(r.error);
        return;
      }
      agregarGrafico(`Xbar-R — ${c.name} (n=${subgrupo})`, opcionXbarR(r, c.name));
    } else if (accion.id === "capacidad") {
      const [c] = columnasSeleccionadas;
      const lsl = valorExtra("lsl", "number");
      const usl = valorExtra("usl", "number");
      const subgrupo = valorExtra("subgrupo", "number");
      if (c.type !== "numeric") {
        setAviso(`"${c.name}" no es una columna numérica.`);
        return;
      }
      const r = capacidadProceso(c.values, { lsl, usl, tamanoSubgrupo: subgrupo });
      if (r.error) {
        setAviso(r.error);
        return;
      }
      registrarResultado(
        `Capacidad de proceso: ${c.name}`,
        {
          encabezados: ["N", "Media", "Desv. Est. global", "LEI", "LES", "Pp", "Ppk", "Cp", "Cpk"],
          filas: [
            [
              String(r.n),
              formatearNumero(r.media),
              formatearNumero(r.sigmaGlobal),
              r.lsl != null ? formatearNumero(r.lsl) : "—",
              r.usl != null ? formatearNumero(r.usl) : "—",
              r.pp != null ? formatearNumero(r.pp) : "—",
              formatearNumero(r.ppk),
              r.cp != null ? formatearNumero(r.cp) : "—",
              r.cpk != null ? formatearNumero(r.cpk) : "—",
            ],
          ],
        },
        r.cp == null ? ['Sin tamaño de subgrupo no se puede estimar la variación "dentro" del proceso: sólo se calculan Pp/Ppk.'] : []
      );
      agregarGrafico(`Capacidad — ${c.name}`, opcionCapacidad(c.values, c.name, { lsl, usl }));
    }
    setSeleccion([]);
  }

  return (
    <aside className="assistant-panel">
      <div className="assistant-header">
        <IconFlask size={16} />
        <h3>Asistente de análisis</h3>
      </div>

      <label className="assistant-campo">
        <span>Prueba o gráfico</span>
        <select value={accionId} onChange={(e) => cambiarAccion(e.target.value)}>
          {GRUPOS.map((g) => (
            <optgroup key={g.nombre} label={g.nombre}>
              {g.ids.map((id) => {
                const a = ACCIONES.find((x) => x.id === id);
                return (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="assistant-ayuda">{accion.ayuda}</p>

      {accion.extras?.map((e) => (
        <label key={e.key} className="assistant-campo">
          <span>{e.label}</span>
          <input
            type={e.tipo}
            step={e.paso}
            value={extras[e.key] ?? ""}
            onChange={(ev) => setExtras((prev) => ({ ...prev, [e.key]: ev.target.value }))}
          />
        </label>
      ))}

      <div className="assistant-columnas">
        <span className="assistant-columnas__titulo">Columnas de la hoja</span>
        <ul>
          {columns.map((c) => (
            <li key={c.id}>
              <label>
                <input type="checkbox" checked={seleccion.includes(c.id)} onChange={() => alternarColumna(c.id)} />
                <span>{c.name}</span>
                <small>{c.type === "numeric" ? "123" : c.type === "date" ? "fecha" : "texto"}</small>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {aviso && (
        <div className="assistant-aviso">
          <IconAlert size={14} />
          <span>{aviso}</span>
        </div>
      )}

      <button type="button" className="btn btn--primary" onClick={ejecutar} disabled={seleccion.length === 0}>
        Ejecutar
      </button>
    </aside>
  );
}
