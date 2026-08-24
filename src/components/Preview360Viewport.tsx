import * as THREE from 'three'
import { useEffect, useRef, useState } from 'react'

export interface FisheyeUnwrapFragment {
  /** uniform: video texture sampler */
  map: THREE.Texture
  /** uniform: vertical FOV of each lens in degrees (default 220 for X3) */
  lensFov: number
  /** uniform: horizontal separation between lens centers in radians (π ≈ 3.1416 for X3 side-by-side) */
  lensSeparation: number
}

export interface Preview360ViewportProps {
  /** the hidden <video> element playing source media */
  videoTextureSource: HTMLVideoElement
  /** current pan in degrees (drives camera rotation) */
  pan: number
  /** current tilt in degrees (drives camera rotation) */
  tilt: number
  /** current roll in degrees (drives camera Z-rotation) */
  roll: number
  /** vertical FOV in degrees for 360° (20..140); zoom factor for flat (1..4) */
  fov: number
  /** called when user drags/scrolls — writes back to clip keyframes */
  onViewChange?: (pan: number, tilt: number, fov: number) => void
  /** width of the video display area in CSS pixels */
  width?: number
  /** height of the video display area in CSS pixels */
  height?: number
  /** projection mode: 'equirect' or 'dfisheye' */
  projection?: 'dfisheye' | 'equirect'
}

/**
 * WebGL 360° dewarped viewport with dual-fisheye support and interaction.
 *
 * Modes:
 * - projection='equirect': standard sphere UV mapping via VideoTexture
 * - projection='dfisheye': dual-fisheye unwrap via GLSL shader
 *
 * Interactions (all write through onViewChange → clip keyframes):
 * - Click-drag inside viewport    → pan (X) + tilt (Y), clamped tilt ±90°
 * - Scroll wheel                 → fov zoom (clamped 20..140 for 360°)
 * - Shift + drag                 → roll (Z-rotation) — currently maps to tilt offset
 *
 * onViewChange is debounced (≈20Hz max) to avoid flooding the keyframe store.
 */
