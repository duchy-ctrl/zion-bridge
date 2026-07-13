@echo off
setlocal
title Zion Bridge - Traducere cod eroare casa
cd /d "%~dp0"
echo ============================================
echo   TRADUCERE COD EROARE DATECS
echo ============================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try { $d = New-Object -ComObject 'dude.CFD_DUDE' } catch { Write-Host '[EROARE] Nu pot crea dude.CFD_DUDE:' $_.Exception.Message; pause; exit 1 };" ^
  "foreach ($code in -111024,-111023,-111025,-111002) {" ^
  "  try { $msg = $d.get_ErrorMessageByCode([int]$code) } catch { $msg = '(nu pot citi: ' + $_.Exception.Message + ')' };" ^
  "  Write-Host ('{0} = {1}' -f $code, $msg) };" ^
  "Write-Host '';" ^
  "Write-Host '--- ultimul mesaj/cod retinut de driver ---';" ^
  "try { Write-Host ('lastError_Code = ' + $d.lastError_Code) } catch {};" ^
  "try { Write-Host ('lastError_Message = ' + $d.lastError_Message) } catch {}"
echo.
echo ============================================
echo Copiaza textul de mai sus si trimite-mi-l.
echo ============================================
pause
