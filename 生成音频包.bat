@echo off
REM ASCII-only launcher: set UTF-8 codepage BEFORE cmd reads the Chinese UI file.
chcp 65001 >nul
call "%~dp0tools\gen-audio-ui.cmd"
