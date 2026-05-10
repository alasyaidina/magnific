#!/usr/bin/env bash
# ============================================================
#   Magnific Kling 2.6 Motion Control - one-click launcher
#   On Linux: double-click and choose "Run" / "Run in
#   Terminal" (depending on your file manager), or run from
#   a terminal with: ./Start\ Magnific.sh
# ============================================================

set -e

cd "$(dirname "$0")"

echo
echo "===================================================="
echo "  Magnific Kling 2.6 Motion Control"
echo "===================================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found on this system."
  echo
  echo "Please install Node.js 20 or newer from:"
  echo "  https://nodejs.org/"
  echo
  read -rp "Press Enter to close this window..." _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First-time setup: installing dependencies. This only happens once"
  echo "and may take a few minutes..."
  echo
  if ! npm install; then
    echo
    echo "[ERROR] npm install failed. See the messages above."
    read -rp "Press Enter to close this window..." _
    exit 1
  fi
fi

echo "Launching the app... (this window stays open while the app is running)"
echo "Close this window or press Ctrl+C to stop the app."
echo

npm run dev