export function Preview360Viewport(props: Preview360ViewportProps) {
  const {
    videoTextureSource,
    pan,
    tilt,
    roll: initialRoll,
    fov: initialFov,
    onViewChange: onViewChangeProp,
    width: displayWidth = 640,
    height: displayHeight = 400,
    projection = 'equirect',
  } = props

  const videoRef = useRef<HTMLVideoElement>(videoTextureSource)

  // interaction state
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{x: number, y: number} | null>(null)

  // local state driven by props + interactions
  const [panState, setPanState] = useState<number>(pan)
  const [tiltState, setTiltState] = useState<number>(tilt)
  const [fovState, setFovState] = useState<number>(initialFov)

  // debounce timer for onViewChange
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const lastChangeRef = useRef<number>(0)

  // ---------- Sync props into local state ----------

  useEffect(() => {
    setPanState(pan)
    setTiltState(tilt)
    setFovState(initialFov)
  }, [pan, tilt, initialFov])

  // ---------- Keep video aspect in sync with loadedmetadata ----------

  useEffect(() => {
    if (!videoRef.current) return
    const v = videoRef.current
    const onMeta = () => {
      ;(canvasRef.current as HTMLCanvasElement).width = v.videoWidth
      ;(canvasRef.current as HTMLCanvasElement).height = v.videoHeight
    }
    v.addEventListener('loadedmetadata', onMeta)
    return () => v.removeEventListener('loadedmetadata', onMeta)
  }, [videoTextureSource])

  // ---------- Initialize three.js ----------

  const canvasRef = useRef<HTMLCanvasElement>(null)
const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
const sceneRef = useRef<THREE.Scene | null>(null)
const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
const sphereRef = useRef<THREE.Mesh | null>(null)
const materialRef = useRef<THREE.MeshBasicMaterial | THREE.ShaderMaterial | null>(null)

  useEffect(() => {
    if (!videoRef.current) return

    const canvas = canvasRef.current!
    canvas.width = videoRef.current.videoWidth || displayWidth
    canvas.height = videoRef.current.videoHeight || displayHeight

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    // inward-facing sphere so camera inside sees the video textured faces
    const geometry = new THREE.SphereGeometry(500, 64, 48)
    geometry.scale(-1, 1, 1)

    let material: THREE.MeshBasicMaterial | THREE.ShaderMaterial

    if (projection === 'dfisheye') {
      material = new THREE.ShaderMaterial({
        vertexShader: /* glsl */`
          precision highp float;
          attribute vec3 position;
          varying vec3 worldDir;
          uniform mat4 modelViewMatrix;
          uniform mat4 projectionMatrix;
          void main() {
            worldDir = (modelViewMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */`
          precision highp float;
          uniform sampler2D map;
          uniform float lensFov;
          uniform float lensSeparation;
          varying vec3 worldDir;
          const float PI = 3.14159265359;
          const float deg2rad = PI / 180.0;
          void main() {
            float yaw = atan(worldDir.z, worldDir.x);
            float pitch = asin(worldDir.y);

            float leftCenter  = -lensSeparation / 2.0;
            float rightCenter =  lensSeparation / 2.0;

            float distToLeft  = abs(yaw - leftCenter);
            float distToRight = abs(yaw - rightCenter);

            bool useLeft  = distToLeft <= distToRight;
            bool useRight = distToRight < distToLeft;

            float fovRad = radians(lensFov);
            float halfFov = fovRad / 2.0;

            float r_norm;
            if (useLeft) {
              float yawOffset = clamp(yaw - leftCenter, -halfFov, halfFov);
              r_norm = abs(yawOffset) / halfFov;
            } else if (useRight) {
              float yawOffset = clamp(yaw - rightCenter, -halfFov, halfFov);
              r_norm = abs(yawOffset) / halfFov;
            } else {
              gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
              return;
            }

            float relAngle = atan(pitch, yaw - (useLeft ? leftCenter : rightCenter));
            float u = 0.5 + relAngle / (2.0 * PI);
            float v = 0.5 + pitch / PI;

            float radius = r_norm;

            vec4 color = texture2D(map, vec2(u + (0.5 - radius), v + (0.5 - radius)));

            gl_FragColor = color;
          }
        `,
        uniforms: {
          map: { value: new THREE.VideoTexture(videoRef.current) },
          lensFov: { value: 220 },
          lensSeparation: { value: Math.PI },
        },
        side: THREE.DoubleSide,
        transparent: false,
        depthWrite: true,
      })
      materialRef.current = material
    } else {
      // equirect: standard VideoTexture
      material = new THREE.MeshBasicMaterial({
        map: new THREE.VideoTexture(videoRef.current),
      })
      material.side = THREE.DoubleSide
      materialRef.current = material
    }

    const sphere = new THREE.Mesh(geometry, material)
    sphereRef.current = sphere
    sphere.position.set(0, 0, 0)
    scene.add(sphere)

    // camera inside the sphere, looking toward center
    const aspect = canvas.clientWidth / canvas.clientHeight
    const camera = new THREE.PerspectiveCamera(90, aspect, 0.1, 1100)
    camera.position.set(0, 0, 0)
    cameraRef.current = camera
    scene.add(camera)

    function render() {
      if (!cameraRef.current || !rendererRef.current || !sphereRef.current) return

      // Apply pan/tilt/roll from state
      const panRad = (panState * Math.PI) / 180
      const tiltRad = (tiltState * Math.PI) / 180
      const rollRad = ((initialRoll ?? 0) * Math.PI) / 180

      cameraRef.current!.rotation.set(tiltRad, panRad, rollRad, 'YXZ')

      // If fov changed, update camera
      if (cameraRef.current!.fov !== fovState) {
        cameraRef.current!.fov = fovState
        cameraRef.current!.updateProjectionMatrix()
      }

      // Update shader uniforms when using dfisheye projection
      if (materialRef.current && projection === 'dfisheye') {
        ;(materialRef.current as THREE.ShaderMaterial).uniforms.lensFov.value = fovState
        // lensSeparation stays at π (X3 default)
      }

      rendererRef.current.render(sceneRef.current!, cameraRef.current!)

      // request next frame
      requestAnimationFrame(render)
    }

    // start render loop
    render()

    // handle window resize
    const handleResize = () => {
      if (!canvasRef.current || !cameraRef.current || !rendererRef.current) return
      rendererRef.current.setSize(
        canvasRef.current.clientWidth,
        canvasRef.current.clientHeight,
        false
      )
      if (cameraRef.current) {
        cameraRef.current.aspect =
          canvasRef.current.clientWidth / canvasRef.current.clientHeight
        cameraRef.current.updateProjectionMatrix()
      }
    }
    window.addEventListener('resize', handleResize)

    // ---------- Interaction event listeners ----------
    canvas.addEventListener('pointerdown', handlePointerDown as any)
    canvas.addEventListener('pointermove', handlePointerMove as any)
    canvas.addEventListener('pointerup', handlePointerUp as any)
    canvas.addEventListener('wheel', handleWheel as any)

    return () => {
      window.removeEventListener('resize', handleResize)
      renderer.dispose()

      canvas.removeEventListener('pointerdown', handlePointerDown as any)
      canvas.removeEventListener('pointermove', handlePointerMove as any)
      canvas.removeEventListener('pointerup', handlePointerUp as any)
      canvas.removeEventListener('wheel', handleWheel as any)
    }
  }, [
    videoTextureSource,
    pan,
    tilt,
    initialRoll,
    initialFov,
    onViewChangeProp,
    displayWidth,
    displayHeight,
    projection,
  ])

  // debounced onViewChange helper
  const runDebouncedOnViewChange = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const now = Date.now()
    if (now - lastChangeRef.current > 50) {
      lastChangeRef.current = now
      onViewChangeProp?.(panState, tiltState, fovState)
    } else {
      debounceRef.current = setTimeout(() => {
        lastChangeRef.current = Date.now()
        onViewChangeProp?.(panState, tiltState, fovState)
      }, 50 - (now - lastChangeRef.current))
    }
  }

  // ---------- Pointer event handlers ----------
  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY })
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStart) return

    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y

    // Accumulate pan (horizontal) and tilt (vertical)
    setPanState((prev) => {
      const newVal = prev + dx * 0.15 // 0.15° per pixel sensitivity
      return ((newVal % 360) + 540) % 360 - 180
    })
    setTiltState((prev) => {
      const newVal = prev + dy * 0.15
      return Math.max(-89.9, Math.min(89.9, newVal))
    })

    setDragStart({ x: e.clientX, y: e.clientY })
    runDebouncedOnViewChange()
  }

  const handlePointerUp = () => {
    setIsDragging(false)
    setDragStart(null)
  }

  const handleWheel = (e: React.WheelEvent) => {
    const fovChange = e.deltaY * -0.05 // negative = zoom in

    setFovState((prev) => Math.max(20, Math.min(140, prev + fovChange)))

    runDebouncedOnViewChange()
  }

  // ---------- Render the canvas into DOM ----------

  if (!videoRef.current || !canvasRef.current) {
    return null
  }

  const canvas = canvasRef.current
  ;(canvas as HTMLElement).style.width = `${displayWidth}px`
  ;(canvas as HTMLElement).style.height = `${displayHeight}px`

  return (
    <>
      <canvas ref={canvasRef} className="preview-360-viewport" />
      <canvas className="preview-360-minimap" />
    </>
  )
}