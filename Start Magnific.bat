@echo off
REM ============================================================
REM   Magnific Kling 2.6 Motion Control - one-click launcher
REM   Double-click this file on Windows to start the app.
REM ============================================================

setlocal
cd /d "%~dp0"

title Magnific Kling 2.6

echo.
echo ====================================================
echo   Magnific Kling 2.6 Motion Control
echo ====================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this system.
    echo.
    echo Please install Node.js 20 or newer from:
    echo   https://nodejs.org/
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo First-time setup: installing dependencies. This may take a
    echo few minutes the first time...
    echo.
) else (
    echo Syncing dependencies ^(quick if nothing changed^)...
)

call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. See the messages above.
    pause
    exit /b 1
)

echo.
echo Launching the app... ^(this window stays open while the app is running^)
echo Close this window or press Ctrl+C to stop the app.
echo.

call npm run dev
