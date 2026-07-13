@echo off
setlocal
title Zion Bridge - Build
cd /d "%~dp0"

echo ============================================
echo   ZION BRIDGE - construire installer
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [EROARE] Node.js nu este instalat.
  echo.
  echo 1. Deschide https://nodejs.org si instaleaza versiunea LTS
  echo 2. Reporneste acest script dupa instalare.
  echo.
  start https://nodejs.org/
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do echo Node.js detectat: %%v
echo.

if not exist node_modules (
  echo [1/2] Instalez dependentele (poate dura cateva minute prima data^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [EROARE] npm install a esuat. Verifica conexiunea la internet si reincearca.
    pause
    exit /b 1
  )
) else (
  echo [1/2] Dependentele exista deja, sar peste npm install.
)

echo.
echo [2/2] Construiesc installer-ul .exe ...
call npx electron-builder --win
if errorlevel 1 (
  echo.
  echo [EROARE] Build esuat. Ruleaza din nou; daca persista, sterge folderul node_modules si reia.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   GATA! Installer-ul este in folderul: dist\
echo   Fisier: ZionBridge-Setup-(versiune).exe
echo.
echo   UPDATE pe PC-ul din restaurant: ruleaza noul installer
echo   PESTE versiunea veche - setarile se pastreaza automat.
echo ============================================
echo.
start "" explorer "%~dp0dist"
pause
