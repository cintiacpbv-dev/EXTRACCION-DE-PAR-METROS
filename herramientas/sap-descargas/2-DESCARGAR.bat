@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Paso 2 - Descargar los lotes

echo ============================================================
echo   PASO 2 - Descargar los lotes de lotes.txt
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js. Abre primero 1-APRENDER.bat
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Todavia no esta instalado. Abre primero 1-APRENDER.bat
  echo.
  pause
  exit /b 1
)

node descargar.mjs descargar
echo.
echo Los PDF quedaron en la carpeta "descargas".
echo.
pause
