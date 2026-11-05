@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "%~dp0connector\server.mjs" --stop
pause
