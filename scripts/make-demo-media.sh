#!/bin/bash
# Generates demo media used by e2e harness + export pipeline tests.
# Outputs into public/demo/ (raw assets served by vite dev server).
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FFMPEG:-$(command -v ffmpeg || echo /opt/homebrew/bin/ffmpeg)}
OUT=public/demo
mkdir -p "$OUT"

echo "— flat clip with audio —"
$FF -y -loglevel error -f lavfi -i "testsrc2=duration=6:size=1280x720:rate=24" \
    -f lavfi -i "sine=frequency=440:duration=6" \
    -pix_fmt yuv420p -c:v libx264 -c:a aac -shortest "$OUT/demo-flat.mp4"

echo "— labeled equirectangular (2048x1024) —"
# center vertical stripe marks the FRONT direction (yaw 0); dark top band = up,
# light bottom band = down; plain background elsewhere.
# (drawbox only — drawtext needs fontconfig/fonts which CI runners lack;
#  the stripe/bands are the pixel-probe ground truth used by tests)
$FF -y -loglevel error -f lavfi \
  -i "color=c=0x2a5d8f:s=2048x1024:d=8:r=24" \
  -vf "\
drawbox=x=924:y=0:w=200:h=1024:color=white@0.55:t=fill,\
drawbox=x=0:y=0:w=2048:h=200:color=black@0.75:t=fill,\
drawbox=x=0:y=824:w=2048:h=200:color=white@0.85:t=fill" \
  -pix_fmt yuv420p -c:v libx264 "$OUT/demo-equirect.mp4"

echo "— dual-fisheye square (1440x1440) via v360 e->dfisheye —"
# Project the labeled equirect through ffmpeg's own dfisheye output so the
# fixture uses the exact same projection convention as the export pipeline
# (v360=dfisheye:e). Lens circles land at x=0.25W/0.75W, r=0.25W,
# right circle = front (yaw 0), left = back. 220° diagonal fov like X3.
$FF -y -loglevel error -i "$OUT/demo-equirect.mp4" \
  -vf "v360=e:dfisheye:d_fov=220:w=1440:h=1440" \
  -pix_fmt yuv420p -c:v libx264 "$OUT/demo-dfisheye.mp4"

echo "— subtitles + music —"
cat > "$OUT/demo.srt" <<'SRT'
1
00:00:00,500 --> 00:00:02,500
Hello from the demo telemetry track

2
00:00:03,000 --> 00:00:05,500
Second subtitle line
SRT

$FF -y -loglevel error -f lavfi -i "sine=frequency=220:duration=4" \
    -ac 2 -c:a aac "$OUT/demo-music.m4a"

echo "done:"
ls -la "$OUT"
