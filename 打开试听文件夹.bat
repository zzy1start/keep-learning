@echo off
setlocal
set "D=%~dp0work\test-audio\words\f"
if exist "%D%" (
  echo Opening: %D%
  start "" "%D%"
) else (
  echo Folder not found:
  echo   %D%
  echo.
  echo Run the menu action 2 first.
  pause
)
