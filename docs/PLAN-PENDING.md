# Pending Work — Continuation Plan

> Updated: 2026-08-24 (late session)
> Baseline: all 66 unit/integration tests green, build clean, synthetic e2e 23/23,
> real-footage e2e 12/16 with known driver bugs (below).

## 1. Real X3 footage — remaining e2e gaps (highest priority)

Status from `scripts/e2e-real.mjs` runs against `Demo video/`:

✅ Verified working with the user's real footage:
- import + `.insv` → 360°/dfisheye auto-detection
- lens-pair collapse (`_00_` + `_10_` → one entry, `pairedPath` set)
- 77.5s clip on timeline, proxy playback advances (1.06s/1.2s)
- WebGL dfisheye viewport renders REAL footage with detail (σ=25.6)
- drag-pan changes the rendered view
- **direct pipeline export of real insv works** — 4s keyframed reframe
  → `/tmp/opencode/real-pipeline.mp4` (4.27s, 6.4MB, verified)
- an earlier full app-path export also produced 10.4s 1080p output

Pending:
- [ ] **App-path export of the PAIRED insv hangs >8 min** — the combine-pair
  step (549+545MB) has no progress reporting and blocks `exportTo`.
  Fix: surface combine progress through `onExportProgress` (new stage),
  and/or cache the combined master next to the source (reuse on re-export).
- [ ] Re-run driver after the toggle-sequencing fix (seek inside clip before
  flipping ⚡→🎞; fix is already committed in the driver).
- [ ] Investigate the **0-byte `*-stitch-1536x768.mp4`** artifact in `Demo video/`
  — a past stitch failed silently; check stitch error handling/cleanup.

## 2. Big-file handling (4–5GB requirement)

- Architecture is streaming-safe (audited: no full-file reads; media:// uses
  Range + createReadStream; ffmpeg children stream).
- [ ] Finish generating the 4.6GB test file: base encode kept failing due to
  shell-kill of background jobs — base353.mp3 approach: encode 80s CBR testsrc2
  (353MB, verified working once) then `concat -c copy` ×13 → ~4.6GB.
- [ ] Test matrix on the huge file: import (metadata+thumbnail), seek to 90%,
  play 3s, export 3s window, renderer heap stays bounded
  (`performance.memory.usedJSHeapSize` before/after).
- [ ] Optional: show file-size warning in UI when source >2GB and no proxy yet.

## 3. Parallel export + H.265 (DONE this session — verify & keep)

✅ Implemented:
- Segment rendering now runs on a bounded worker pool
  (`min(cpus-1, 6)` concurrent ffmpeg children, `-threads` split per job,
  concat order preserved by construction). 8s keyframed 360 export: 2.2s.
- Default export format → `mp4-hevc` (libx265, `-tag:v hvc1`).
- Proxies now encode libx265/crf26/hvc1 (old h264 proxies remain compatible —
  the media:// swap is format-agnostic).
- `runExport` resolves all input/output paths to absolute (ffmpeg children
  with different cwd no longer break on relative paths / spaces).

Pending:
- [ ] Benchmark note: capture before/after timings for a long multi-span
  360 export into the README.
- [ ] Consider pool concurrency setting exposed in Export dialog (advanced).

## 4. Preview quality toggle (implemented, verify)

✅ Implemented: ⚡/🎞 button in transport bar; `?q=full` bypasses the proxy
swap in media://; preference persisted (`aero.previewQuality`); engine
re-swaps src on change.
- [ ] Re-run real-footage driver (with fixed sequencing) to assert
  `currentSrc` contains `q=full` and playback advances at full quality.

## 5. Housekeeping

- [ ] Revoke the GitHub token exposed in early-session logs (still pending!).
- [ ] `docs/PLAN-360-VIEWPORT.md` — mark phases complete + mini-map done.
- [ ] README: document demo fixtures (`scripts/make-demo-media.sh`), the two
  e2e drivers, and the proxy/full-quality toggle.

## How to resume

```bash
cd ~/Desktop/Hacker_Bhai/video-editor
./scripts/make-demo-media.sh          # synthetic fixtures (if needed)
npx vite --port 3000 &                # dev server
npx electron . --remote-debugging-port=9333 &
node scripts/e2e-ui.mjs 9333 "$(pwd)/public/demo" /tmp/opencode/e2e-export.mp4
node scripts/e2e-real.mjs 9333 "$(pwd)/Demo video" /tmp/opencode/real-export.mp4
npm test                              # 66 tests
```
