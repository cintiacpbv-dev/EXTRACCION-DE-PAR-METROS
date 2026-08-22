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
echo   1. Te preguntare un lote de ejemplo: escribelo aqui.
echo   2. Espera a que cargue "Reporte Sobre de Lote Digital".
echo   3. Vuelve a ESTA ventana y pulsa Enter.
echo.
echo El resto lo hago yo: relleno el lote, pulso Consulta y leo
echo la tabla de resultados.
echo.
echo Se creara diagnostico.txt, que hay que enviarme.
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
