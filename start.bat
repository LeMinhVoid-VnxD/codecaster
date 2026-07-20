@echo off
title CodeCaster
cd /d "%~dp0"
echo Starting CodeCaster...
start /B D:\node.exe server.js
timeout /t 2 /nobreak >nul
echo.
echo Open http://localhost:3000 in your browser
start http://localhost:3000
echo.
echo Close this window to stop the server.
pause >nul
taskkill /F /IM node.exe >nul 2>&1
