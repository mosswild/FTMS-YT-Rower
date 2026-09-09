@echo off
title FTMS-Rower Bluetooth Bridge
echo =======================================================
echo  FTMS-Rower: Windows Bluetooth Relay Bridge
echo =======================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not detected in your PATH.
    echo Please install Python from https://www.python.org or run:
    echo   winget install Python.Python.3.12
    echo.
    pause
    exit /b 1
)

echo Checking for 'bleak' Bluetooth library...
python -c "import bleak" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Installing required 'bleak' package...
    pip install bleak
)

echo.
echo Starting Bluetooth Bridge to Docker server (http://localhost:8000)...
echo Ensure your PM5 or FTMS rower monitor is ON and awake.
echo.
python scripts\bluetooth_relay.py --server http://localhost:8000 %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo Relay process exited with code %ERRORLEVEL%.
    pause
)
