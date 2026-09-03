@echo off
chcp 65001 >nul
echo ========================================================
echo   🀄 日麻计分板 - GitHub 仓库初始化与双分支推送助手
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
echo 1. 正在初始化 Git 仓库与提交源代码 (main 分支)...
git init
git branch -M main
git add .
git commit -m "feat: release v3.124 complete scoreboard with 5 themes, offline fonts and auto-deploy CI"

echo.
echo 2. 正在关联远程仓库...
git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo.
echo 3. 正在推送 main 分支 (源码)...
git push -u origin main

echo.
echo ========================================================
echo ✅ 源码已成功推送到 main 分支！
echo 💡 GitHub Actions 会自动为您编译前端并生成 release 分支。
echo 📱 手机 Termux 部署只需执行:
echo    git clone -b release --single-branch %REPO_URL%
echo ========================================================
pause
