#!/bin/bash
# ──────────────────────────────────────────────────────────────
#  AeroSphere — macOS launcher
#
#  • If AeroSphere.app is already built  → opens it like a normal app
#  • Otherwise → builds it once (needs internet for first run),
#    then opens it. Falls back to dev mode if building is impossible.
#
#  Works double-clicked from Finder or from a terminal.
# ──────────────────────────────────────────────────────────────

cd "$(dirname "$0")" || exit 1

APP_PATHS=(release/mac-arm64/AeroSphere.app release/mac/AeroSphere.app)

find_app() {
  for p in "${APP_PATHS[@]}"; do
    [ -d "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}

pause() {
  echo
  read -n 1 -s -r -p "Press any key to close…"
  echo
}

fail() {
  echo
  echo "❌ $1"
  pause
  exit 1
}

open_app() {
  echo "🚀 Opening AeroSphere.app …"
  open "$1"
}

# Already packaged? Just launch it — no Terminal needed afterwards.
if APP_PATH=$(find_app); then
  open_app "$APP_PATH"
  exit 0
fi

echo "🛰  AeroSphere — first-time setup (one time only)"

command -v node >/dev/null 2>&1 || fail "Node.js is required.
Install from https://nodejs.org or run: brew install node"

if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies (may take a minute)…"
  npm install || fail "npm install failed — check your connection and retry."
fi

command -v ffmpeg >/dev/null 2>&1 || [ -x /opt/homebrew/bin/ffmpeg ] \
  || echo "⚠️  ffmpeg not found — export/import will need it later. Install with: brew install ffmpeg"

echo "🏗  Building AeroSphere.app (this happens only once, ~1-2 min)…"
export CSC_IDENTITY_AUTO_DISCOVERY=false   # skip Apple signing for local builds
npm run package:mac || {
  echo
  echo "⚠️  Packaging failed — falling back to developer mode."
  echo "    (You can still use the app; a Terminal window will stay open.)"
  npm run dev
  exit 0
}

[ -d "$APP_PATH" ] || APP_PATH=$(find_app) || fail "Build finished but the app was not found."

echo
echo "✅ Done! AeroSphere.app is at:"
echo "   $(pwd)/$APP_PATH"
echo "   Tip: drag it into /Applications for easy access."
echo
open_app "$APP_PATH"
exit 0
