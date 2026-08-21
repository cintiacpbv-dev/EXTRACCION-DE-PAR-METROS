# Detección de Parámetros

Aplicación web que lee Registros de Manufactura en PDF, **descubre por sí sola
los parámetros críticos** y los tabula para el análisis comparativo de validación
entre lotes.

No está atada a ningún producto ni a ninguna etapa: sirve igual para
FLUIBRONCOL, para otro producto, y para Fabricación, Envase, Acondicionado,
Recubrimiento, Inspección o cualquier etapa futura.

## Qué hace

- **Carga múltiple**: arrastra uno o varios PDF a la vez; detecta solo el
  producto, el lote y la etapa de cada documento.
- **Detección automática de parámetros**: encuentra etiqueta, setpoint, unidad y
  valor sin listas predefinidas (ver *Cómo funciona la detección*).
- **Tabla de validación**: `Parámetros | Setpoint | Lote 1 | Lote 2 … | Mínimo |
  Máximo | Promedio | Desv. Estándar`, agrupada por las secciones del propio
  documento.
- **Dos alcances de vista**: *Parámetros de proceso* (datos y verificaciones) o
  *Todo lo detectado* (incluye trazabilidad, firmas, códigos y horas).
- **Exportación a Excel**: una hoja por etapa, con las estadísticas escritas como
  fórmulas reales (`MIN`, `MAX`, `AVERAGE`, `STDEV`) para que recalculen solas.
- **Macro de formato**: deja el exportado idéntico a la sábana de validación.
- **Copiar tabla**: al portapapeles en formato TSV, para pegar directo en Excel.
- **Persistencia**: en el navegador siempre, y en Supabase si está configurado.

## Puesta en marcha

```bash
npm install
npm run dev
```

Abre http://localhost:5173

## Supabase

Las credenciales van en `.env` (ver `.env.example`):

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-public-key
```

En el **SQL Editor** del proyecto:

- Instalación nueva → ejecuta [`supabase_schema.sql`](./supabase_schema.sql)
- Si ya tenías la versión anterior → ejecuta
  [`supabase_migration_v2.sql`](./supabase_migration_v2.sql)

Sin Supabase configurado la app funciona igual, guardando en el `localStorage`.

## Macro de formato para Excel

El botón **Macro de formato** de la app explica el proceso y descarga
`FormatoValidacion.bas`. En resumen:

1. Exporta la tabla a Excel y abre el archivo.
2. `Alt + F11` → Archivo → Importar archivo… → elige el `.bas`.
3. `Alt + F8` → `FormatearTablasValidacion` → Ejecutar.

Aplica a todas las hojas: Arial 8 (cabecera 7.5 negrita), bordes finos, cabecera
gris, filas de sección sombreadas, columnas de estadística en verde, vistos
buenos en Wingdings, anchos de columna y paneles inmovilizados.

Las constantes del inicio del módulo (`FUENTE`, `TAM_DATOS`, `ANCHO_PARAMETRO`,
`FORMATO_ESTADIS`…) permiten ajustar el resultado sin tocar el resto del código.

## Cómo funciona la detección

El detector no usa un catálogo de parámetros: aprovecha cómo está maquetado el
formulario. Una lectura registrada siempre aparece como dos bloques separados
por un relleno ancho de espacios, que el PDF emite como un fragmento propio:

```
"TEMPERATURA (15 °C - 25 °C):"   "                    "   "21.5"
 └────────── etiqueta ────────┘   └── relleno ancho ──┘   └valor┘
```

Una instrucción del procedimiento, en cambio, es texto corrido: sus espacios
miden lo mismo que una letra. Medir ese relleno separa los datos del texto
narrativo con mucha más fiabilidad que cualquier lista de palabras clave, y
funciona igual para cualquier producto.

Sobre esa base el detector además:

- Toma como **sección** los títulos numerados del documento (`4.4.-FABRICACION`,
  `4.5.-RENDIMIENTO`).
- Separa el **setpoint** del nombre cuando va entre paréntesis
  (`(15 °C - 25 °C)`) o pegado al valor (`NO MAS DE 1%   0.33 %`), y descarta
  códigos de material y fórmulas de paso.
- Reconoce la **unidad** cuando el paréntesis sólo contiene una (`(kg)`).
- Usa los encabezados tipo `FRACCION N° 2:` para **calificar** las lecturas que
  vienen debajo, de modo que cada repetición queda identificada.
- Numera como `— Lectura N` lo que se repite sin calificador (controles cada 15
  minutos, muestreos sucesivos).
- Marca los campos de conformidad vacíos como **ü**, igual que la sábana.
- Clasifica cada hallazgo en `critico`, `verificacion`, `otros` o `trazabilidad`
  para poder filtrar la vista.

## Estructura

```
src/
  lib/
    pdfText.js            Extracción de texto con coordenadas (pdfjs-dist)
    parsers/
      index.js              Orquesta el procesado de un PDF
      meta.js               Cabecera: producto, lote, etapa, orden, fechas
      genericParser.js      Detector genérico de parámetros
      utils.js              Normalización de texto
    model.js              Une los documentos en la tabla maestra
    stats.js              Mínimo / Máximo / Promedio / Desv. estándar
    exportExcel.js        Libro .xlsx y texto TSV
    macro.js              Generador de la macro VBA
    storage.js            Persistencia local y en Supabase
    supabaseClient.js     Cliente (o null si no hay credenciales)
  components/
    UploadZone.jsx        Zona de carga
    ParamTable.jsx        Tabla de validación
    DocumentChips.jsx     Documentos cargados
    MacroPanel.jsx        Instrucciones y descarga de la macro
    Icons.jsx             Iconografía de trazo
  App.jsx                 Orquestación e interfaz
```

## Ajustar la detección

Casi todo el comportamiento se controla con las constantes del inicio de
`src/lib/parsers/genericParser.js`:

| Constante | Para qué sirve |
|---|---|
| `COLUMN_FILL` | Anchura mínima del relleno que marca el salto de columna. Bájala si un formulario usa columnas más juntas. |
| `MAX_LABEL_WORDS` | Longitud máxima de una etiqueta antes de considerarla instrucción. |
| `PROCESS_KEYWORDS` | Palabras que hacen que un dato cuente como parámetro de proceso. |
| `TRACE_LABEL_RE` | Etiquetas que son trazabilidad documental. |
| `UNIT_ONLY_RE` | Paréntesis que son unidad y no setpoint. |
| `QUALIFIER_RE` | Encabezados que agrupan lecturas (`FRACCION N° 2:`). |

## Próximos pasos

- Edición manual de un valor mal detectado desde la propia tabla.
- Gráficos de control por parámetro a lo largo de los lotes.
- Autenticación de usuarios en Supabase (hoy las políticas RLS son abiertas).
