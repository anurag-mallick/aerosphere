# Item 7 — WebGL 360° Dewarped Viewport — Implementation Plan

> **Status:** PLANNED — not started
> **Estimated effort:** 45–90 min (AI agent) / 1–2 days (human)
> **Dependency:** `three` + `@types/three` already installed in package.json
> **Blocks:** nothing — additive feature, existing flat preview stays as fallback

---

## Goal

Replace the raw distorted `.insv` / equirect video shown in PreviewPlayer.tsx with a real-time
dewarped 360° viewport when the active clip is a 360° source (`clip.is360 === true`).
User can click-drag to look around, scroll to zoom, and see keyframe markers on a mini-map.

---

## Architecture

```
PreviewPlayer.tsx
  ├── <video ref={videoRef}>           ← hidden, plays source via media:// protocol
  ├── { is360Source && <Preview360Viewport videoRef={videoRef} ... /> }
  │     └── WebGLRenderer + Scene + PerspectiveCamera + SphereGeometry
  │         ├── projection='equirect' → standard sphere UV mapping
  │         └── projection='dfisheye' → custom fragment shader (dual-fisheye unwrap)
  └── flat <video> path unchanged for non-360 clips
```

### Key design decision: shader-based vs canvas-based fisheye unwrap

| Approach | Pros | Cons |
|---|---|---|
| **GLSL fragment shader** | Real-time, GPU-accelerated, pixel-perfect match with export | Complex GLSL, harder to debug |
| **Offscreen canvas 2D** | Simpler, easier to debug | Not real-time for large frames |

**Decision: GLSL fragment shader** — the export uses `v360=dfisheye:e` which is a per-pixel
projection; only a shader can replicate this at interactive framerates.

---

## Files to create/modify

| File | Action | Est lines |
|---|---|---|
| `src/components/Preview360Viewport.tsx` | **CREATE** — three.js scene + camera + interaction | ~250 |
| `src/components/shaders/fisheye-unwrap.frag.ts` | **CREATE** — GLSL dual-fisheye→equirect fragment shader | ~40 |
| `src/components/shaders/equirect.frag.ts` | **CREATE** — simple equirect→flat fragment shader | ~15 |
| `src/components/PreviewPlayer.tsx` | **MODIFY** — conditionally render viewport, pass props | ~30 changed |
| `src/App.tsx` | **MODIFY** — pass `onPanTiltChange` callback to PreviewPlayer → Inspector | ~10 changed |
| `src/components/Inspector.tsx` | **MODIFY** — accept external pan/tilt updates from viewport drag | ~5 changed |

---

## Implementation steps (in order)

### Step 1: Basic sphere + video texture (equirect sources)
- `THREE.WebGLRenderer` with `alpha:false`, `antialias:true`
- `THREE.SphereGeometry(500, 64, 48)` with `scale(-1,1,1)` for inward-facing
- `THREE.VideoTexture(videoElement)` mapped onto sphere
- `THREE.PerspectiveCamera(fov=90, aspect, 0.1, 1100)` at origin `(0,0,0)`
- Render loop via `requestAnimationFrame`
- Camera rotation from props: `camera.rotation.set(tiltRad, panRad, rollRad, 'YXZ')`
- FOV: `camera.fov = fovDegrees; camera.updateProjectionMatrix()`

### Step 2: Dual-fisheye shader (raw .insv sources)
For `projection='dfisheye'`, use a custom `ShaderMaterial` instead of `VideoTexture`:

```glsl
// Fragment shader concept:
// Input: raw frame (2880x2880 square containing one circular fisheye per lens)
// Output: equirectangular UV coordinate for this pixel on the sphere
//
// For each fragment on the sphere:
//   1. Compute world direction (from sphere normal)
//   2. Convert to yaw angle relative to lens center
//   3. If |yaw - lensCenterYaw| < fov/2 → sample from this lens's circle
//   4. Map angular coordinates to UV within the lens circle
//   5. Blend at overlap zones (~10° overlap between lenses)

uniform sampler2D map;      // video texture
uniform float lensFov;       // degrees, default 220 for X3
uniform float lensSeparation; // radians between lens centers (π for X3)
varying vec3 worldDir;       // computed in vertex shader
```

**Critical math:** the dual-fisheye-to-equirect mapping must match what
`keyframe-filter.js::reframeFilterAt()` produces server-side via `v360=dfisheye:e:id_fov=...`.
Any mismatch means preview ≠ export.

**Calibration:** Lens FOV defaults to 220° (adjustable via Inspector slider).
If stitch looks warped, user adjusts FOV — same value flows to both preview and export.

### Step 3: Interaction handlers
```tsx
// On mousedown+move inside viewport:
//   deltaX → Δpan (degrees, scaled by current fov for natural feel)
//   deltaY → Δtilt (clamped ±90°)
// On wheel:
//   deltaY → Δfov (clamped 20..140 for 360, or 1..4 zoom for flat)
// On shift+move:
//   deltaX → Δroll
```

