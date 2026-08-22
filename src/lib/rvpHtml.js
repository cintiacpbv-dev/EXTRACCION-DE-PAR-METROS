// Versión HTML del informe RVP, pensada para el portapapeles: al pegar en
// Word, las tablas llegan como tablas reales (no como texto separado por
// tabulaciones), conservando encabezados, secciones y bordes.

import { buildRvpModel } from "./rvpData.js";

const ESTILO_TABLA =
  'border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:8pt;margin-bottom:12pt;';
const TD = 'border:0.5pt solid #000;padding:3px 5px;vertical-align:top;';
const TH = TD + 'background:#D9D9D9;font-weight:bold;text-align:center;';
const TH_LOTE = TD + 'background:#CCFFCC;font-weight:bold;text-align:center;';
const TR_SECCION = TD + 'background:#E7E6E6;font-weight:bold;';

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tablaLotes(model) {
  const { stages, filas } = model.lotes;
  const h = [];

  h.push(`<table style="${ESTILO_TABLA}"><thead>`);
  h.push(
    `<tr><th style="${TH}" rowspan="2">N°</th><th style="${TH}" rowspan="2">PRODUCTO</th><th style="${TH}" rowspan="2">LOTE</th>` +
      stages.map((s) => `<th style="${TH}" colspan="2">${esc(s)}</th>`).join("") +
      `</tr>`
  );
  h.push(
    `<tr>` +
      stages.map(() => `<th style="${TH}">FECHA DE INICIO</th><th style="${TH}">FECHA DE TERMINO</th>`).join("") +
      `</tr></thead><tbody>`
  );

  filas.forEach((fila, i) => {
    h.push(
      `<tr><td style="${TD}text-align:center">${i + 1}</td><td style="${TD}">${esc(fila.producto)}</td>` +
        `<td style="${TD}text-align:center">${esc(fila.lote)}</td>` +
        stages
          .map((s) => {
            const f = fila.etapas[s] || {};
            return `<td style="${TD}text-align:center">${esc(f.inicio || "—")}</td><td style="${TD}text-align:center">${esc(f.fin || "—")}</td>`;
          })
          .join("") +
        `</tr>`
    );
  });

  h.push("</tbody></table>");
  return h.join("");
}

function tablaMateriales(model) {
  const cabecera = ["Nombre", "Código", "Lote", "Cantidad registrada", "Proveedor", "Fecha de vencimiento"];
  const h = [`<table style="${ESTILO_TABLA}"><thead><tr>`];
  h.push(cabecera.map((c) => `<th style="${TH}">${esc(c)}</th>`).join(""));
  h.push("</tr></thead><tbody>");

  for (const m of model.materiales) {
    h.push(
      `<tr><td style="${TD}">${esc(m.nombre)}</td><td style="${TD}text-align:center">${esc(m.codigo)}</td>` +
        `<td style="${TD}text-align:center">${esc(m.lote)}</td><td style="${TD}text-align:center">${esc(m.cantidad)}</td>` +
        `<td style="${TD}"></td><td style="${TD}"></td></tr>`
    );
  }

  h.push("</tbody></table>");
  return h.join("");
}

function tablaPersonal(entrada) {
  return (
    `<table style="${ESTILO_TABLA}"><tbody>` +
    `<tr><th style="${TH}" colspan="2">LOTES – ${esc(entrada.stage)}</th></tr>` +
    `<tr><td style="${TD}width:25%"><b>Lotes</b></td><td style="${TD}">${esc(entrada.lotes.join(" · "))}</td></tr>` +
    `<tr><td style="${TR_SECCION}" colspan="2">FUNCIÓN: OPERADOR</td></tr>` +
    `<tr><td style="${TD}"><b>Realizado por</b></td><td style="${TD}">${esc(entrada.operarios.map((p) => p.name).join(" / ") || "—")}</td></tr>` +
    `<tr><td style="${TR_SECCION}" colspan="2">FUNCIÓN: SUPERVISOR</td></tr>` +
    `<tr><td style="${TD}"><b>V°B°</b></td><td style="${TD}">${esc(entrada.supervisores.map((p) => p.name).join(" / ") || "—")}</td></tr>` +
    `</tbody></table>`
  );
}

