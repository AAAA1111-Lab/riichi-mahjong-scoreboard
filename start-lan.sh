#!/bin/sh
# Riichi Mahjong Scoreboard - Linux / Termux / macOS LAN Mode Startup Script

cd "$(dirname "$0")" || exit 1

echo "=================================================="
echo " Riichi Mahjong Scoreboard [LAN Mode]"
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

# 3. Check Frontend Build for LAN Mode
if [ ! -f "frontend/dist/index.html" ] || [ ! -f "frontend/dist/.target_lan" ]; then
  echo " Building frontend production assets for LAN mode..."
  if [ ! -d "frontend/node_modules" ]; then
    npm run frontend:install || exit 1
  fi
  npm run build || exit 1
  rm -f frontend/dist/.target_* 2>/dev/null
  echo "lan" > frontend/dist/.target_lan
fi

# 4. Start server in LAN Mode (Modules Disabled)
export TARGET_ENV=lan
exec node server.js --target=lan --no-modules
