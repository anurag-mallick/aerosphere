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
- **Dual-file stitching** — importing either lens file auto-pairs both X3 `.insv` files into one 360° item; 🌐 **Stitch** renders a true equirectangular master (Preview 1536×768 / Standard 3840×1920 / Master 5760×2880 HEVC) with adjustable lens FOV (default 220°)
- If the paired lens file is missing, the solo file imports as a single-lens view
- Big-file friendly: masters use HEVC + faststart, and the camera's own LRV preview is remuxed instantly into a playback proxy for smooth scrubbing
- Live **view overlay** in the preview showing exactly what the virtual camera sees

### DJI Mini 5 Pro / drone workflows
- **D-Log M normalization** — one-click approximate Rec.709 conversion, plus custom `.cube` LUT support
- **Telemetry SRT burn-in** — auto-detects the `.srt` flight-data file recorded next to your video and burns it into the export
- **Two-pass stabilization** (FFmpeg vidstab) for shaky flights
- Color controls: brightness, contrast, saturation, **temperature & tint**
- Per-clip **fade in/out** and **volume**, plus full clip **mute**

### General editor
- Multi-track timeline (video/photo tracks + any number of audio tracks)
- Trim, **split at playhead (`S`)**, **duplicate** (`⌘D`), drag-to-move with snapping, zoom
- **Cross-dissolves** between adjacent clips (set per-clip dissolve length)
- **Ken Burns** slow-zoom on photos
- Jump between timeline markers with arrow keys
- **Undo / redo** (`⌘Z` / `⇧⌘Z`) across the whole project
- **Timeline markers** (`M`) on the ruler — click to jump, right-click to delete
- **Per-clip rotation** — quarter-turn 0°/90°/180°/270° for any clip or section
- **Text titles** — burned-in overlays with size/top-bottom positioning and live preview
- **Speed ramps** (0.25× – 4×) with pitch-corrected audio
- Per-clip volume, fades and full mute
- Simultaneous multi-audio playback and mixing
- Real-time preview with master-clock A/V sync
- Project persistence + schema versioning/migrations
- Crash-safe UI: an error boundary keeps one bad panel from white-screening the editor

### Color grading (Resolve Color-page inspired)
- **Lift / Gamma / Gain RGB wheels** — 9-parameter shadows/midtones/highlights balance
- **Vignette** and **sharpen/blur** look sliders
- **Copy/paste grade** — carry color + log normalization + LUT between clips
- Gamma, temperature, tint, brightness, contrast, saturation
- D-Log M normalization and custom `.cube` LUTs

### Audio suite (Fairlight/Voice-Isolation inspired)
- **Voice isolation** — FFmpeg noise reduction for windy drone audio
- **Loudness normalization** to −16 LUFS broadcast standard
- **Music auto-ducking** — music automatically dips under dialogue via sidechain compression
- **3-band style EQ** — bass/treble shelves ±12 dB
- **De-hummer** — 50 Hz / 60 Hz mains removal
- Any number of audio tracks playing simultaneously

### Proxy editing (Edit page inspired)
- One-click **⚡ proxy generation** (480p H.264 sibling file)
- The player transparently serves the proxy whenever it exists — smooth scrubbing of 5.7K/4K footage on modest machines; exports always use the original media

### Export & delivery
- **Delivery presets** — YouTube 1080p/4K/Shorts, Instagram Feed 4:5 / Reels / Square, Facebook Feed/Reels, cinematic master, H.265 archive
- **Output format choice**: MP4 (H.264 or H.265), WebM (VP9), MOV (H.264) and ProRes 422 editing masters
- Manual control of resolution, frame rate (24–60 fps)
- Background music mixing, live progress with cancel support

| Platform | Preset |
| --- | --- |
| YouTube | 1080p · 4K · Shorts (vertical) |
| Instagram | Feed 4:5 (1080×1350) · Reels/Stories (vertical) · Square |
| Facebook | Feed HD/1080p · Reels (vertical) |
| Masters | Cinematic ProRes · H.265 archive |

---

## 🚀 Getting started (macOS)

**Requirements:** [Node.js](https://nodejs.org) ≥ 18 and [ffmpeg](https://ffmpeg.org)
(`brew install node ffmpeg`)

### Import media
- **Drag & drop** video / photo / audio files — or entire folders — anywhere onto the window
- **📁 Import folder…** scans a directory recursively
- Per-file pickers in each library section
- Insta360 X3 dual-lens `.insv` pairs auto-merge into one 360° item

### Session behavior
Projects live for the current session only — quitting or closing AeroSphere
resets everything to a clean slate on next launch (by design).

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

Keyboard: `Space` play/pause · `S` split · `⌘D` duplicate · `M` marker · `←`/`→` jump markers · `⌘Z`/`⇧⌘Z` undo·redo · `Delete` remove · `⇧Delete` ripple delete · `?` help · `Esc` deselect

---

## 🧪 Development

```bash
npm run typecheck   # TypeScript
npm test            # vitest unit tests (keyframe math, pipeline helpers)
npm run build       # production bundle
```

CI (GitHub Actions) runs typecheck + tests + build on macOS and Ubuntu for every push/PR.

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