These call the SAME `onUpdateClip({ keyframes: [...] })` path that Inspector sliders use.
When no keyframe exists at playhead, auto-create one (same logic as Inspector's "+ At playhead").

### Step 4: Mini-map path indicator
Small canvas overlay (200×100px) in corner showing:
- Equirectangular grid (2:1 rectangle)
- Keyframe positions plotted as dots connected by the interpolated path
- Current playhead position as a pulsing dot
- Clickable to jump playhead to a keyframe position

This replaces/supplements the yellow viewRect rectangle currently drawn by PreviewPlayer.

### Step 5: Fallback
```tsx
const [webglSupported, setWebglSupported] = useState(true)

useEffect(() => {
  try {
    const testCanvas = document.createElement('canvas')
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl')
    if (!gl) setWebglSupported(false)
  } catch { setWebglSupported(false) }
}, [])

if (!webglSupported) return <FallbackFlatVideo {...props} />
```

Show a small notice: "WebGL unavailable — showing raw footage"

---

## Integration points with existing code

### Props flowing INTO Preview360Viewport:
```ts
interface Preview360ViewportProps {
  /** the hidden <video> element playing source media */
  videoTextureSource: HTMLVideoElement
  /** which layout the source frames use */
  projection: 'dfisheye' | 'equirect'
  /** X3 lens FOV for dfisheye unwrapping (default 220) */
  lensFov: number
  /** current virtual camera state — drives camera rotation + fov */
  pan: number    // degrees
  tilt: number   // degrees
  roll: number   // degrees
  fov: number    // vertical FOV degrees (20..140)
  /** called when user drags/scrolls — writes back to clip keyframes */
  onViewChange?: (pan: number, tilt: number, fov: number) => void
}
```

### Data flow:
```
Inspector sliders ──┐
                     ├──▶ clip.keyframes[] ──▶ interpolateChannel(currentTime)
Viewport drag ──────┘                              │
                                                    ▼
                                          interpolated pan/tilt/roll/fov
                                                    │
                                                    ▼
                                         Preview360Viewport camera
                                         (three.js rotation + fov)
```

### What NOT to change:
- `usePlaybackEngine.ts` — master clock stays unchanged
- `PreviewPlayer.tsx` transport bar — unchanged
- `Timeline.tsx` — unchanged
- Export pipeline — already renders correctly via `buildReframePlan`

---

## Known pitfalls from today's debugging session

1. **ffmpeg filter expression escaping**: colons (`:`) in filter expressions must be
   escaped as `\\:` in argv. Ternary operators work but function calls don't.
   This is why we use static segment sampling instead of animated expressions.
   → The GLSL shader approach avoids this entirely since it runs client-side.

2. **Electron protocol handler corruption**: an earlier scripted edit pasted IPC
   registrations INSIDE registerMediaProtocol's try-block. Always verify file
   integrity after bulk edits.

3. **v360 input token**: must be `dfisheye:e` (not `e:dfisheye`). The output
   projection comes second. `id_fov` applies only to the fisheye input.

4. **Segmented rendering**: export renders ~0.4s static-camera segments then
   concatenates. This avoids ffmpeg expression evaluation limitations but means
   the preview (real-time) and export (segmented) may differ slightly in
   motion smoothness. Acceptable for now.

5. **File.path removal**: Electron ≥32 removed File.path. Use
   `window.electronAPI.getPathForFile(file)` in drop handlers.

6. **media:// URL with spaces**: paths are encodeURIComponent'd once by the
   renderer and decoded once by the protocol handler. Double-decoding causes
   failures. Test with paths containing spaces.

---

## Testing strategy

### Automated (CDP):
1. Seed 360 clip → verify WebGL canvas exists and has non-zero pixels
2. Set pan=90 via Inspector slider → screenshot → sample center pixel color changes
3. Drag inside viewport (synthetic mouse events) → verify keyframe created
4. Scroll wheel → verify fov changes
5. Verify fallback shows when WebGL disabled (override getContext)

### Manual:
1. Import real X3 pair → select 360 clip → verify dewarped preview looks correct
2. Add two keyframes with different pan values → scrub playhead → verify smooth panning
3. Apply Tiny Planet preset → verify visual effect matches Insta360 Studio
4. Export → compare output frame with preview at same timestamp

---

## Rollback plan

If WebGL viewport proves too unstable or visually incorrect:
- Remove `<Preview360Viewport>` from PreviewPlayer.tsx
- Keep `computeViewRect()` overlay (yellow rectangle) as before
- Keep numeric Inspector sliders for reframing control
- Export pipeline is unaffected (already working independently)
