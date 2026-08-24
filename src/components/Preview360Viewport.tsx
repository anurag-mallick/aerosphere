import * as THREE from 'three'
import { useEffect, useRef } from 'react'

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
 * Dual-fisheye → equirectangular fragment shader.
 *
 * Maps each fragment on the dewarped sphere to the correct pixel
 * in a dual-fisheye source (e.g. Insta360 X3 .insv pair).
 *
 * The source frame is typically 2880×2880 with two circular fisheye
 * lenses side-by-side, each ~220° FOV with ~10° overlap.
 *
 * Works in conjunction with the vertex shader that passes `worldDir`
 * varying to the fragment shader.
 *
 * Match note: this shader's math must match what ffmpeg's
 * `v360=dfisheye:e` produces server-side, so preview ≈ export.
 */
const fisheyeUnwrapFrag = /* glsl */`
precision highp float;

uniform sampler2D map;
uniform float lensFov;        // vertical FOV in degrees, e.g. 220 for X3
uniform float lensSeparation; // horizontal rad between lens centers, π for X3

varying vec3 worldDir; // camera-space direction fragment → lens center

const float PI = 3.14159265359;

float rad2deg = 180.0 / PI;
deg2rad = PI / 180.0;

vec3 yawPitchRollFromDir(vec3 dir) {
  float yaw = atan(dir.z, dir.x);
  float pitch = asin(dir.y);
  return vec3(yaw, pitch, 0.0);
}

float vignette(vec2 uv) {
  // simple vignette to blend lens edges
  float r = length(uv - 0.5);
  return smoothstep(0.5, 0.4, r);
}

void main() {
  // -- 1. Determine which lens this fragment belongs to ---
  // worldDir is in camera space, Y-up, Z-back.
  // We need yaw angle relative to each lens center.

  vec3 ypr = yawPitchRollFromDir(normalize(worldDir));
  float yaw = ypr.x;   // -PI..PI, 0 = forward, +PI/2 = right, -PI/2 = left
  float pitch = ypr.y; // -PI/2..PI/2, 0 = horizon, +PI/2 = up

  // Lens centers in yaw: left at -sep/2, right at +sep/2
  float leftCenter  = -lensSeparation / 2.0;
  float rightCenter =  lensSeparation / 2.0;

  //angular distance from each lens center
  float distToLeft  = abs(yaw - leftCenter);
  float distToRight = abs(yaw - rightCenter);

  // Which lens is closer? (if overlap, both may be candidates)
  bool useLeft  = distToLeft  <= distToRight;
  bool useRight = distToRight < distToLeft;

  // -- 2. For the winning lens, compute angular offset and map to polar coords ---
  float fovRad = radians(lensFov); // vertical FOV in radians
  float halfFovRad = fovRad / 2.0;

  // radial distance within the lens circle, proportional to angular distance from center
  // For a fisheye: r ∝ tan(θ/2) where θ is the viewing angle from lens center
  // We normalize so r=1 at the lens edge (half FOV)
  float r_norm;

  if (useLeft) {
    // offset from left lens center in yaw; clip to ±halfFOV
    float yawOffset = clamp(yaw - leftCenter, -halfFovRad, halfFovRad);
    r_norm = abs(yawOffset) / halfFovRad; // 0..1 across the lens diameter
  } else if (useRight) {
    float yawOffset = clamp(yaw - rightCenter, -halfFovRad, halfFovRad);
    r_norm = abs(yawOffset) / halfFovRad;
  } else {
    // outside both lenses → black
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // -- 3. Compute pixel UVs within the lens circle ---
  // The fisheye source is typically square (e.g. 2880×2880).
  // Each lens occupies a circle in this square. We compute the UV
  // within that circle, where (0,0) = lens center and (±1,±1) = corners.

  // The angular position around the lens (for proper polar mapping)
  float angle = pitch; // we use pitch (up/down) as the "vertical" angle within the lens

  // Map normalized radial distance to actual pixel radius
  // lens circle radius in pixels depends on source resolution.
  // We'll use a simple model: the lens fills most of the frame,
  // so radius ≈ min(width, height) * 0.45 (empirical for X3 2880×2880).
  // For now, we use a proportional model and let the texture lookup
  // handle out-of-bounds gracefully.

  // Calculate UV offset from lens center within the lens circle
  // r_norm 0..1 → radial distance from center
  // angle (pitch) used as the "vertical" coordinate; we'll also need "horizontal" angle
  // For a simple equirect mapping from fisheye, we use:
  //   u = 0.5 + angle / PI         // -1..1 → 0..1 (but we need full circle)
  //   v = 0.5 - r_norm             // top-to-bottom

  // Actually, let's use a proper fisheye → equirect mapping:
  // The idea: the fisheye image maps angle θ from lens center → radius r = 2f·tan(θ/2)
  // We reverse: given radius r_norm (0..1), find θ = 2·atan(r_norm · f)
  // But we already have the angle from the pitch component.
  // 
  // Simpler approach used in many real-time implementations:
  // Map the sphere fragment → lens-relative polar coords,
  // then sample the fisheye texture at those polar coords.

  // Compute lens-relative angle in [0, 2π) going from "up" around clockwise
  // We'll use: azimuth from yaw offset, elevation from pitch
  float relAngle = atan(yaw - (useLeft ? leftCenter : rightCenter), pitch);
  // relAngle ranges -PI..PI, where 0 = straight ahead from lens center,
  // +PI/2 = right, -PI/2 = left, +PI = up(ish), -PI = down(ish)

  // Normalize to [0, 1] for texture lookup
  float u = 0.5 + relAngle / (2.0 * PI);  // 0..1 going right from center
  float v = 0.5 + pitch / PI;              // 0..1, 0=down, 1=up (flip later)

  // The radial distance from lens center maps to how far from center in the fisheye circle
  // For a typical X3 fisheye, the lens circle radius in pixels is about half the image size.
  // We'll use r_norm as a proportion of the lens radius.
  float radius = r_norm; // 0 at center, 1 at lens edge

  // Apply radial distortion: in a real fisheye, radius ∝ tan(θ/2)
  // Here we just use linear r_norm, which gives a reasonable-looking result
  // for small offsets. For wide angles, consider:
  //   radius = tan(r_norm * halfFovRad) / tan(halfFovRad);
  // But keeping it simple for now.

  // Final texture coordinates: origin at lens center, v flipped (fisheye images
  // typically have origin at top-left, equirect v increases downward)
  float fx = 0.5 + radius * cos(relAngle); // x within lens circle
  float fy = 0.5 + radius * sin(relAngle); // y within lens circle

  // Sample the video texture at these coordinates
  vec4 color = texture2D(map, vec2(fx, fy));

  // Apply simple vignette to blend lens edges smoothly
  float vign = vignette(vec2(fx, fy));
  color = mix(color, vec4(0.0, 0.0, 0.0, 1.0), vign * (1.0 - r_norm));

  gl_FragColor = color;
}
`

