@echo off
REM One-click launcher for the Upscale Studio dashboard (server + browser).
REM Double-click this file. Close the "Upscale Studio server" window to stop.
title Upscale Studio launcher
cd /d "%~dp0"
echo Starting Upscale Studio server...
start "Upscale Studio server (close this window to stop)" cmd /k "node scripts\tree-upscale\upscale-server.mjs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8131/tools/upscale-studio.html"
echo.
echo Dashboard: http://127.0.0.1:8131/tools/upscale-studio.html
echo (Buttons are live because this uses the control server, not http-server.)
