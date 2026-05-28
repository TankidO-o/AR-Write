@echo off
title AR Gesture - Backend
cd /d "%~dp0backend"

echo ========================================
echo   AR Gesture - Backend Server
echo   WebSocket: ws://127.0.0.1:8765/ws
echo   Frame API: http://127.0.0.1:8765/frame
echo ========================================
echo.

python server.py

echo.
echo Backend stopped.
pause
