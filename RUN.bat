@echo off
setlocal
cd /d "%~dp0"
title قاموس أبو فلاح مع المزادات

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Run INSTALL.bat first.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Dependencies are missing. Run INSTALL.bat first.
  pause
  exit /b 1
)
if not exist ".env" (
  echo .env is missing. Run INSTALL.bat and configure Discord first.
  pause
  exit /b 1
)

start "LLSTD Site Server" /D "%~dp0" cmd /k "npm start"
powershell -NoProfile -Command "$ready=$false; for($i=0; $i -lt 30; $i++){ try { if((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/' -TimeoutSec 2).StatusCode -eq 200){$ready=$true;break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ready){exit 1}"
if errorlevel 1 (
  echo The site did not respond on port 3000. Check the server window and .env settings.
  pause
  exit /b 1
)
start "" http://localhost:3000
echo The site is open. Keep the "LLSTD Site Server" window running.
pause
