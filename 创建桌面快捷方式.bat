@echo off
chcp 936 >nul
setlocal
title Keep Learning - Setup
cd /d "%~dp0"

echo.
echo   ============================================
echo      Keep Learning - Desktop Setup
echo   ============================================
echo.
echo   This will create shortcuts on your Desktop.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js not found. Install from https://nodejs.org first.
  echo.
  pause
  exit /b 1
)

node "%~dp0tools\install-shortcuts.js"
if errorlevel 1 (
  echo.
  echo   [X] Setup failed.
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo      Done. Check your Desktop.
echo   ============================================
echo.
pause
endlocal