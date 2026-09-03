@echo off
chcp 65001 >nul
echo ========================================================
echo   🀄 日麻计分板 - 本地编译产物极速同步至 release 分支
echo ========================================================
echo.
echo 1. 正在本地编译前端最新产物...
call npm run build --prefix frontend

echo.
echo 2. 正在打包并推送到 release 分支...
git checkout --orphan temp_release 2>nul || git checkout -b temp_release
git rm -rf . >nul 2>&1
git add -f server.js package.json package-lock.json start.sh start-server.bat README.md frontend/dist/
git commit -m "chore(release): build v3.124 ready-to-run release artifacts"
git push origin temp_release:release --force
git checkout main
git branch -D temp_release

echo.
echo ========================================================
echo ✅ 编译产物分支 release 已成功推送到 GitHub！
echo 📱 手机 Termux 随时拉取最新版本:
echo    git clone -b release --single-branch <REPO_URL>
echo ========================================================
pause
