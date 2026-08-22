# Detección de Parámetros

Aplicación web que lee **Registros de Manufactura** y **Órdenes de Producción**
en PDF, descubre por sí sola los parámetros críticos y los tabula para el
análisis comparativo de validación entre lotes.

No está atada a ningún producto ni a ninguna etapa: sirve igual para
FLUIBRONCOL, para otro producto, y para Fabricación, Envase, Acondicionado,
Recubrimiento, Inspección o cualquier etapa futura.

## Qué hace

- **Carga separada por tipo de documento**: una zona para los RMD (Registros
  de Manufactura) y otra para las Órdenes de Producción/Envase/Acondicionado.
  El tipo real se sigue detectando por el contenido, así que un archivo
  soltado en la zona equivocada no se pierde, sólo se avisa.
- **Detección automática de parámetros**: encuentra etiqueta, setpoint, unidad y
  valor sin listas predefinidas (ver *Cómo funciona la detección*).
- **Tabla de validación**: `Parámetros | Setpoint | Lote 1 | Lote 2 … | Mínimo |
  Máximo | Promedio | Desv. Estándar`, agrupada por las secciones del propio
  documento.
- **Dos alcances de vista**: *Parámetros de proceso* (datos y verificaciones) o
  *Todo lo detectado* (incluye trazabilidad, firmas, códigos y horas).
- **Exportación a Excel ya formateada**: una hoja por etapa, con las
  estadísticas como fórmulas reales (`MIN`, `MAX`, `AVERAGE`, `STDEV`) para que
  recalculen solas. El formato (Arial 8, cabecera gris, bordes, estadísticas en
  verde, vistos buenos en Wingdings) sale ya aplicado — no hace falta ninguna
  macro después.
- **Copiar tabla**: al portapapeles en formato TSV, para pegar directo en Excel.
- **Persistencia**: en el navegador siempre, y en Supabase si está configurado.

## Puesta en marcha

```bash
npm install
npm run dev
```

Abre http://localhost:5173

> `localhost` es siempre "esta misma computadora". Para abrir la aplicación
> desde otro equipo hay que publicarla — ver *Publicar en internet*.

## Publicar en internet

### Vercel / Netlify

Funciona sin configurar nada: se conecta el repositorio y cada cambio en `main`
se publica solo. Sólo hay que cargar las credenciales de Supabase como
*Environment Variables* del proyecto (`VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY`) y volver a desplegar para que tomen efecto.

> **No definir `VITE_BASE_PATH` aquí.** Estos servicios sirven el sitio desde
> la raíz del dominio; si se apunta a una subcarpeta, el navegador no encuentra
> los archivos y la página queda en blanco.

### GitHub Pages

El repositorio incluye un flujo que compila y publica el sitio solo, cada vez
que llega un cambio a `main` (`.github/workflows/deploy.yml`).

Configuración inicial, una sola vez:

1. **Activar Pages** — en el repositorio: *Settings → Pages → Build and
   deployment → Source:* **GitHub Actions**.
2. **Cargar las credenciales** — en *Settings → Secrets and variables →
   Actions → New repository secret*, crear dos secretos con exactamente
   estos nombres, copiando los valores de tu `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. **Publicar** — en la pestaña *Actions*, abrir "Publicar en GitHub Pages" y
   pulsar *Run workflow* (o empujar cualquier cambio a `main`).

La dirección queda en `https://<usuario>.github.io/EXTRACCION-DE-PAR-METROS/`

Sin el paso 2 el sitio se publica igual, pero **sin conexión a Supabase**: se
abre en modo "Guardado local" y la biblioteca aparece vacía, porque los datos
viven en la nube y no en el navegador.

> Las credenciales se inyectan al compilar y terminan dentro del JavaScript
> que descarga el navegador — es inevitable en una aplicación sin servidor
> propio. Mientras las políticas RLS estén abiertas, cualquiera que llegue al
> enlace puede leer y modificar los datos. Para restringirlo hace falta
> agregar autenticación de usuarios y cerrar las políticas.

## Supabase

Las credenciales van en `.env` (ver `.env.example`):

```
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-public-key
```

En el **SQL Editor** del proyecto:

- Instalación nueva → ejecuta [`supabase_schema.sql`](./supabase_schema.sql)
  y después las migraciones v2 a v7.
- Instalación existente → ejecuta las migraciones que falten, en orden:
  [`v2`](./supabase_migration_v2.sql) (parámetros genéricos),
  [`v3`](./supabase_migration_v3.sql) (participantes),
  [`v4`](./supabase_migration_v4.sql) (órdenes de producción),
  [`v5`](./supabase_migration_v5.sql) (receta del lote),
  [`v6`](./supabase_migration_v6.sql) (materiales de la sección INSUMOS) y
  [`v7`](./supabase_migration_v7.sql) (imagen de cada producto).

