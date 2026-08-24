import * as THREE from 'three'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipKeyframe } from '../types/editor'

export interface Preview360ViewportProps {
  /** the visible <video> element playing source media (hidden while viewport active) */
  videoEl: HTMLVideoElement | null
  /** interpolated camera state for the current playhead */
  pan: number
  tilt: number
  roll: number
  fov: number
  /** frame layout of this 360° source */
  projection?: 'dfisheye' | 'equirect'
  /** lens FOV of the dual-fisheye source (default 220 for X3) */
  lensFov?: number
  /** clip-relative time — drives mini-map playhead marker */
  clipTime?: number
  /** clip duration — normalises mini-map path progress */
  clipDuration?: number
  /** keyframes for this clip — drawn as path on the mini-map */
  keyframes?: ClipKeyframe[]
  /** user dragged/scroll- zoomed the viewport → upsert keyframe at playhead */
  onViewChange?: (pan: number, tilt: number, fov: number) => void
  /** user clicked a keyframe dot on the mini-map → seek clip to that time */
  onSeekClipTime?: (t: number) => void
}

const MINIMAP_W = 200
const MINIMAP_H = 100

/**
 * WebGL 360° dewarped viewport.
 *
 * - projection='equirect': sphere + VideoTexture (stitched sources)
 * - projection='dfisheye': equidistant dual-fisheye unwrap via GLSL,
 *   geometrically matching ffmpeg `v360=dfisheye:e` (two lens circles
 *   side-by-side in a square frame, equidistant r ∝ θ mapping)
 *
 * Interactions write through onViewChange → keyframe upsert at playhead:
 *   drag → pan/tilt · wheel → fov · shift+drag → roll (via onViewChange roll delta)
 *
 * Mini-map overlay: equirect grid, keyframe path + dots (click to jump),
 * live camera-position marker.
 */
