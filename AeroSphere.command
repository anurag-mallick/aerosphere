#!/bin/bash
# ──────────────────────────────────────────────────────────────
#  AeroSphere — one-click launcher for macOS
#  Double-click this file in Finder (or run ./AeroSphere.command)
# ──────────────────────────────────────────────────────────────

cd "$(dirname "$0")" || exit 1

fail() {
  echo
  echo "❌ $1"
  read -n 1 -s -r -k1 -p "" _ 2>/dev/null || true
  echo "Press any key to close…"
  read -n 1 -s _
  exit 1
}

echo "🛰  AeroSphere — starting…"

# 1. Node.js check
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is required but not installed.
   Install it from https://nodejs.org  or run:  brew install node"
fi

# 2. Dependencies (first run only)
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies (first run only, may take a minute)…"
  npm install || fail "npm install failed — check your internet connection and try again."
fi

# 3. ffmpeg check (needed for export/thumbnails)
if ! command -v ffmpeg >/dev/null 2>&1 \
   && [ ! -x /opt/homebrew/bin/ffmpeg ] \
   && [ ! -x /usr/local/bin/ffmpeg ]; then
  echo "⚠️  ffmpeg not found — importing media and exporting will not work."
  echo "    Install it with:  brew install ffmpeg"
  echo "    Continuing anyway…"
fi

# 4. Launch (vite dev server + Electron, cleaned up together)
echo "🚀 Launching AeroSphere…"
npm run dev
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo
  echo "❌ AeroSphere exited unexpectedly (code $STATUS)."
  echo "   Full logs are shown above."
  read -n 1 -s -r -p "Press any key to close…" _
fi
