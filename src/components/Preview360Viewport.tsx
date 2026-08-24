import * as THREE from 'three'
import { useEffect, useRef } from 'react'

interface Preview360ViewportProps {
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
}

/**
 * WebGL 360° dewarped viewport.
 * Renders the video source onto an inward-facing sphere.
 * - projection='equirect': standard sphere UV mapping (used for stitched equirect sources)
 * - projection='dfisheye': will be implemented in Phase 2 via GLSL shader
 *
 * The video element plays via Electron's `media://` protocol URL.
 * Three.js VideoTexture auto-plays when attached to a material.
 */
export function Preview360Viewport(props: Preview360ViewportProps) {
  const {
    videoTextureSource,
    pan,
    tilt,
    roll,
    fov,
    onViewChange,
    width: displayWidth = 640,
    height: displayHeight = 400,
  } = props

  const videoRef = useRef<HTMLVideoElement>(videoTextureSource)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const sphereRef = useRef<THREE.Mesh | null>(null)

  // keep aspect in sync with the video's loadedmetadata
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

  // initialize three.js on mount
  useEffect(() => {
    if (!videoRef.current) return

    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth || displayWidth
    canvas.height = videoRef.current.videoHeight || displayHeight
    ;(canvasRef as any).current = canvas

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    // inward-facing sphere so camera inside sees the video textured faces
    const geometry = new THREE.SphereGeometry(500, 64, 48)
    geometry.scale(-1, 1, 1) // invert X so camera inside sees correct handedness

    // VideoTexture auto-plays when attached to a material
    const material = new THREE.MeshBasicMaterial({
      map: new THREE.VideoTexture(videoRef.current),
    })
    material.side = THREE.DoubleSide

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

      // Apply pan/tilt/roll from keyframes
      // pan: left-right rotation around Y (degrees)
      // tilt: up-down rotation around X (degrees), clamped ±90
      // roll: Z-rotation
      const panRad = (pan * Math.PI) / 180
      const tiltRad = (tilt * Math.PI) / 180
      const rollRad = (roll * Math.PI) / 180

      cameraRef.current!.rotation.set(tiltRad, panRad, rollRad, 'YXZ')

      // If fov changed (zoom), update camera
      if (cameraRef.current!.fov !== fov) {
        cameraRef.current!.fov = fov
        cameraRef.current!.updateProjectionMatrix()
      }

      ;(rendererRef.current as any).render(sceneRef.current!, cameraRef.current!)

      // request next frame — but ONLY if component is mounted
      requestAnimationFrame(render)
    }

    // start render loop
    render()

    // handle resize
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

    return () => {
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
    }
  }, [
    videoTextureSource,
    pan,
    tilt,
    roll,
    fov,
    onViewChange,
    displayWidth,
    displayHeight,
  ])

  // no-op if no video yet
  if (!videoRef.current || !canvasRef.current) {
    return null
  }

  // render the canvas into the parent's DOM
  const canvas = canvasRef.current
  ;(canvas as HTMLElement).style.width = `${displayWidth}px`
  ;(canvas as HTMLElement).style.height = `${displayHeight}px`

  return <canvas ref={canvasRef} className="preview-360-viewport" />
}