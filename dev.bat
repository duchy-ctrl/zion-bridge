@echo off
setlocal
title Zion Bridge - rulare in mod dezvoltare
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [EROARE] Node.js nu este instalat. Instaleaza de pe https://nodejs.org
  start https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalez dependentele...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)

call npx electron .
pause
