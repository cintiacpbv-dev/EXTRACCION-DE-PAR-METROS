# Descarga por lotes desde SAP Fiori

Baja de una vez todos los RMD y órdenes de una lista de lotes, en lugar de
descargarlos uno a uno. Es el paso previo al análisis: cuando termina, se
arrastra la carpeta `descargas` a la aplicación.

Corre **en tu computadora** y usa **tu propia sesión** de SAP.

## Por qué no está dentro de la página web

SAP GUI para HTML sí está en internet público (no en una red interna), pero
la aplicación es una página estática servida desde otro dominio, y SAP envía
la cabecera `X-Frame-Options` justamente para impedir que otro sitio lo meta
en un iframe; aunque cargara, la política de mismo origen del navegador
impide leer o pulsar nada dentro de ese marco desde afuera. Por eso la
automatización no puede vivir dentro de la página de la app — pero sí puede
correr dentro de la propia pestaña de SAP, ver [`descargar-navegador.js`](#sin-instalar-nada-desde-cualquier-pc-o-celular) más abajo.

## Tus credenciales no se guardan en ninguna parte

El script no pide usuario ni contraseña. Abre un Chrome con un perfil propio
(la carpeta `.perfil-sap`), tú inicias sesión a mano la primera vez —con SSO
o segundo factor si los hay— y esa sesión queda en esa carpeta, que está
excluida del repositorio. Nada viaja a Supabase ni a ningún servidor.

## Sin instalar nada, desde cualquier PC o celular

[`descargar-navegador.js`](descargar-navegador.js) hace lo mismo que
`APLICACION.bat` para un solo lote, pero pegado directamente en la consola
del navegador (F12 → pestaña *Console*) mientras estás en la pantalla del
Reporte Sobre de Lote Digital, ya logueada. No instala Node ni Playwright ni
abre otro Chrome: usa la misma pestaña y la misma sesión que ya tienes
abierta, así que funciona en cualquier PC sin permisos de administrador, y
también en el navegador del celular (en Android, con uno que permita
consola/extensiones, como Kiwi Browser).

Admite varios lotes de una vez: el cuadro de diálogo acepta una lista, uno
por línea (o separados por coma o espacio), y los procesa uno detrás de
otro sin volver a preguntar.

Organiza los archivos igual que `APLICACION.bat` — carpeta por producto,
etapa y tipo de documento (`PRODUCTO/ETAPA/OP/lote_ETAPA_OP.pdf`). Al
arrancar aparece un botón ("Elegir dónde guardar los PDF"): pulsa ahí y
elige la carpeta destino (puede ser la misma `descargas` de siempre) — el
script escribe las subcarpetas directamente ahí, con permiso del propio
navegador. Sólo funciona en Chrome y Edge; en otros navegadores, o si
cancelas ese cuadro, los PDF caen sueltos en Descargas sin organizar.

También puede guardarse como marcador (bookmarklet) pegando el código con
prefijo `javascript:` en la URL de un marcador nuevo, para lanzarlo con un
clic en vez de abrir la consola cada vez.

La diferencia técnica con la versión de escritorio: en vez de leer el PDF de
la respuesta de red (algo que sólo Playwright puede interceptar), toma la
dirección del visor que SAP abre al pulsar el icono y la vuelve a pedir con
`fetch` usando tu misma sesión — el archivo sale igual de completo.

Es la opción a usar cuando no tienes tu computadora habitual a mano; para
descargar muchos lotes de una sentada en tu propia PC sigue siendo más
cómodo `APLICACION.bat`, que hace listas completas sin repetir el paso a
mano por cada uno.

## Cómo se usa

Doble clic en **`APLICACION.bat`**. Se abre una ventana en el navegador
donde se pegan los lotes y se pulsa **Descargar**.

La primera vez instala sola lo que necesita (tarda unos minutos) y pide la
dirección de SAP; si falta Node.js, dice de dónde bajarlo. Después abre SAP
en una ventana aparte: si pide credenciales, se inicia sesión ahí y queda
guardada para las siguientes veces.

Mientras se usa hay que dejar abierta la ventana negra, que es la que
sostiene la aplicación.

### Qué muestra

Una fila por documento, con el lote, el producto, la etapa y si es OP o RMD:

- **Descargado** — el PDF quedó guardado.
- **No está en SAP** — ese documento no está cargado. Es un dato, no un
  fallo: se detecta porque la celda del reporte viene sin icono, y se anota
  sin llegar a pulsarla.
- **Error** — algo salió mal; el motivo aparece al lado.

### Dónde quedan los archivos

Ordenados por producto, etapa y tipo de documento:

```
descargas/
  FLUIBRONCOL ORAL 600mg GRN 3g CJA x20/
    ACONDICIONADO/
      OP/   2058856_ACONDICIONADO_OP.pdf
      RMD/  2058856_ACONDICIONADO_RMD.pdf
  FLUIBRONCOL ORAL 600mg GRN SAC3g/
    ENVASE/
      RMD/  2058856_ENVASE_RMD.pdf
```

El botón **Abrir la carpeta** lleva directamente ahí.

### Los otros archivos

Siguen estando, para casos sueltos y para diagnóstico:

| Archivo | Cuándo |
|---|---|
| `1-APRENDER.bat` | Enseñarle cómo se descarga en un SAP distinto |
| `0-EXPLORAR.bat` | Ver la estructura de una pantalla que no encaje |
| `2-DESCARGAR.bat` | La versión de consola, con `lotes.txt` |

## Paso 1 — enseñarle cómo se descarga

Cada instalación de SAP coloca sus aplicaciones y botones en sitios
distintos, así que el script no adivina el camino: te mira hacerlo una vez.

Doble clic en **`1-APRENDER.bat`**. Se abre SAP, inicias sesión, le dices qué
lote vas a usar y **descargas ese lote a mano, como siempre**. El script
observa qué dirección se utilizó, sustituye el lote por un hueco y guarda el
patrón.

Si la dirección no contiene el lote, te lo dice y hay que pasar al modo
guiado, más abajo.

## Cómo recorre el Reporte Sobre de Lote Digital

Para cada lote:

0. Abre el reporte. Primero por su dirección directa; si con ella no aparece
   —porque el enlace lleve a la página de inicio— busca el azulejo
   **«Reporte Sobre de Lote Digital»** por su nombre y lo pulsa, para que no
   haya que entrar a mano.
1. Rellena **N° de Lote** y pulsa **Consulta**.
2. Lee la rejilla de resultados, que numera sus celdas como
   `grid#C102#fila,columna` — la fila 0 es la cabecera y cada fila siguiente
   una etapa del lote.
3. Averigua en qué columna están **Producción-OP** y **Producción-RMD**
   leyendo la cabecera, en vez de fijar el número: así sigue valiendo si
   cambia el orden de las columnas.
4. Abre el icono de cada etapa y guarda el PDF.

El PDF no se saca del visor incrustado sino de la propia respuesta de red:
al pulsar el icono SAP lo sirve como `application/pdf`, y leerlo de ahí evita
depender de los botones del visor.

Salen seis archivos por lote, con el nombre de la etapa:

```
2058836_ACONDICIONADO-ACON_OP.pdf
2058836_ACONDICIONADO-ACON_RMD.pdf
2058836_ACONDICIONADO-ENVS_OP.pdf
2058836_ACONDICIONADO-ENVS_RMD.pdf
2058836_SOLIDOS-FABR_OP.pdf
2058836_SOLIDOS-FABR_RMD.pdf
```

Los campos se localizan por su etiqueta visible (`Número de lote`,
`Ejecutar <objeto>`) y no por el identificador generado (`M0:46:::3:64`),
que cambia entre pantallas. Si aun así no encaja, en `config.json` se puede
poner `"reporteLote": { "activo": false }` para volver a los otros modos.

## Cuando el PDF no tiene dirección propia

Pasa cuando el launchpad abre una transacción clásica de SAP GUI dibujada en
el navegador (`/bc/gui/sap/its/webgui/`, con `sap-ui-tech-hint=GUI` en la
dirección). Ahí el PDF se genera al vuelo en un sitio temporal ligado a la
sesión, con un código distinto cada vez y sin el lote por ninguna parte: no
hay URL que construir, así que hay que manejar la transacción igual que una
persona.

Para eso hace falta saber cómo se llaman los campos y botones por dentro, y
en WebGUI no se pueden adivinar: son identificadores generados
(`M0:46:::0:`) que además cambian de una pantalla a otra.

Doble clic en **`0-EXPLORAR.bat`**: abre SAP con tu sesión ya iniciada, tú
dejas en pantalla la tabla de resultados, y el script escribe en
`diagnostico.txt` qué campos, botones y columnas hay y cómo referirse a
ellos. Ese archivo es el que permite escribir los pasos.

Sólo recoge estructura —nombres de campos, botones y encabezados de
columna—, no el contenido de la tabla.

Existe también `node descargar.mjs grabar`, que abre el Inspector de
Playwright y va escribiendo el código de cada clic. Reutiliza la sesión del
paso 1 a propósito: grabar desde una ventana limpia obligaría a teclear la
contraseña y el Inspector la dejaría en texto plano dentro del código.

Los pasos quedan así en `config.json` — `{LOTE}` se sustituye en cada vuelta:

```json
"guiado": {
  "esperaMs": 60000,
  "pasos": [
    { "accion": "ir", "url": "https://TU-SAP/sap/bc/ui2/flp#LA-TRANSACCION" },
    { "accion": "escribir", "marco": "iframe#application", "selector": "input[title='Lote']", "texto": "{LOTE}" },
    { "accion": "pulsar", "tecla": "Enter" },
    { "accion": "clic", "marco": "iframe#application", "selector": "text=Imprimir" }
  ]
}
```

`marco` sirve para los campos que viven dentro del iframe del launchpad, que
es lo habitual en WebGUI.

## Paso 2 — descargar todos los lotes

Abre `lotes.txt` con el Bloc de notas (se crea sola a partir de `lotes.ejemplo.txt`), escribe **un lote por línea**, guarda,
y doble clic en **`2-DESCARGAR.bat`**.

Los PDF quedan en la carpeta `descargas`. Al terminar imprime un resumen:
cuántos bajaron, cuáles no devolvieron un PDF y cuáles dieron error. Después
arrastras esa carpeta a la aplicación.

## Si algo falla

| Lo que ves | Qué suele significar |
|---|---|
| `la respuesta no es un PDF` | La sesión caducó, o ese lote no existe en SAP. Vuelve a ejecutar y comprueba que entras bien. |
| `HTTP 401` o `403` | La sesión ya no vale: borra la carpeta `.perfil-sap` y vuelve a iniciar sesión. |
| `HTTP 404` | El patrón aprendido no encaja con ese lote. Vuelve a ejecutar `npm run aprender`. |
| No detecta ningún PDF al aprender | SAP puede abrirlo en una ventana aparte. Cuéntame cómo se comporta. |

## Sobre trazabilidad

Descargar así no altera los documentos: se bajan los mismos PDF firmados que
obtendrías a mano, con tu usuario y quedando en el registro de accesos de
SAP igual que siempre. Aun así, si esto va a formar parte de un expediente
de validación, conviene que Aseguramiento de Calidad conozca el método antes
de usarlo en un informe.
