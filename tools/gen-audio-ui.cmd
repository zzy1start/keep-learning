@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Keep Learning - 生成离线音频包
cd /d "%~dp0.."

echo.
echo   ============================================
echo      Keep Learning - 离线音频包生成
echo   ============================================
echo   [版本] 2026-10-26 v2
echo   [UI] %~f0
echo.

REM ================= Node =================
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if defined NODE_EXE (
  "%NODE_EXE%" -v >nul 2>nul
  if errorlevel 1 set "NODE_EXE="
)
if not defined NODE_EXE (
  for /f "delims=" %%D in ('dir /b /ad /o-n "%USERPROFILE%\.workbuddy\binaries\node\versions" 2^>nul') do (
    if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe" (
      set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe"
      goto :node_found
    )
  )
)
:node_found
if not defined NODE_EXE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if exist "%%~fD\dependencies\node\bin\node.exe" set "NODE_EXE=%%~fD\dependencies\node\bin\node.exe"
  )
)
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE_EXE (
  "%NODE_EXE%" -v >nul 2>nul
  if errorlevel 1 set "NODE_EXE="
)
if not defined NODE_EXE (
  echo   [X] 未找到 Node.js。
  echo       安装：https://nodejs.org  ^(LTS，勾选 Add to PATH^)
  echo       或把 WorkBuddy 自带 Node 的目录加入 PATH。
  echo.
  pause
  exit /b 1
)
echo   [OK] Node: %NODE_EXE%
"%NODE_EXE%" -v

REM ================= Python =================
set "PY_EXE="
where python >nul 2>nul
if not errorlevel 1 set "PY_EXE=python"
if defined PY_EXE (
  "%PY_EXE%" -c "import sys" >nul 2>nul
  if errorlevel 1 set "PY_EXE="
)
if not defined PY_EXE (
  where py >nul 2>nul
  if not errorlevel 1 set "PY_EXE=py"
)
if not defined PY_EXE (
  for %%P in ("%USERPROFILE%\anaconda3\python.exe" "%USERPROFILE%\miniconda3\python.exe" "C:\ProgramData\Anaconda3\python.exe") do (
    if exist "%%~fP" set "PY_EXE=%%~fP"
  )
)
if defined PY_EXE (
  "%PY_EXE%" -c "import sys" >nul 2>nul
  if errorlevel 1 set "PY_EXE="
)
if not defined PY_EXE (
  echo   [X] 未找到 Python 3。
  echo       安装：https://www.python.org/downloads/  ^(勾选 Add to PATH^)
  echo.
  pause
  exit /b 1
)
echo   [OK] Python: %PY_EXE%
"%PY_EXE%" --version

REM ================= edge-tts =================
set "HAS_EDGE="
"%PY_EXE%" -c "import edge_tts" >nul 2>nul
if not errorlevel 1 set "HAS_EDGE=1"
if not defined HAS_EDGE (
  if not defined KL_AUDIO_NONINTERACTIVE (
    echo   [注意] 未安装 edge-tts。
    set /p "ANS=是否现在安装？[Y/N]: "
    if /i "!ANS!"=="Y" (
      "%PY_EXE%" -m pip install --upgrade edge-tts
      "%PY_EXE%" -c "import edge_tts" >nul 2>nul
      if not errorlevel 1 set "HAS_EDGE=1"
    )
  )
)
if defined HAS_EDGE (echo   [OK] edge-tts 已安装) else (echo   [注意] edge-tts 未安装：python -m pip install --upgrade edge-tts)

