# 🛰 AeroSphere

**A unified video editor for DJI drone footage and Insta360 X3 360° cameras — built with Electron, React and FFmpeg.**

AeroSphere brings both of your camera ecosystems into one desktop editor: reframe 360° footage with keyframed virtual-camera moves, grade D-Log drone clips, burn flight-telemetry overlays, ramp speeds, stabilize shaky passes and export for any screen — vertical, square or cinematic.

---

## ✨ Features

### Insta360 X3 / 360° workflows
- **Keyframed reframing** — set yaw / pitch / roll / FOV keyframes on the timeline; smooth eased motion between them
- **Perspective presets** — Natural, Wide, Ultra Wide, Narrow, Fisheye, Tiny Planet, Crystal Ball
- **Lens FOV control** — tune dual-fisheye input calibration per clip
- **Auto-detection** of `.insv` and 2:1 equirectangular sources
- Live **view overlay** in the preview showing exactly what the virtual camera sees

### DJI Mini 5 Pro / drone workflows
- **D-Log M normalization** — one-click approximate Rec.709 conversion, plus custom `.cube` LUT support
- **Telemetry SRT burn-in** — auto-detects the `.srt` flight-data file recorded next to your video and burns it into the export
- **Two-pass stabilization** (FFmpeg vidstab) for shaky flights
- Color controls: brightness, contrast, saturation, **temperature & tint**
- Per-clip **fade in/out** and **volume**, plus full clip **mute**

### General editor
- Multi-track timeline (video/photo tracks + any number of audio tracks)
- Trim, **split at playhead (`S`)**, drag-to-move with snapping, zoom
- **Speed ramps** (0.25× – 4×) with pitch-corrected audio
- Simultaneous multi-audio playback and mixing
- Real-time preview with master-clock A/V sync
- Keyframe markers rendered directly on clips
- Project persistence across sessions

### Export
- Resolution presets grouped by orientation: landscape up to 4K, vertical/social (1080×1920), square, cinematic 2.39:1
- Frame rate choice: 24 / 25 / 30 / 50 / 60 fps
- Encoder choice: H.264 or H.265/HEVC
- Background music mixing with per-track delay
- Live progress with cancel support

---

## 🚀 Getting started (macOS)

**Requirements:** [Node.js](https://nodejs.org) ≥ 18 and [ffmpeg](https://ffmpeg.org)
(`brew install node ffmpeg`)

### Launch like a normal app
Double-click **`AeroSphere.command`** in Finder.

- **First run:** it installs dependencies, builds a native
  **`AeroSphere.app`**, and opens it — then closes the Terminal.
- **Every run after:** the `.app` opens instantly, no Terminal involved.

Once built you'll find the real application at
`release/mac-arm64/AeroSphere.app` — feel free to drag it into
`/Applications` or your Dock and delete nothing else; the launcher will
keep finding it.

### From the terminal
```bash
./start.sh          # developer mode: vite dev server + electron together
```

Manual commands:
```bash
npm install         # once
npm run dev         # dev mode (hot reload)
npm run build       # production renderer bundle
npm run package:mac # build release/mac-arm64/AeroSphere.app
npm run package     # full distributable (.dmg)
```

> Windows/Linux: `npm run dev` works anywhere Node + ffmpeg exist;
> `AeroSphere.command` and the `.app` bundle are macOS-specific.

---

## 🧭 Quick tour

| Action | How |
| --- | --- |
| Import media | Library → **Import** (`.insv`, `.mp4`, images, music) |
| Add to timeline | **+ Timeline** on any library item |
| Select / move | click & drag clips |
| Trim | drag either edge of a clip |
| Split | select clip → place playhead → **✂ Split** or press `S` |
| Reframe 360° | select clip → add keyframes → drag sliders or apply presets |
| Speed ramp | Inspector → Speed (0.25×–4×) |
| Stabilize drone shot | Inspector → *Stabilize* |
| Normalize D-Log | Inspector → *Log / LUT* |
| Burn telemetry | Inspector → *Telemetry SRT* (auto-detected) |
| Export | **Export Movie** → resolution / fps / encoder → Save |

Keyboard: `Space` play/pause · `S` split · `Delete` remove clip · `Esc` deselect

---

## 🏗 Architecture notes

- **Electron main process** owns all media work: ffprobe metadata, thumbnail
  extraction, `.insv` remuxing and a segmented export pipeline
  (`export-pipeline.js`) that renders keyframed reframing as short
  static-camera spans, concatenates losslessly, then mixes audio
- `keyframe-filter.js` builds virtual-camera plans (v360 dual-fisheye→flat,
  animated crop for flat sources)
- **Renderer** is React + TypeScript with a custom master-clock playback
  engine (`usePlaybackEngine`) supporting pooled simultaneous audio
- A privileged `media://` protocol streams local files into the sandboxed
  renderer with HTTP Range support

## ⚠️ Known limitations

- Dual-fisheye → flat conversion uses default lens calibration (adjustable
  via Lens FOV); pixel-perfect stitching requires manufacturer calibration data
- AI subject tracking (Insta360 Deep Track) is not implemented
- Reframing motion is sampled (~0.4 s steps) during render for smoothness

---

## 👤 Author

Built with ❤️ by **Anurag Mallick**

🔗 GitHub — [github.com/anurag-mallick](https://github.com/anurag-mallick)

---

## 📄 License

MIT
