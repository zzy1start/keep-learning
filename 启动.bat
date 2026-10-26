@echo off
chcp 936 >nul
setlocal
title Keep Learning
cd /d "%~dp0"

set PORT=8777
set URL=http://127.0.0.1:%PORT%
set CHECK=%~dp0tools\port-check.js

echo.
echo   ============================================
echo      Keep Learning - English Study Workbench
echo   ============================================
echo.

REM ---------- 1. check node ----------
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js not found
  echo.
  echo       Node.js is required. Install from:
  echo       https://nodejs.org    ^(choose LTS version^)
  echo.
  pause
  exit /b 1
)

if not exist "%CHECK%" (
  echo   [X] Missing helper: %CHECK%
  echo.
  pause
  exit /b 1
)

REM ---------- 2. already running? ----------
REM Use node to probe the port: netstat+findstr inside batch
REM blocks is unreliable (variables expand too early inside if-blocks).
node "%CHECK%" serve >nul 2>&1
if errorlevel 10 (
  echo   [i] Service is already running.
  echo       Opening browser...
  echo.
  start "" "%URL%"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

REM ---------- 3. start server in background ----------
echo   [1/3] Starting local server...
start "Keep Learning Server" /min node "%~dp0serve.js" %PORT%

REM ---------- 4. wait until reachable ----------
echo   [2/3] Waiting for server...
node "%CHECK%" wait >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [X] Server start timeout ^(25s^)
  echo.
  echo       Possible causes:
  echo        - port %PORT% is occupied by another program
  echo          Close it, then run this launcher again.
  echo        - Node.js is broken. Try: node --version
  echo.
  echo       To stop a possibly-stuck service, run stop-service.bat
  echo.
  pause
  exit /b 1
)

echo   [3/3] Server is ready
echo.
echo   ============================================
echo      Open: %URL%
echo   ============================================
echo.
echo   Running in background. Closing this window will NOT
echo   stop the service. To stop it, run stop-service.bat.
echo.
start "" "%URL%"
echo   Opened in your default browser.
echo.
pause
endlocal