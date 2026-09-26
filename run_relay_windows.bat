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

set SERVER_URL=http://localhost:8000

rem Auto-detect if HTTPS is enabled via .env or generated certificates
if exist "config\ssl\cert.pem" (
    set SERVER_URL=https://localhost:8000
)
if exist ".env" (
    findstr /I /C:"AUTO_HTTPS=true" .env >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        set SERVER_URL=https://localhost:8000
    )
)

rem Explicit CLI flags override auto-detection
if "%1"=="--https" (
    set SERVER_URL=https://localhost:8000
    shift
)
if "%1"=="--http" (
    set SERVER_URL=http://localhost:8000
    shift
)

echo.
echo Starting Bluetooth Bridge to Docker server (%SERVER_URL%)...
echo Ensure your PM5 or FTMS rower monitor is ON and awake.
echo.
python scripts\bluetooth_relay.py --server %SERVER_URL% %1 %2 %3 %4 %5 %6 %7 %8 %9

if %ERRORLEVEL% neq 0 (
    echo.
    echo Relay process exited with code %ERRORLEVEL%.
    pause
)
