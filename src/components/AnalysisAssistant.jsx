import { useState } from "react";
import { useWorkbookStore } from "../lib/estadistica/store.js";
import { estadisticaDescriptiva } from "../lib/estadistica/descriptiva.js";
import { opcionBoxplot, opcionDispersion, opcionHistograma } from "../lib/estadistica/graficos.js";
import { IconAlert, IconFlask } from "./Icons.jsx";

const ACCIONES = [
  { id: "descriptiva", nombre: "Estadística descriptiva", minColumnas: 1, maxColumnas: null, ayuda: "Elige una o más columnas numéricas." },
  { id: "histograma", nombre: "Histograma", minColumnas: 1, maxColumnas: 1, ayuda: "Elige una columna numérica." },
  { id: "boxplot", nombre: "Diagrama de caja", minColumnas: 1, maxColumnas: null, ayuda: "Elige una o más columnas numéricas, para compararlas lado a lado." },
  { id: "dispersion", nombre: "Diagrama de dispersión", minColumnas: 2, maxColumnas: 3, ayuda: "Elige X e Y (numéricas); una tercera columna de texto es opcional, para colorear por grupo." },
];

function formatearNumero(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n.toFixed(4)).toLocaleString("es-PE", { maximumFractionDigits: 4 });
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

export default function AnalysisAssistant() {
  const columns = useWorkbookStore((s) => s.columns);
  const registrarResultado = useWorkbookStore((s) => s.registrarResultado);
  const agregarGrafico = useWorkbookStore((s) => s.agregarGrafico);
  const [accionId, setAccionId] = useState(ACCIONES[0].id);
  const [seleccion, setSeleccion] = useState([]);
  const [aviso, setAviso] = useState("");

  const accion = ACCIONES.find((a) => a.id === accionId);
  const columnasSeleccionadas = columns.filter((c) => seleccion.includes(c.id));

  function alternarColumna(id) {
    setAviso("");
    setSeleccion((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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
        <select
          value={accionId}
          onChange={(e) => {
            setAccionId(e.target.value);
            setAviso("");
          }}
        >
          {ACCIONES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
      </label>
      <p className="assistant-ayuda">{accion.ayuda}</p>

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
