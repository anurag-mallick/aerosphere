// Integration tests: exercise the real export pipeline with real ffmpeg.
// Run with: node tests/integration-export.mjs  (or npm run test:integration)
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import fs from 'node:fs'
import path from 'node:path'
const { runExport, probeFile, extractMetadata } = require('../export-pipeline.js')

const TMP = '/tmp/aero-integration'
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })
let pass = 0, fail = 0
const check = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.error('  ✗ FAIL:', msg) } }
const sh = (cmd) => execFileSync('/bin/bash', ['-c', cmd])

// fixtures
sh(`ffmpeg -y -loglevel error -f lavfi -i "testsrc2=duration=3:size=640x360:rate=24" -pix_fmt yuv420p -c:v libx264 "${TMP}/clipA.mp4"`)
sh(`ffmpeg -y -loglevel error -f lavfi -i "gradients=size=640x360:duration=3:rate=24" -pix_fmt yuv420p -c:v libx264 "${TMP}/clipB.mp4"`)

console.log('— two-track export with overlap —')
{
  const OUT = `${TMP}/two-track.mp4`
  const r = await runExport({
    outputPath: OUT, width: 320, height: 180, fps: 24,
    videoTracks: [
      { clips: [{ kind:'video', path:`${TMP}/clipA.mp4`, name:'A', position:0, trimIn:0, duration:3 }] },
      { clips: [{ kind:'video', path:`${TMP}/clipB.mp4`, name:'B', position:1, trimIn:0, duration:3 }] },
    ],
    musicClips: [],
  })
  check(r.ok, `export ok (${r.error ?? ''})`)
  const meta = extractMetadata(await probeFile(OUT))
  // A[0..3] + B[1..4] → total extent = 4s
  check(meta.duration >= 3.5 && meta.duration <= 4.5, `duration ≈4s (${meta.duration.toFixed(2)})`)
}

console.log('— gap export (black filler) —')
{
  const OUT = `${TMP}/gap.mp4`
  const r = await runExport({
    outputPath: OUT, width: 320, height: 180, fps: 24,
    videoTracks: [
      { clips: [
        { kind:'video', path:`${TMP}/clipA.mp4`, name:'A', position:0, trimIn:0, duration:2 },
        { kind:'video', path:`${TMP}/clipB.mp4`, name:'B', position:4, trimIn:0, duration:2 },
      ]},
    ],
    musicClips: [],
  })
  check(r.ok, `export ok`)
  const meta = extractMetadata(await probeFile(OUT))
  check(meta.duration >= 5.5 && meta.duration <= 6.5, `duration ≈6s incl gap (${meta.duration.toFixed(2)})`)
}

console.log('— dissolve export —')
{
  const OUT = `${TMP}/dissolve.mp4`
  const r = await runExport({
    outputPath: OUT, width: 320, height: 180, fps: 24,
    videoTracks: [
      { clips: [
        { kind:'video', path:`${TMP}/clipA.mp4`, name:'A', position:0, trimIn:0, duration:3 },
        { kind:'video', path:`${TMP}/clipB.mp4`, name:'B', position:3, trimIn:0, duration:3, dissolveIn:1 },
      ]},
    ],
    musicClips: [],
  })
  check(r.ok, `export ok`)
  const meta = extractMetadata(await probeFile(OUT))
  check(meta.duration >= 5.5 && meta.duration <= 6.5, `duration ≈6s with dissolve (${meta.duration.toFixed(2)})`)
}

console.log(`\nINTEGRATION: ${fail === 0 ? 'ALL PASS ✅' : 'FAILURES'} — ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
