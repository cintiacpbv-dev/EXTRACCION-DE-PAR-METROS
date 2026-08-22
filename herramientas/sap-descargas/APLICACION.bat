@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Descargar lotes de SAP

echo ============================================================
echo   DESCARGAR LOTES DE SAP
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js en esta computadora.
  echo.
  echo Descargalo de https://nodejs.org ^(boton verde "LTS"^),
  echo instalalo con las opciones por defecto y vuelve a abrir esto.
  echo.
  pause
  exit /b 1
)

echo Comprobando que este todo instalado...
call npm install --silent
if errorlevel 1 goto error
call npx playwright install chromium
if errorlevel 1 goto error

echo.
echo Abriendo la aplicacion en tu navegador...
echo NO CIERRES esta ventana mientras la uses.
echo.
node app.mjs
pause
exit /b 0

:error
echo.
echo Algo fallo durante la instalacion. Copiame el texto de arriba.
echo.
pause
exit /b 1
