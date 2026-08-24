#!/bin/bash
# Generates demo media used by e2e harness + export pipeline tests.
# Outputs into public/demo/ (raw assets served by vite dev server).
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FFMPEG:-/opt/homebrew/bin/ffmpeg}
OUT=public/demo
mkdir -p "$OUT"

echo "— flat clip with audio —"
$FF -y -loglevel error -f lavfi -i "testsrc2=duration=6:size=1280x720:rate=24" \
    -f lavfi -i "sine=frequency=440:duration=6" \
    -pix_fmt yuv420p -c:v libx264 -c:a aac -shortest "$OUT/demo-flat.mp4"

echo "— labeled equirectangular (2048x1024) —"
# center vertical stripe marks the FRONT direction (yaw 0); dark top band = up,
# light bottom band = down; plain background elsewhere.
$FF -y -loglevel error -f lavfi \
  -i "color=c=0x2a5d8f:s=2048x1024:d=8:r=24" \
  -vf "\
drawbox=x=924:y=0:w=200:h=1024:color=white@0.55:t=fill,\
drawbox=x=0:y=0:w=2048:h=200:color=black@0.75:t=fill,\
drawbox=x=0:y=824:w=2048:h=200:color=white@0.85:t=fill,\
drawtext=text='FRONT':fontsize=120:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2,\
drawtext=text='UP':fontsize=90:fontcolor=0x88aaff:x=(w-text_w)/2:y=40,\
drawtext=text='DOWN':fontsize=90:fontcolor=black:x=(w-text_w)/2:y=h-th-40" \
  -pix_fmt yuv420p -c:v libx264 "$OUT/demo-equirect.mp4"

echo "— synthetic dual-fisheye square (1440x1440) —"
# right circle (front lens) = red core w/ white centre dot, left circle = blue,
# outside circles = black. Matches Preview360Viewport lensUV centres/radius.
$FF -y -loglevel error -f lavfi \
  -i "color=c=black:s=1440x1440:d=8:r=24,format=gbrp" \
  -vf "\
geq=r='between(hypot(X-W*0.75,H/2),0,W*0.25)*255':\
g='between(hypot(X-W*0.75,H/2),20,W*0.25-20)*180+between(hypot(X-W*0.75,H/2),0,30)*255':\
b='between(hypot(X-W*0.25,H/2),0,W*0.25)*255',format=yuv420p" \
  -c:v libx264 "$OUT/demo-dfisheye.mp4"

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
