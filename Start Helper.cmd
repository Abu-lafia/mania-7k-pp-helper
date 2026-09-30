@echo off
setlocal
cd /d "%~dp0"
set "TEMP=%~dp0work\tmp"
set "TMP=%~dp0work\tmp"
if not exist "%TEMP%" mkdir "%TEMP%"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0launcher.mjs"
) else (
  node "%~dp0launcher.mjs"
)
if errorlevel 1 pause
