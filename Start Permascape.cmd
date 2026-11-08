@echo off
rem Permascape 3D for Windows: double-click to start. Uses the Node.js inside this folder.
title Permascape 3D
setlocal
cd /d "%~dp0"
set "NODE=%~dp0runtime\node\node.exe"
if not exist "%NODE%" (
  where node >/dev/null 2>/dev/null || (
    echo Permascape 3D is missing its runtime folder.
    echo Download Permascape 3D again, unzip it, and keep the whole folder together.
    pause
    exit /b 1
  )
  set "NODE=node"
)
"%NODE%" --no-warnings "%~dp0scripts\start-windows.mjs"
if errorlevel 1 (
  pause
  exit /b 1
)
timeout /t 6 >nul
