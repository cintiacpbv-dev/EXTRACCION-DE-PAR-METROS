// Sacar de aquí el trabajo hecho: un gráfico suelto, una tabla suelta, o
// todo el análisis en un solo documento.
//
// El destino real de esto es un protocolo de validación en Word, no la
// pantalla: por eso el informe completo sale en .docx con los gráficos ya
// puestos como imagen, y no como un montón de archivos que después haya que
// ir pegando uno a uno.

import * as echarts from "echarts";
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

// Tamaño con el que se dibuja un gráfico para exportarlo, en píxeles de
// dibujo. No es el del panel a propósito: exportado desde una ventana
// estrecha saldría estrecho, y lo que se pega en un protocolo tiene que
// verse igual de bien lo tuviera quien lo generó a pantalla completa o en
// media pantalla.
const ANCHO_EXPORT = 1000;
const ALTO_EXPORT = 560;

const FUENTE = "Arial";
const TAM = 18; // 9 pt, en medios puntos — el mismo cuerpo que los demás formatos
const A4_ANCHO = 11906;
const A4_ALTO = 16838;
const MARGEN = 850;

/**
 * Nombre de archivo seguro a partir de un título escrito a mano.
 *
 * Las tildes y la eñe se quitan, no por gusto: comprobado en el navegador, un
 * nombre con acentos hace que Chrome descarte el nombre entero y guarde el
 * archivo como "download", sin extensión ni pista de qué es. Además, un
 * nombre sin acentos viaja mejor entre Windows, el correo y las carpetas
 * compartidas.
 */
function nombreArchivo(texto, extension) {
  const base = String(texto || "analisis")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .replace(/[^\w\s.-]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 60);
  return `${base || "analisis"}.${extension}`;
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** De "data:image/png;base64,AAA…" a los bytes que espera docx. */
function bytesDeDataUrl(dataUrl) {
  const base64 = String(dataUrl).split(",")[1] || "";
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// --- un gráfico suelto ------------------------------------------------------

/**
 * Dibuja un gráfico fuera de la pantalla y devuelve su PNG.
 *
 * Se dibuja aparte en vez de fotografiar el que se está viendo por dos
 * razones: sale siempre al mismo tamaño (ver ANCHO_EXPORT) y, sobre todo,
 * permite exportar gráficos que ahora mismo no están abiertos —el informe
 * completo los lleva todos, y nadie debería tener que abrirlos uno por uno
 * antes de exportar—.
 *
 * El contenedor tiene que estar en el documento para que ECharts sepa qué
 * tamaño tiene; se esconde fuera de la vista y se retira siempre, incluso si
 * el dibujo falla.
 */
export function pngDeGrafico(opciones, titulo) {
  const caja = document.createElement("div");
  caja.style.cssText = `position:fixed;left:-10000px;top:0;width:${ANCHO_EXPORT}px;height:${ALTO_EXPORT}px;background:#fff`;
  document.body.appendChild(caja);

  let instancia = null;
  try {
    instancia = echarts.init(caja, null, { renderer: "canvas", width: ANCHO_EXPORT, height: ALTO_EXPORT });
    // El título va en la imagen: un gráfico exportado sin título no se sabe
    // de qué es en cuanto sale de aquí.
    const conTitulo = Array.isArray(opciones.title)
      ? { ...opciones, title: opciones.title.map((t, i) => (i === 0 ? { ...t, text: titulo } : t)) }
      : { ...opciones, title: { ...opciones.title, text: titulo, left: "center", top: 8 } };

    // Sin animación, y esto NO es un detalle de estilo: ECharts dibuja las
    // barras creciendo desde cero y los ejes interpolando su escala. La foto
    // se toma justo después de pedir el dibujo, así que con animación salía
    // el primer fotograma —barras de altura cero sobre unos ejes a medio
    // ajustar—, es decir, un gráfico vacío con números que no eran los suyos.
    instancia.setOption({ ...conTitulo, animation: false }, true);
    return instancia.getDataURL({ pixelRatio: 2, backgroundColor: "#ffffff" });
  } catch {
    return null;
  } finally {
    instancia?.dispose();
    caja.remove();
  }
}

/** Descarga un gráfico como PNG, listo para pegar en un informe. */
export function descargarGraficoPng(opciones, titulo) {
  const dataUrl = pngDeGrafico(opciones, titulo);
  if (!dataUrl) return false;
  descargar(new Blob([bytesDeDataUrl(dataUrl)], { type: "image/png" }), nombreArchivo(titulo, "png"));
  return true;
}

// --- una tabla suelta -------------------------------------------------------

function aCsv(contenido) {
  const escapar = (v) => {
    const t = v == null ? "" : String(v);
    return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lineas = [
    contenido.encabezados.map(escapar).join(";"),
    ...contenido.filas.map((f) => f.map(escapar).join(";")),
  ];
  // Con BOM: sin él, Excel en Windows abre los acentos rotos.
  return `﻿${lineas.join("\r\n")}`;
}

/** Descarga una tabla de resultados como CSV, para seguir trabajándola. */
export function descargarTablaCsv(resultado) {
  const csv = aCsv(resultado.contenido);
  descargar(new Blob([csv], { type: "text/csv;charset=utf-8" }), nombreArchivo(resultado.titulo, "csv"));
}

/** El texto que se copia al portapapeles: separado por tabulaciones, que es
 *  lo que Excel entiende al pegar. */
export function tablaComoTexto(resultado) {
  const { encabezados, filas } = resultado.contenido;
  return [encabezados.join("\t"), ...filas.map((f) => f.join("\t"))].join("\n");
}

// --- todo el análisis, en un documento --------------------------------------

function parrafo(texto, opciones = {}) {
  return new Paragraph({
    children: [new TextRun({ text: texto, ...opciones.run })],
    ...opciones.parrafo,
  });
}

function tablaDocx(contenido) {
  const celda = (texto, encabezado) =>
    new TableCell({
      children: [
        new Paragraph({
          children: [new TextRun({ text: String(texto ?? ""), bold: encabezado, size: TAM })],
          alignment: encabezado ? AlignmentType.CENTER : AlignmentType.LEFT,
        }),
      ],
      shading: encabezado ? { fill: "EEEEEE" } : undefined,
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: contenido.encabezados.map((h) => celda(h, true)), tableHeader: true }),
      ...contenido.filas.map((f) => new TableRow({ children: f.map((v) => celda(v, false)) })),
    ],
  });
}