Sin Supabase configurado la app funciona igual, guardando en el `localStorage`.

## Los documentos que lee

| | RMD (Registro de Manufactura) | Orden de Producción |
|---|---|---|
| Parámetros de proceso | ✅ | — |
| Personal de planta (Realizado / VB) | ✅ | — |
| Materiales usados en la etapa (sección INSUMOS) | ✅ | — |
| Receta (código de producto, 10 dígitos) | ✅ | — |
| Lote de cada material (**Lote ME**) | — | ✅ |
| Consumos y mermas por insumo | — | ✅ |
| Rendimiento oficial | calculado en el registro | ✅ declarado |
| Fechas de proceso | deducidas | ✅ exactas |
| Firmas de almacén | — | ✅ |

Se complementan: para un mismo lote y etapa conviven como dos documentos
distintos, y ninguno reemplaza al otro. La lista de materiales (nombre y
cantidad) sale del RMD, que es el que de verdad declara lo usado en cada
etapa — cajas, etiquetas y folletos en Acondicionado; alupol, palupol y PVC en
Envase; materias primas y principios activos en Fabricación. La orden del
mismo lote y etapa se cruza por código de material sólo para aportar el
**Lote ME**; si para un lote y etapa no se cargó el RMD pero sí la orden, se
usa la lista de la orden para no perder esos insumos. Las fechas de proceso y
el rendimiento, en cambio, mandan desde la orden cuando está disponible.

La sección INSUMOS del RMD es una tabla de columnas reales (Descripción,
Código, Cantidad, UM, Cantidad recibida, UM, Bulto), no el patrón "etiqueta +
valor" que usa el detector genérico: la lee `parsers/insumos.js`, un lector
dedicado como el de la orden.

**Proveedor, fabricante y fecha de vencimiento** no están en ninguno de los
dos: quedan pendientes de un tercer tipo de documento, el **Certificado de
Insumo**, todavía no incorporado.

## Traer los lotes desde SAP, sin descargar nada a mano

El panel **Traer lotes desde SAP** de la propia página permite pegar una
lista de lotes, descargarlos y analizarlos sin tocar un solo archivo.

El trabajo lo hace [`herramientas/sap-descargas`](./herramientas/sap-descargas),
un programa que corre en tu computadora. **Tiene que ser así**: manejar un
Chrome de verdad, alcanzar la red interna de la empresa y usar tu sesión de
SAP son cosas fuera del alcance de cualquier sitio web. SAP además envía
`X-Frame-Options` para impedir que otra página lo incruste en un iframe.

Lo que sí se puede es conectarlos. El programa abre un servidor pequeño en
`localhost`, y la página le habla desde el navegador:

1. Se abre `APLICACION.bat` una vez (queda en segundo plano).
2. En la página aparece el panel ya conectado.
3. Se pegan los lotes → **Descargar de SAP** → **Analizar lo descargado**.

Los PDF quedan ordenados por producto, etapa y tipo (OP o RMD), y se avisa
cuando un documento no está cargado en SAP, que es un dato del proceso y no
un fallo.

> El servidor sólo escucha en `127.0.0.1` —no es accesible desde la red— y
> únicamente acepta peticiones desde `localhost` y desde los dominios donde
> vive esta aplicación. Aun así, conviene cerrar su ventana cuando no se
> esté usando.

## Imagen de cada producto

En la biblioteca, cada producto puede llevar su propia imagen en lugar del
icono genérico. El botón de imagen de la tarjeta ofrece tres vías:

1. **Subir una imagen del equipo** — la vía fiable: una foto o el arte de la
   caja.
2. **Buscar en internet** — consulta **Openverse** y **Wikimedia Commons**.
3. **Pegar el enlace** de una imagen.

Son las dos únicas fuentes que sirven aquí: no piden clave de API (una clave
dentro del JavaScript que descarga el navegador queda a la vista de
cualquiera y es facturable), permiten CORS, y devuelven material de licencia
reutilizable —lo correcto para un documento de validación—. La licencia de
cada resultado se muestra bajo la miniatura.

> **Ninguna indexa marcas comerciales de laboratorio**: buscar «FLUIBRONCOL»
> devuelve cero resultados. La búsqueda sirve para ilustrar por principio
> activo o forma farmacéutica; para la caja real del producto hay que subir
> la foto. La app propone términos alternativos a partir del nombre del
> registro (`CAP` → cápsulas, `GRN` → granulado…).

