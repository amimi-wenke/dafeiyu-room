@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 需要先安装 Node.js 22 或更新版本。
  pause
  exit /b 1
)
node "%~dp0connector\server.mjs"
pause
