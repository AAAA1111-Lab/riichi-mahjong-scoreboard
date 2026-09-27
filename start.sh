#!/bin/sh
# Riichi Mahjong Scoreboard - Forwarder to start-lan.sh
cd "$(dirname "$0")" || exit 1
exec ./start-lan.sh "$@"
