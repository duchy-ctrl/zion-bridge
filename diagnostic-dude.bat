@echo off
setlocal
title Zion Bridge - Diagnostic DUDE
cd /d "%~dp0"
echo ============================================
echo   DIAGNOSTIC DUDE - semnaturi metode COM
echo ============================================
echo.
echo Inchide vechiul POS inainte (portul casei accepta un singur client).
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try { $d = New-Object -ComObject 'dude.CFD_DUDE' } catch { Write-Host '[EROARE] Nu pot crea dude.CFD_DUDE:' $_.Exception.Message; pause; exit 1 };" ^
  "Write-Host '--- Metode care contin Command / Execute ---';" ^
  "$d | Get-Member -MemberType Method | Where-Object { $_.Name -match 'ommand|xecute' } | ForEach-Object { Write-Host $_.Definition };" ^
  "Write-Host '';" ^
  "Write-Host '--- TOATE metodele ---';" ^
  "$d | Get-Member -MemberType Method | ForEach-Object { Write-Host $_.Definition };" ^
  "Write-Host '';" ^
  "Write-Host '--- Proprietati (in/out data, last error) ---';" ^
  "$d | Get-Member -MemberType Property | ForEach-Object { Write-Host $_.Definition }"
echo.
echo ============================================
echo Copiaza tot textul de mai sus si trimite-mi-l.
echo ============================================
pause
