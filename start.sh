#!/bin/bash
# AeroSphere — terminal launcher (macOS / Linux)
cd "$(dirname "$0")" || exit 1

command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required (https://nodejs.org)"; exit 1; }

[ -d node_modules ] || { echo "📦 Installing dependencies…"; npm install || exit 1; }

command -v ffmpeg >/dev/null 2>&1 || [ -x /opt/homebrew/bin/ffmpeg ] || {
  echo "⚠️  ffmpeg not found — run 'brew install ffmpeg' for full functionality"
}

exec npm run dev