Venga de donde venga, la imagen se recorta en cuadrado a 256 px y se guarda
en PNG. Si el PNG supera los 60 kB —lo normal en una fotografía— se
recomprime en JPEG, que a este tamaño baja de 150 kB a unos 11 kB sin
diferencia apreciable. Se guarda en Supabase, así que se ve desde cualquier
computadora.

## Alcance del FORMATO A09: una etapa o todas

El botón **FORMATO A09** comparte un selector, "FORMATO A09: solo &lt;etapa&gt;"
/ "Todas las etapas" (visible cuando el producto tiene más de una etapa
cargada). Por defecto sale enfocado sólo a la etapa activa: si de un lote
únicamente se cargó Acondicionado, el documento no muestra columnas vacías de
Fabricación o Envase sólo porque otro lote de la misma familia sí las tenga.
"Todas las etapas" arma el documento combinado de siempre.

## FORMATO A09 con el formato del reporte de referencia

El botón **FORMATO A09** entrega en Word, con el formato exacto del reporte de
validación de referencia, los tres cuadros de recolección de datos:

1. Lotes controlados en la validación y fechas de proceso
2. Materiales utilizados en los lotes
3. Personal que intervino en el proceso

El formato no se aproxima: está tomado del XML del propio documento de
referencia — cabeceras en azul `C6D9F1`, Arial 8 pt, bordes de media línea,
celdas combinadas en vertical y horizontal, alturas de fila, alineaciones y
repetición de la cabecera al continuar en la página siguiente.

Se adapta a los datos: el cuadro 1 abre dos columnas por etapa, el 2 agrupa
los materiales por presentación combinando el nombre repetido, y el 3 arma una
tabla por cada bloque de 10 lotes, como hace el original con sus dos
presentaciones. Los nombres de operarios y supervisores se muestran en el
formato "A. Lacho" (inicial del nombre + apellido, sin la inicial final del
código del RMD) y, cuando hay más de uno por lote y rol, cada uno en su
propia línea dentro de la celda.

La columna **RECETA** se llena con el código de producto de 10 dígitos del
encabezado del RMD; **Lote ME** se cruza desde la orden de producción por
código de material. **Proveedor**, **Fabricante** y **Fecha de vencimiento**
quedan en blanco hasta incorporar el Certificado de Insumo (ver *Los
documentos que lee*).

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
      index.js              Orquesta el procesado de un PDF (registro u orden)
      meta.js                Cabecera del RMD: producto, lote, etapa, receta, fechas
      genericParser.js      Detector genérico de parámetros
      personnel.js           Operarios y supervisores (Realizado / VB)
      insumos.js              Tabla de materiales de la sección INSUMOS
      orden.js               Lector de Órdenes de Producción
      utils.js               Normalización de texto
    model.js              Une los documentos en la tabla maestra
    stats.js              Mínimo / Máximo / Promedio / Desv. estándar
    rvpData.js            Prepara lotes, materiales, receta y personal para los exports
    exportExcel.js        Libro .xlsx ya formateado (ExcelJS) y texto TSV
    exportCuadros.js      FORMATO A09 en Word, formato exacto del original
    personName.js         Nombre legible a partir del código del RMD ("A. Lacho")
    imageSearch.js         Búsqueda de imágenes (Openverse y Wikimedia Commons)
    productImage.js        Normaliza la imagen a PNG y la guarda
    sapLocal.js            Enlace con el ayudante de descargas de SAP
    dedupe.js              Huella de contenido para no procesar el mismo PDF dos veces
    productIdentity.js    Agrupa presentaciones de un mismo producto
    storage.js            Persistencia local y en Supabase
    supabaseClient.js     Cliente (o null si no hay credenciales)
  components/
    UploadZone.jsx         Zona de carga (una por tipo de documento)
    ParamTable.jsx         Tabla de validación
    LoadedBatches.jsx      Resumen de lotes cargados
    PersonnelPanel.jsx     Participantes de la etapa activa
    ProductLibrary.jsx     Pantalla de inicio con los productos guardados
    ProductImagePicker.jsx Elegir la imagen de un producto
    SapPanel.jsx           Traer lotes desde SAP sin salir de la página
    Icons.jsx              Iconografía de trazo
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

- **Certificado de Insumo**: tercer tipo de documento, todavía sin lector.
  Aportará Proveedor, Fabricante y Fecha de vencimiento de cada material del
  cuadro 2 del FORMATO A09, cruzado por Lote ME.
- Edición manual de un valor mal detectado desde la propia tabla.
- Gráficos de control por parámetro a lo largo de los lotes.
- Autenticación de usuarios en Supabase (hoy las políticas RLS son abiertas).
