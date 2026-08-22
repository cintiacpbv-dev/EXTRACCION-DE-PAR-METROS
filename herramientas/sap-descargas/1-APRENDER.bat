@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Paso 1 - Ensenarle a SAP como se descarga

echo ============================================================
echo   PASO 1 - Ensenarle a SAP como se descarga
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js en esta computadora.
  echo.
  echo Descargalo de https://nodejs.org  ^(boton verde "LTS"^),
  echo instalalo con las opciones que vienen por defecto,
  echo y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

echo Comprobando que este todo instalado...
echo.

REM Las dos ordenes son rapidas si ya estaba todo, y arreglan el caso en que
REM las dependencias esten pero falte el navegador (o al reves).
call npm install --silent
if errorlevel 1 goto error

call npx playwright install chromium
if errorlevel 1 goto error

echo.
node descargar.mjs aprender
echo.
pause
exit /b 0

:error
echo.
echo Algo fallo durante la instalacion. Copiame el texto de arriba.
echo.
pause
exit /b 1
