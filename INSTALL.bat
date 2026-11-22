@echo off
setlocal
cd /d "%~dp0"
title قاموس أبو فلاح - تثبيت المزادات

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 20 LTS or newer from https://nodejs.org/
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  echo Install the latest LTS from https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example.
  echo Add your new Discord credentials and role IDs to .env.
) else (
  echo Existing .env found; leaving it unchanged.
)

echo Installing site and auction dependencies...
call npm install
if errorlevel 1 (
  echo Dependency installation failed. Check your internet connection.
  pause
  exit /b 1
)

if not exist "llstd-auctions\data" mkdir "llstd-auctions\data"
if not exist "llstd-auctions\public\plate-uploads" mkdir "llstd-auctions\public\plate-uploads"
echo.
echo Installation finished. Configure .env, then run RUN.bat.
pause
