@echo off
chcp 936 >nul
setlocal
title Keep Learning - Repair Desktop Icon
cd /d "%~dp0"

echo.
echo   ============================================
echo      Keep Learning - Repair Desktop Icon
echo   ============================================
echo.
echo   Use this when the desktop shortcut shows a plain
echo   document icon instead of the Keep Learning logo.
echo.

if not exist "assets\english-app.ico" (
  echo   [X] assets\english-app.ico is missing.
  echo       Restore the file, then run the desktop setup script again.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js not found. Install from https://nodejs.org first.
  pause
  exit /b 1
)

echo   [1/3] Validating the icon file...
node "tools\check-icon.cjs"
if errorlevel 1 (
  echo   [X] The icon file is not usable. Restore assets\english-app.ico.
  pause
  exit /b 1
)

echo.
echo   [2/3] Clearing the Windows icon cache...
echo         (Explorer will restart; open windows keep running.)
taskkill /f /im explorer.exe >nul 2>nul
del /f /q "%LocalAppData%\IconCache.db" >nul 2>nul
del /f /q "%LocalAppData%\Microsoft\Windows\Explorer\iconcache*" >nul 2>nul
start "" explorer.exe
timeout /t 3 /nobreak >nul

echo.
echo   [3/3] Recreating the desktop shortcut...
node "tools\install-shortcuts.js"
if errorlevel 1 (
  echo   [X] Shortcut creation failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo      Done. If the icon is still blank:
echo        - press F5 on the desktop, or
echo        - sign out and sign back in once.
echo   ============================================
echo.
pause
endlocal
