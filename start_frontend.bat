@echo off
title AR Gesture - Frontend
cd /d "%~dp0frontend"

echo ========================================
echo   AR Gesture - Frontend Server
echo   Open: http://localhost:8080
echo ========================================
echo.

python -m http.server 8080

echo.
echo Frontend stopped.
pause