function tablaParametros(table) {
  const nCols = 2 + table.lotes.length;
  const h = [`<table style="${ESTILO_TABLA}"><thead><tr>`];
  h.push(`<th style="${TH}">Parámetros de proceso</th><th style="${TH}">Rango de operación</th>`);
  h.push(table.lotes.map((l) => `<th style="${TH_LOTE}">${esc(l)}</th>`).join(""));
  h.push("</tr></thead><tbody>");

  for (const section of table.sections) {
    h.push(`<tr><td style="${TR_SECCION}" colspan="${nCols}">${esc(section.title)}</td></tr>`);
    for (const row of section.rows) {
      const etiqueta = row.unit && !row.label.includes(row.unit) ? `${row.label} (${row.unit})` : row.label;
      h.push(
        `<tr><td style="${TD}">${esc(etiqueta)}</td><td style="${TD}text-align:center">${esc(row.setpoint || "Referencial")}</td>` +
          table.lotes
            .map((lote) => {
              const v = row.values[lote];
              const txt = v === undefined || v === null || v === "" ? "—" : v === "ü" ? "Conforme" : v;
              return `<td style="${TD}text-align:center">${esc(txt)}</td>`;
            })
            .join("") +
          `</tr>`
      );
    }
  }

  h.push("</tbody></table>");
  return h.join("");
}

/** Informe completo en HTML, listo para pegar en Word. */
export function rvpToHtml(documents, familia, options) {
  const model = buildRvpModel(documents, familia, options);
  const hoy = new Date().toISOString().slice(0, 10);
  const h = [`<div style="font-family:Arial,sans-serif;font-size:10pt">`];

  h.push(`<h1 style="font-size:14pt">REPORTE DE VALIDACIÓN DE PROCESO — ${esc(familia)}</h1>`);
  h.push(`<p style="font-size:8pt">Generado el ${hoy} a partir de los registros de manufactura</p>`);

  h.push(`<h2 style="font-size:11pt">1. RECOLECCIÓN DE DATOS DEL PROCESO</h2>`);
  h.push(`<h3 style="font-size:10pt">1.1 Lotes controlados y fechas de proceso</h3>`);
  h.push(tablaLotes(model));

  h.push(`<h3 style="font-size:10pt">1.2 Materiales utilizados en los lotes</h3>`);
  h.push(tablaMateriales(model));

  h.push(`<h3 style="font-size:10pt">1.3 Personal que intervino en el proceso</h3>`);
  for (const entrada of model.personal) h.push(tablaPersonal(entrada));

  h.push(`<h2 style="font-size:11pt">2. RESULTADOS DE LA VALIDACIÓN</h2>`);
  h.push(`<h3 style="font-size:10pt">2.1 Verificaciones de parámetros de proceso</h3>`);
  for (const table of model.tablas) {
    if (table.lotes.length === 0 || table.rowCount === 0) continue;
    h.push(`<h4 style="font-size:10pt">Etapa: ${esc(table.stage)}</h4>`);
    h.push(tablaParametros(table));
  }

  h.push("</div>");
  return h.join("");
}

/**
 * Copia el informe al portapapeles con formato. Se escriben las dos variantes
 * (HTML y texto plano) para que Word reciba tablas y un editor simple reciba
 * al menos el texto.
 */
export async function copyRvpToClipboard(documents, familia, options) {
  const html = rvpToHtml(documents, familia, options);
  const plano = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plano], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    // Navegadores sin ClipboardItem o sin permiso: se copia seleccionando un
    // contenedor oculto, que también conserva el formato al pegar en Word.
    try {
      const div = document.createElement("div");
      div.innerHTML = html;
      div.style.position = "fixed";
      div.style.left = "-9999px";
      document.body.appendChild(div);

      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      const ok = document.execCommand("copy");
      sel.removeAllRanges();
      document.body.removeChild(div);
      return ok;
    } catch {
      return false;
    }
  }
}
