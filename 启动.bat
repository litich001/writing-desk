@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   写作台 启动中...
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo   没找到 Node.js。请先安装: https://nodejs.org
  pause
  exit /b 1
)
start "" http://127.0.0.1:8848
node server.mjs 8848
pause
