@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Grabar los pasos de la descarga

echo ============================================================
echo   GRABAR LOS PASOS DE LA DESCARGA
echo ============================================================
echo.
echo Se abriran DOS ventanas:
echo.
echo   - Una con SAP, ya con tu sesion iniciada.
echo   - Otra llamada "Playwright Inspector", donde ira
echo     apareciendo texto solo, a medida que haces clic.
echo.
echo QUE TIENES QUE HACER:
echo.
echo   1. En el Inspector, pulsa el boton "Record" (circulo rojo).
echo   2. En la ventana de SAP, entra a la transaccion de los RMD.
echo   3. Escribe UN lote y descarga su PDF, como siempre.
echo   4. Copiame TODO el texto que salio en el Inspector.
echo   5. Cierra las dos ventanas.
echo.
echo ============================================================
echo.
pause

where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js. Abre primero 1-APRENDER.bat
  pause
  exit /b 1
)

node descargar.mjs grabar
echo.
pause