/**
 * Arma el informe con todo lo que hay en la sesión, en el orden en que se
 * generó — que es el orden en que se razonó el análisis, y por eso el que
 * tiene sentido leer después.
 *
 * Cada gráfico se vuelve a dibujar aquí mismo para meterlo como imagen, así
 * que entran todos, se hayan abierto en el visor o no.
 */
export async function exportarInformeWord({ resultados, graficos, titulo = "Análisis estadístico" }) {
  const items = [
    ...resultados.map((r) => ({ ...r, tipo: "resultado" })),
    ...graficos.map((g) => ({ ...g, tipo: "grafico" })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  const children = [
    new Paragraph({
      children: [new TextRun({ text: titulo, bold: true, size: 32 })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
    parrafo(`Generado el ${new Date().toLocaleString("es-PE")} · ${items.length} elementos`, {
      run: { size: 16, color: "666666" },
      parrafo: { spacing: { after: 240 } },
    }),
  ];

  for (const item of items) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: item.titulo, bold: true, size: 24 })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      })
    );

    if (item.tipo === "resultado") {
      for (const aviso of item.advertencias || []) {
        children.push(parrafo(`Nota: ${aviso}`, { run: { italics: true, size: 16 }, parrafo: { spacing: { after: 80 } } }));
      }
      children.push(tablaDocx(item.contenido));
      children.push(new Paragraph({ children: [], spacing: { after: 120 } }));
      continue;
    }

    const dataUrl = pngDeGrafico(item.opciones, item.titulo);
    if (!dataUrl) {
      children.push(
        parrafo("(Este gráfico no se pudo dibujar para el informe.)", {
          run: { italics: true, size: 16, color: "996600" },
        })
      );
      continue;
    }

    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: bytesDeDataUrl(dataUrl),
            // Ancho útil de una A4 con estos márgenes, y alto en la misma
            // proporción con la que se dibujó: deformar un gráfico cambia lo
            // que dice su pendiente.
            transformation: { width: 600, height: 340 },
            type: "png",
          }),
        ],
        alignment: AlignmentType.CENTER,
      })
    );
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: FUENTE, size: TAM } } } },
    sections: [
      {
        properties: {
          page: {
            margin: { top: MARGEN, bottom: MARGEN, left: MARGEN, right: MARGEN },
            size: { width: A4_ANCHO, height: A4_ALTO },
          },
        },
        children,
      },
    ],
  });

  descargar(await Packer.toBlob(doc), nombreArchivo(titulo, "docx"));
  return items.length;
}
