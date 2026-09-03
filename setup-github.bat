@echo off
chcp 65001 >nul
echo ========================================================
echo   🀄 日麻计分板 - GitHub 仓库初始化与多分支推送助手
echo ========================================================
echo.
echo 请输入您在 GitHub 上创建的【私有仓库 Private Repo】URL:
echo (例如: https://github.com/YourUsername/riichi-mahjong-scoreboard.git)
echo.
set /p REPO_URL="仓库地址: "

if "%REPO_URL%"=="" (
    echo ❌ 仓库地址不能为空！
    pause
    exit /b 1
)

echo.
echo 1. 正在关联远程仓库...
git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo.
echo 2. 正在推送所有分支到 GitHub...
echo    - main           (源码主分支)
echo    - release        (局域网/Termux 免编译运行产物分支)
echo    - public-server  (公网服务器源码与配置分支)
echo    - release-server (公网服务器免编译运行产物分支)
echo.

git push -u origin main
git push -u origin release
git push -u origin public-server
git push -u origin release-server

echo.
echo ========================================================
echo ✅ 所有分支已成功推送到您的 GitHub 私有仓库！
echo.
echo 📱 手机 Termux 运行 (局域网版):
echo    git clone -b release --single-branch %REPO_URL%
echo.
echo 🌐 公网 VPS / 云服务器运行 (公网版):
echo    git clone -b release-server --single-branch %REPO_URL%
echo ========================================================
pause
