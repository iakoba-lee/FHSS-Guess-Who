@echo off
cd /d "%~dp0"

echo Starting FHSS Staff Matcher Server...
start /B node server.js

timeout /t 2 /nobreak >nul

start http://localhost:8080/host

echo Server is running. Close this window to stop.
pause
