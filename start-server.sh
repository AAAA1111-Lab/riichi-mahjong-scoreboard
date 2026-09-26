#!/bin/sh
# Riichi Mahjong Scoreboard - Linux / Termux / macOS Server Mode Startup Script

cd "$(dirname "$0")" || exit 1

echo "=================================================="
echo " Riichi Mahjong Scoreboard [Public Server Mode]"
echo "=================================================="

# 1. Check Node.js
if ! command -v node > /dev/null 2>&1; then
  echo " Error: Node.js not found in PATH"
  echo " Termux: pkg install nodejs"
  echo " Linux:  sudo apt install nodejs npm"
  echo " macOS:  brew install node"
  echo "=================================================="
  exit 1
fi

# 2. Check Core Dependencies
if [ ! -d "node_modules/express" ]; then
  echo " Installing core dependencies..."
  npm install --omit=dev || exit 1
fi

# 3. Check Frontend Build for Server Mode
if [ ! -f "frontend/dist/index.html" ] || [ ! -f "frontend/dist/.target_server" ]; then
  echo " Building frontend production assets for Server mode..."
  if [ ! -d "frontend/node_modules" ]; then
    npm run frontend:install || exit 1
  fi
  npm run build:server || exit 1
  rm -f frontend/dist/.target_* 2>/dev/null
  echo "server" > frontend/dist/.target_server
fi

# 4. Start server in Server Mode (Multi-Room Enabled)
export TARGET_ENV=server
exec node server.js --target=server --multi-room
