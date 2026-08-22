# Descarga por lotes desde SAP Fiori

Baja de una vez todos los RMD y órdenes de una lista de lotes, en lugar de
descargarlos uno a uno. Es el paso previo al análisis: cuando termina, se
arrastra la carpeta `descargas` a la aplicación.

Corre **en tu computadora** y usa **tu propia sesión** de SAP.

## Por qué no está dentro de la página web

La aplicación es una página estática y SAP está en la red interna de la
empresa, así que la página no puede alcanzarlo. Tampoco puede incrustarlo:
SAP envía la cabecera `X-Frame-Options` justamente para impedir que otro
sitio lo meta en un iframe, y aunque cargara, la política de mismo origen
del navegador impide leer o pulsar nada dentro de ese marco. Por eso la
automatización tiene que ejecutarse aquí, fuera del navegador de la app.

## Tus credenciales no se guardan en ninguna parte

El script no pide usuario ni contraseña. Abre un Chrome con un perfil propio
(la carpeta `.perfil-sap`), tú inicias sesión a mano la primera vez —con SSO
o segundo factor si los hay— y esa sesión queda en esa carpeta, que está
excluida del repositorio. Nada viaja a Supabase ni a ningún servidor.

## Cómo se usa

No hay que escribir comandos: son dos archivos que se abren con **doble
clic**, en esta carpeta.

| Archivo | Cuándo |
|---|---|
| `1-APRENDER.bat` | Una sola vez, para enseñarle cómo se descarga en tu SAP |
| `0-EXPLORAR.bat` | Sólo si el paso 1 dice que la dirección no lleva el lote |
| `2-DESCARGAR.bat` | Cada vez que quieras bajar una tanda de lotes |

La primera vez, `1-APRENDER.bat` instala solo lo que necesita (tarda unos
minutos) y te pide la dirección de SAP. Si no tienes Node.js, te lo dice y
te indica de dónde bajarlo.

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

Es el modo por defecto. Para cada lote de `lotes.txt`:

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

Abre `lotes.txt` con el Bloc de notas, escribe **un lote por línea**, guarda,
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
