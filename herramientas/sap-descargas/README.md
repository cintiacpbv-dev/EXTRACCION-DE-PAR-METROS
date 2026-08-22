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

## Puesta en marcha, una sola vez

```bash
npm install
npm run instalar-navegador
```

Después copia `config.ejemplo.json` a `config.json` y pon en `urlInicio` la
dirección desde la que entras a SAP.

## Paso 1 — enseñarle cómo se descarga

Cada instalación de SAP coloca sus aplicaciones y botones en sitios
distintos, así que el script no adivina el camino: te mira hacerlo una vez.

```bash
npm run aprender
```

Se abre SAP, inicias sesión, le dices qué lote vas a usar y **descargas ese
lote a mano, como siempre**. El script observa qué dirección se utilizó,
sustituye el lote por un hueco y guarda el patrón en `config.json`.

Si la dirección no contiene el lote, te lo dice: significa que SAP identifica
el documento por el estado de la sesión y no por la URL. En ese caso la
descarga directa no sirve y hay que guiar la interfaz paso a paso — avísame
con la URL que imprime y una captura de la pantalla de búsqueda.

## Paso 2 — descargar todos los lotes

Escribe los lotes en `lotes.txt`, uno por línea, y ejecuta:

```bash
npm run descargar
```

Los PDF quedan en `descargas/`. Al terminar imprime un resumen: cuántos
bajaron, cuáles no devolvieron un PDF y cuáles dieron error.

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