REM ================= ffmpeg =================
set "FFMPEG_EXE="
where ffmpeg >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%F in ('where ffmpeg') do if not defined FFMPEG_EXE set "FFMPEG_EXE=%%F"
)
if not defined FFMPEG_EXE (
  "%PY_EXE%" -c "import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())" > "%TEMP%\kl_ffmpeg.txt" 2>nul
  if exist "%TEMP%\kl_ffmpeg.txt" set /p FFMPEG_EXE=<"%TEMP%\kl_ffmpeg.txt"
)
if not defined FFMPEG_EXE (
  if not defined KL_AUDIO_NONINTERACTIVE (
    echo   [注意] 未找到 ffmpeg。
    echo       推荐：winget install --id Gyan.FFmpeg -e
    set /p "ANS=是否改用 pip 安装 imageio-ffmpeg？[Y/N]: "
    if /i "!ANS!"=="Y" (
      "%PY_EXE%" -m pip install --upgrade imageio-ffmpeg
      "%PY_EXE%" -c "import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())" > "%TEMP%\kl_ffmpeg.txt" 2>nul
      if exist "%TEMP%\kl_ffmpeg.txt" set /p FFMPEG_EXE=<"%TEMP%\kl_ffmpeg.txt"
    )
  )
)
set "FFMPEG_ARG="
if defined FFMPEG_EXE (
  echo   [OK] ffmpeg: %FFMPEG_EXE%
  set FFMPEG_ARG=--ffmpeg "%FFMPEG_EXE%"
) else (
  echo   [注意] ffmpeg 未找到：winget install --id Gyan.FFmpeg -e
)

REM ================= menu =================
if defined KL_AUDIO_ACTION goto action%KL_AUDIO_ACTION%

:menu
echo.
echo   --------------------------------------------
echo    1. 检查环境（不生成）
echo    2. 试听 5 条（work\test-audio）
echo    3. 全量生成到 work\test-audio（测试）
echo    4. 补全 assets\audio（只生成缺失）
echo    5. 强制重新生成 assets\audio（覆盖，约 1-2 小时）
echo    6. 打开输出目录
echo    0. 退出
echo   --------------------------------------------
echo.
set "CHOICE="
set /p "CHOICE=请输入序号: "
if not defined CHOICE goto end
if "%CHOICE%"=="1" goto action1
if "%CHOICE%"=="2" goto action2
if "%CHOICE%"=="3" goto action3
if "%CHOICE%"=="4" goto action4
if "%CHOICE%"=="5" goto action5
if "%CHOICE%"=="6" goto action6
if "%CHOICE%"=="0" goto end
echo   无效输入。
goto menu

:action1
echo.
echo   [1/1] 检查环境...
"%NODE_EXE%" tools\gen-audio-pack.cjs --dry --out work\test-audio --python "%PY_EXE%" %FFMPEG_ARG%
goto after_action

:action2
echo.
echo   [1/1] 生成 5 条试听...
"%NODE_EXE%" tools\gen-audio-pack.cjs --out work\test-audio --limit 5 --python "%PY_EXE%" %FFMPEG_ARG%
goto after_action

:action3
echo.
echo   [1/1] 全量生成到 work\test-audio（可 Ctrl+C 中断，重跑续传）...
"%NODE_EXE%" tools\gen-audio-pack.cjs --out work\test-audio --python "%PY_EXE%" %FFMPEG_ARG%
goto after_action

:action4
echo.
echo   [1/1] 补全 assets\audio（已存在的跳过）...
"%NODE_EXE%" tools\gen-audio-pack.cjs --python "%PY_EXE%" %FFMPEG_ARG%
goto after_action

:action5
echo.
echo   [注意] 将覆盖 assets\audio 下全部 11,311 个 MP3，约 1-2 小时。
set "ANS="
set /p "ANS=确认继续？[Y/N]: "
if not defined ANS goto menu
if /i not "%ANS%"=="Y" goto menu
"%NODE_EXE%" tools\gen-audio-pack.cjs --force --python "%PY_EXE%" %FFMPEG_ARG%
goto after_action

:action6
if exist "work\test-audio" start "" "work\test-audio"
if exist "assets\audio" start "" "assets\audio"
goto menu

:after_action
echo.
if not defined KL_AUDIO_NONINTERACTIVE pause
if defined KL_AUDIO_ACTION goto end
goto menu

:end
endlocal
