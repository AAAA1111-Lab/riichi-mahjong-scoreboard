@echo off
@chcp 65001 >nul 2>&1
title Riichi Mahjong Scoreboard Server [Public Server Mode]

cd /d "%~dp0"

echo ==================================================
echo  Riichi Mahjong Scoreboard [Public Server Mode]
echo ==================================================

if not exist node_modules\express goto do_install
if not exist frontend\dist\index.html goto do_build
if not exist frontend\dist\.target_server goto do_build
goto run_server

:do_install
echo [Setup] Installing core dependencies...
call npm install --omit=dev
if errorlevel 1 goto error_exit
if not exist frontend\dist\index.html goto do_build
if not exist frontend\dist\.target_server goto do_build
goto run_server

:do_build
echo [Setup] Building frontend production assets for Server mode...
if not exist frontend\node_modules call npm run frontend:install
call npm run build:server
if errorlevel 1 goto error_exit
del /q frontend\dist\.target_* >nul 2>&1
echo server > frontend\dist\.target_server
goto run_server

:run_server
echo [Startup] Launching Public Server Engine (Multi-Room Enabled)...
set TARGET_ENV=server
node server.js --target=server
if errorlevel 1 goto error_exit
goto end

:error_exit
echo.
echo [Error] Server process terminated abnormally.
pause
exit /b 1

:end
