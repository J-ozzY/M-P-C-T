@echo off
title MPCT - MTG Price Comparison Tool
echo ============================================
echo   MPCT - MTG Price Comparison Tool
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 goto :nonode

echo [OK] Node.js found:
node --version
echo.

:: Install dependencies if needed
if exist "node_modules" goto :skipdeps
echo [*] Installing dependencies (first run only, may take a minute)...
call npm install
if %ERRORLEVEL% neq 0 goto :depsfail
echo [OK] Dependencies installed.
echo.

:skipdeps

:: Build if needed
if exist "dist" goto :skipbuild
echo [*] Building project...
call npm run build
if %ERRORLEVEL% neq 0 goto :buildfail
echo [OK] Build complete.
echo.

:skipbuild

echo ============================================
echo   Starting server...
echo   Opening http://localhost:3000
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================
echo.

:: Open browser after a short delay
start "" "http://localhost:3000"

:: Start the server (this blocks until Ctrl+C)
node dist/index.js
goto :eof

:nonode
echo [ERROR] Node.js is not installed!
echo.
echo Please download and install Node.js from:
echo   https://nodejs.org/
echo.
echo After installing, close this window and double-click start.bat again.
pause
exit /b 1

:depsfail
echo.
echo [ERROR] Failed to install dependencies.
pause
exit /b 1

:buildfail
echo.
echo [ERROR] Build failed.
pause
exit /b 1