export function Preview360Viewport(props: Preview360ViewportProps) {
  const {
    videoEl,
    pan,
    tilt,
    roll,
    fov,
    projection = 'equirect',
    lensFov = 220,
    clipTime = 0,
    clipDuration = 0,
    keyframes,
    onViewChange,
    onSeekClipTime,
  } = props

  // ---- interaction state -------------------------------------------------
  const [dragging, setDragging] = useState(false)
  const dragLastRef = useRef<{ x: number; y: number; shift: boolean } | null>(null)

  // ---- refs: declared with explicit |null so .current stays assignable ----
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const minimapRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)

  // latest view values, read by the rAF loop without re-initialising the scene
  const viewRef = useRef({ pan, tilt, roll, fov })
  viewRef.current = { pan, tilt, roll, fov }

  const minimapDataRef = useRef({
    keyframes: keyframes ?? [],
    clipTime,
    clipDuration,
    camPan: pan,
    camTilt: tilt,
    onViewChange,
    onSeekClipTime,
  })
  minimapDataRef.current = {
    keyframes: keyframes ?? [],
    clipTime,
    clipDuration,
    camPan: pan,
    camTilt: tilt,
    onViewChange,
    onSeekClipTime,
  }

  // ---- debounced onViewChange --------------------------------------------
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emitViewChange = useCallback(
    (p: number, t: number, f: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onViewChange?.(p, t, f), 80)
    },
    [onViewChange]
  )

  // ---- pointer / wheel interactions ---------------------------------------
  const onPointerDown = useCallback((e: PointerEvent) => {
    setDragging(true)
    dragLastRef.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const last = dragLastRef.current
      if (!dragging || !last) return
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      dragLastRef.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey }

      const v = viewRef.current
      if (last.shift) {
        // shift+drag → roll
        const nr = v.roll + dx * 0.2
        viewRef.current = { ...v, roll: ((nr % 360) + 540) % 360 - 180 }
        emitViewChange(viewRef.current.pan, viewRef.current.tilt, viewRef.current.fov)
      } else {
        const np = (((v.pan + dx * 0.15) % 360) + 540) % 360 - 180
        const nt = Math.max(-89.9, Math.min(89.9, v.tilt + dy * 0.15))
        viewRef.current = { ...v, pan: np, tilt: nt }
        emitViewChange(np, nt, v.fov)
      }
    },
    [dragging, emitViewChange]
  )

  const onPointerUp = useCallback(() => {
    setDragging(false)
    dragLastRef.current = null
  }, [])

  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const nf = Math.max(20, Math.min(140, v.fov + e.deltaY * -0.05))
      viewRef.current = { ...v, fov: nf }
      emitViewChange(v.pan, v.tilt, nf)
    },
    [emitViewChange]
  )

  // ---- mini-map click → hit-test keyframe dots ---------------------------
  const onMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { keyframes: kfs, onSeekClipTime: seek } = minimapDataRef.current
      if (!kfs.length || !seek) return
      const rect = e.currentTarget.getBoundingClientRect()
      const sx = rect.width / MINIMAP_W
      const sy = rect.height / MINIMAP_H
      const cx = (e.clientX - rect.left) / sx
      const cy = (e.clientY - rect.top) / sy
      const m = 8 // margin used when drawing
      const gw = MINIMAP_W - 2 * m
      const gh = MINIMAP_H - 2 * m
      for (const kf of kfs) {
        const x = m + (((((kf.pan + 180) % 360) + 360) % 360) / 360) * gw
        const y = m + ((90 - Math.max(-90, Math.min(90, kf.tilt))) / 180) * gh
        if (Math.hypot(cx - x, cy - y) <= 9) {
          seek(kf.time)
          return
        }
      }
    },
    []
  )

  // ---- main effect: scene + single rAF loop (three.js + minimap) ----------
  useEffect(() => {
    const canvas = canvasRef.current
    const minimap = minimapRef.current
    if (!canvas || !minimap || !videoEl) return

    let disposed = false
    let raf = 0

    let renderer: THREE.WebGLRenderer
    try {
      // preserveDrawingBuffer lets automated tests sample rendered pixels
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
    } catch {
      return // WebGL unavailable → leave flat <video> visible
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    const geometry = new THREE.SphereGeometry(500, 96, 64)
    geometry.scale(-1, 1, 1)

    const texture = new THREE.VideoTexture(videoEl)
    texture.colorSpace = THREE.SRGBColorSpace

    let material: THREE.MeshBasicMaterial | THREE.ShaderMaterial
    if (projection === 'dfisheye') {
      material = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: texture },
          lensFovRad: { value: (lensFov * Math.PI) / 180 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            // world-space direction of this sphere fragment (sphere centred on origin)
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform sampler2D map;
          uniform float lensFovRad;
          varying vec3 vDir;
          const float PI = 3.14159265358979;

          // project direction d onto lens whose axis is "axis"
          // returns uv inside that lens circle, or vec2(-1.) when outside fov
          vec2 lensUV(vec3 d, vec3 axis, vec2 centre, float circleR) {
            float dist = acos(clamp(dot(d, axis), -1.0, 1.0));
            float halfFov = lensFovRad * 0.5;
            if (dist > halfFov) return vec2(-1.0);
            float rn = dist / halfFov;                    // equidistant: r ∝ θ
            vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), axis));
            vec3 north = cross(axis, east);
            vec3 perp = d - axis * dot(d, axis);
            float psi = atan(dot(perp, north), dot(perp, east));
            return centre + rn * circleR * vec2(cos(psi), -sin(psi));
          }

          void main() {
            vec3 d = normalize(vDir);

            // X3-style square frame: two circles side by side.
            // right circle = lens facing +Z, left circle = lens facing −Z
            vec3 axisA = vec3(0.0, 0.0, 1.0);
            vec3 axisB = vec3(0.0, 0.0, -1.0);

            vec2 uv = lensUV(d, axisA, vec2(0.75, 0.5), 0.25);
            float wA = uv.x >= 0.0 ? 1.0 : 0.0;
            vec2 uvB = lensUV(d, axisB, vec2(0.25, 0.5), 0.25);
            float wB = uvB.x >= 0.0 ? 1.0 : 0.0;

            if (wA + wB == 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

            vec4 colA = wA > 0.0 ? texture2D(map, clamp(uv, 0.0, 1.0)) : vec4(0.0);
            vec4 colB = wB > 0.0 ? texture2D(map, clamp(uvB, 0.0, 1.0)) : vec4(0.0);

            // soft blend across the overlap zone between the two lenses
            float blend = 0.5;
            gl_FragColor = mix(colB, colA, blend * wA + (1.0 - blend) * wB / max(wA + wB, 0.0001));
          }
        `,
      })
    } else {
      material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide })
    }
    const sphere = new THREE.Mesh(geometry, material)
    scene.add(sphere)

    const camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 1100)

    const resize = () => {
      const w = canvas.clientWidth || 640
      const h = canvas.clientHeight || 360
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    // ---------- mini-map painter ----------
    const mm = minimap.getContext('2d') as CanvasRenderingContext2D | null
    const drawMinimap = () => {
      if (!mm) return
      const d = minimapDataRef.current
      const m = 8
      const gw = MINIMAP_W - 2 * m
      const gh = MINIMAP_H - 2 * m

      mm.fillStyle = 'rgba(10,10,18,0.72)'
      mm.fillRect(0, 0, MINIMAP_W, MINIMAP_H)

      // grid: lon every 45°, lat every 30°
      mm.strokeStyle = 'rgba(255,255,255,0.14)'
      mm.lineWidth = 1
      for (let i = 0; i <= 8; i++) {
        const x = m + (gw / 8) * i
        mm.beginPath(); mm.moveTo(x, m); mm.lineTo(x, m + gh); mm.stroke()
      }
      for (let i = 0; i <= 6; i++) {
        const y = m + (gh / 6) * i
        mm.beginPath(); mm.moveTo(m, y); mm.lineTo(m + gw, y); mm.stroke()
      }

      const px = (panDeg: number) =>
        m + (((((panDeg + 180) % 360) + 360) % 360) / 360) * gw
      const py = (tiltDeg: number) =>
        m + ((90 - Math.max(-90, Math.min(90, tiltDeg))) / 180) * gh

      // keyframe path + dots
      const kfs = [...d.keyframes].sort((a, b) => a.time - b.time)
      if (kfs.length > 0) {
        mm.strokeStyle = 'rgba(255,209,102,0.85)'
        mm.lineWidth = 1.5
        mm.beginPath()
        kfs.forEach((kf, i) => (i === 0 ? mm.moveTo(px(kf.pan), py(kf.tilt)) : mm.lineTo(px(kf.pan), py(kf.tilt))))
        mm.stroke()

        for (const kf of kfs) {
          const near = d.clipDuration > 0 && Math.abs(kf.time - d.clipTime) < 0.35
          mm.fillStyle = near ? '#ffffff' : 'rgba(255,209,102,0.95)'
          mm.strokeStyle = 'rgba(10,10,18,0.9)'
          mm.lineWidth = 1.5
          mm.beginPath()
          mm.arc(px(kf.pan), py(kf.tilt), near ? 5.5 : 4, 0, Math.PI * 2)
          mm.fill()
          mm.stroke()
        }

        // progress along the path (clip-relative time → segment interpolation)
        if (d.clipDuration > 0 && kfs.length > 1) {
          const tt = Math.max(0, Math.min(d.clipDuration, d.clipTime))
          let seg = 0
          while (seg < kfs.length - 2 && kfs[seg + 1].time < tt) seg++
          const a = kfs[seg]
          const b = kfs[seg + 1]
          const span = Math.max(b.time - a.time, 1e-6)
          const k = Math.max(0, Math.min(1, (tt - a.time) / span))
          const mx = px(a.pan + (b.pan - a.pan) * k)
          const my = py(a.tilt + (b.tilt - a.tilt) * k)
          mm.fillStyle = '#ffffff'
          mm.beginPath()
          mm.arc(mx, my, 3.5, 0, Math.PI * 2)
          mm.fill()
        }
      }

      // live camera-position marker (pulsing ring)
      const cx = px(d.camPan)
      const cy = py(d.camTilt)
      const pulse = 3 + Math.sin(performance.now() / 220) * 1.2
      mm.strokeStyle = '#7ee787'
      mm.lineWidth = 1.6
      mm.beginPath()
      mm.arc(cx, cy, pulse + 2.5, 0, Math.PI * 2)
      mm.stroke()
      mm.fillStyle = '#7ee787'
      mm.beginPath()
      mm.arc(cx, cy, 2.4, 0, Math.PI * 2)
      mm.fill()
    }

    // ---------- single render loop ----------
    const loop = () => {
      if (disposed) return
      const v = viewRef.current
      camera.rotation.order = 'YXZ'
      camera.rotation.set(
        (v.tilt * Math.PI) / 180,
        (v.pan * Math.PI) / 180,
        (v.roll * Math.PI) / 180
      )
      if (camera.fov !== v.fov) {
        camera.fov = v.fov
        camera.updateProjectionMatrix()
      }
      if (projection === 'dfisheye') {
        const u = (material as THREE.ShaderMaterial).uniforms.lensFovRad
        u.value = (lensFov * Math.PI) / 180
      }
      renderer.render(scene, camera)
      drawMinimap()
      raf = requestAnimationFrame(loop)
    }
    loop()

    // ---------- listeners ----------
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      texture.dispose()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      rendererRef.current = null
    }
  }, [videoEl, projection, lensFov, onPointerDown, onPointerMove, onPointerUp, onWheel])

  // keyboard focus outline suppression while dragging
  useEffect(() => {
    if (!dragging) return
    const stop = (e: Event) => e.preventDefault()
    document.body.addEventListener('selectstart', stop)
    return () => document.body.removeEventListener('selectstart', stop)
  }, [dragging])

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`preview-360-viewport ${dragging ? 'grabbing' : ''}`}
      />
      <canvas
        ref={minimapRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        className="preview-360-minimap"
        title="Reframing map — click a dot to jump"
        onClick={onMinimapClick}
      />
    </>
  )
}