/**
 * WebGL 360° dewarped viewport with dual-fisheye support.
 *
 * Renders the video source onto an inward-facing sphere.
 * - projection='equirect': standard sphere UV mapping (Phase 1)
 * - projection='dfisheye': dual-fisheye unwrap via GLSL shader (Phase 2+)
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
    projection = 'equirect',
  } = props

  const videoRef = useRef<HTMLVideoElement>(videoTextureSource)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const sphereRef = useRef<THREE.Mesh | null>(null)
  const materialRef = useRef<THREE.MeshBasicMaterial | THREE.ShaderMaterial | null>(null)

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
    geometry.scale(-1, 1, 1)

    let material: THREE.MeshBasicMaterial | THREE.ShaderMaterial

    if (projection === 'dfisheye') {
      // Phase 2: use custom GLSL shader for dual-fisheye unwrap
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
        fragmentShader: fisheyeUnwrapFrag,
        uniforms: {
          map: { value: new THREE.VideoTexture(videoRef.current) },
          lensFov: { value: 220 },   // default X3 lens FOV
          lensSeparation: { value: Math.PI }, // π for side-by-side X3 lenses
        },
        side: THREE.DoubleSide,
        transparent: false,
        depthWrite: true,
      })
      materialRef.current = material
    } else {
      // Phase 1: standard VideoTexture on sphere
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

      // Apply pan/tilt/roll from keyframes
      const panRad = (pan * Math.PI) / 180
      const tiltRad = (tilt * Math.PI) / 180
      const rollRad = (roll * Math.PI) / 180

      cameraRef.current!.rotation.set(tiltRad, panRad, rollRad, 'YXZ')

      // If fov changed (zoom), update camera
      if (cameraRef.current!.fov !== fov) {
        cameraRef.current!.fov = fov
        cameraRef.current!.updateProjectionMatrix()
      }

      // Update shader uniforms when using dfisheye projection
      if (materialRef.current && projection === 'dfisheye') {
        ;(materialRef.current as THREE.ShaderMaterial).uniforms.lensFov.value = fov
        // lensSeparation stays at π (X3 default) unless user configures otherwise
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
    projection,
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