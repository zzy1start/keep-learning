@echo off
chcp 936 >nul
setlocal
title Stop Keep Learning Service

cd /d "%~dp0"
set PORT=8777
set CHECK=%~dp0tools\port-check.js

echo.
echo   Stopping Keep Learning service on port %PORT% ...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js not found - cannot stop automatically.
  echo.
  echo       You can also stop it manually: open Task Manager and
  echo       end the "node.exe" process running serve.js
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

for /f "usebackq delims=" %%r in (`node "%CHECK%" stop 2^>^&1`) do set RESULT=%%r

echo   %%RESULT%%
echo.

echo "%RESULT%" | findstr /C:"STOPPED" >nul
if not errorlevel 1 goto :done
echo "%RESULT%" | findstr /C:"NOT_RUNNING" >nul
if not errorlevel 1 goto :none
goto :failed

:done
echo   [OK] Service stopped. You can close this window.
pause
exit /b 0

:none
echo   [i] Nothing was running on port %PORT%.
echo       Nothing to do.
pause
exit /b 0

:failed
echo   [X] Could not stop the service automatically.
echo.
echo       Try manually: open Task Manager and end the node.exe
echo       process whose command line contains serve.js
echo.
pause
exit /b 1