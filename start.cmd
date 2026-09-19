@echo off
rem Start the editor. Double-click, or type `start.cmd` (plain `start` is a cmd built-in).
setlocal
cd /d "%~dp0"

where node >nul 2>&1 || (
  echo.
  echo Node.js is not installed. Get it from https://nodejs.org ^(24 or newer^), then run this again.
  echo.
  pause
  exit /b 1
)

node scripts\start.mjs %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo The editor could not be started. See the error above.
  pause
)
exit /b %EXITCODE%
