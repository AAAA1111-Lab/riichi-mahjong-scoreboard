#!/bin/sh
# Riichi Mahjong Scoreboard - Forwarder to start-server.sh
cd "$(dirname "$0")" || exit 1
exec ./start-server.sh "$@"
