@echo off
@chcp 65001 >nul 2>&1
title Riichi Mahjong Scoreboard Server

if not exist node_modules\express goto do_install
if not exist frontend\dist\index.html goto do_build
goto run_server

:do_install
echo [Setup] Installing core dependencies...
call npm install --omit=dev
if errorlevel 1 goto error_exit
if not exist frontend\dist\index.html goto do_build
goto run_server

:do_build
echo [Setup] Building frontend production assets...
if not exist frontend\node_modules call npm run frontend:install
call npm run build
if errorlevel 1 goto error_exit
goto run_server

:run_server
node server.js
if errorlevel 1 goto error_exit
goto end

:error_exit
pause
exit /b 1

:end
