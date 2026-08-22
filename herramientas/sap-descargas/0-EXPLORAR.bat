@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Leer la estructura de la pantalla de SAP

echo ============================================================
echo   LEER LA ESTRUCTURA DE LA PANTALLA
echo ============================================================
echo.
echo Se abrira SAP con tu sesion ya iniciada.
echo.
echo QUE TIENES QUE HACER:
echo.
echo   1. Entra a "Reporte Sobre de Lote Digital".
echo   2. Escribe un lote y pulsa "Consulta".
echo   3. Deja en pantalla la tabla con las etapas.
echo   4. Vuelve a ESTA ventana y pulsa Enter.
echo.
echo Se creara el archivo diagnostico.txt, que hay que enviarme.
echo Solo lleva nombres de campos, botones y columnas.
echo.
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js. Abre primero 1-APRENDER.bat
  pause
  exit /b 1
)

node descargar.mjs explorar
echo.
pause
