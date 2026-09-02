@echo off
rem Start the editor. Double-click, or type `start.cmd` (plain `start` is a cmd built-in).
rem
rem Installs on first use, builds the page when it is missing or older than the
rem sources, then serves it on http://127.0.0.1:8000 and opens a browser.
setlocal
cd /d "%~dp0"

where node >nul 2>&1 || (
  echo.
  echo Node.js is not installed. Get it from https://nodejs.org ^(24 or newer^), then run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm ci || exit /b 1
)

if not exist editor\dist\index.html (
  echo Building the editor...
  call npm run build || exit /b 1
)

call npm start %*
