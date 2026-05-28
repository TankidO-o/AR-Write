@echo off
title AR Gesture - Launcher

echo Starting AR Gesture System...
echo.

REM Start backend in a new window
start "AR Backend" cmd /c "%~dp0start_backend.bat"

REM Wait for backend to initialize
echo Waiting for backend to start...
timeout /t 4 /nobreak >nul

REM Start frontend in a new window
start "AR Frontend" cmd /c "%~dp0start_frontend.bat"

echo.
echo Both servers launched in separate windows.
echo Frontend: http://localhost:8080
echo Backend:  ws://127.0.0.1:8765/ws
echo.

REM Optional: open browser
start http://localhost:8080

