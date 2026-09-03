#!/usr/bin/env bash
# 日麻计分板 - Termux / Linux 一键启动与保活脚本

echo "========================================="
echo "  🀄 日麻计分板 - 服务启动中...  "
echo "========================================="

# 检查 Node.js 环境
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先在 Termux 中执行: pkg install nodejs"
    exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 首次运行，正在安装后端依赖..."
    npm install --production
fi

echo "🚀 正在启动服务 (端口 32000)..."
echo "🌐 本地访问地址: http://localhost:32000"
echo "📱 局域网其他设备请访问 Termux 设备的 IP:32000"
echo "💡 按 Ctrl + C 即可停止服务"
echo "========================================="

node server.js
