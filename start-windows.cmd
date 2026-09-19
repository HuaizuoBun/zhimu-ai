@echo off
setlocal
cd /d "%~dp0"
title Zhimu AI - Local Server
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS from https://nodejs.org/en/download
  echo Then reopen this file.
  pause
  exit /b 1
)
node -e "const [M,m]=process.versions.node.split('.').map(Number);process.exit(M>22||(M===22&&m>=13)?0:1)"
if errorlevel 1 (
  echo Node.js 22.13.0 or newer is required. Node.js 24 LTS is recommended.
  pause
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm is missing. Reinstall Node.js with npm enabled.
  pause
  exit /b 1
)
if not exist "node_modules\vinext\dist\cli.js" (
  echo Installing dependencies. An internet connection is required.
  call npm.cmd ci
  if errorlevel 1 (
    echo Installation failed. Please keep the error text above.
    pause
    exit /b 1
  )
)
echo Starting Zhimu AI. Keep this window open.
echo Wait for the Local URL below, then open it in your browser.
echo The default URL is http://localhost:3000
call npm.cmd run dev
pause
