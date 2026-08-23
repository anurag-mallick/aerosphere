// Preview-side keyframe interpolation and virtual-camera view-rect math.
// (The export-side ffmpeg expression builder lives in keyframe-filter.js at
// the project root so the main process can use it without a TS build.)
import type { ClipKeyframe } from '../types/editor'

export function smoothstep(p: number): number {
  const x = Math.min(1, Math.max(0, p))
  return x * x * (3 - 2 * x)
}

/** Interpolated value of a channel at clip-relative time `time` (seconds). */
export function interpolateChannel(
  keyframes: ClipKeyframe[],
  time: number,
  channel: 'pan' | 'tilt' | 'roll' | 'fov',
  fallback: number
): number {
  if (!keyframes || keyframes.length === 0) return fallback
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  if (time <= sorted[0].time) return sorted[0][channel]
  const last = sorted[sorted.length - 1]
  if (time >= last.time) return last[channel]
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time
      const p = span > 0 ? (time - a.time) / span : 1
      const s = a.easing === 'ease' ? smoothstep(p) : p
      return a[channel] + (b[channel] - a[channel]) * s
    }
  }
  return last[channel]
}

export interface ViewRect {
  /** all values are fractions of the source frame (0..1), clamped */
  x: number
  y: number
  w: number
  h: number
}

/**
 * Approximate on-screen framing overlay for the current virtual camera.
 * For flat sources the rect matches the crop exactly; for 360° sources it is
 * an approximation of the equirectangular area being sampled.
 */
export function computeViewRect(
  is360: boolean,
  pan: number,
  tilt: number,
  _rollIgnored: number,
  fov: number,
  outputAspect = 16 / 9
): ViewRect {
  if (is360) {
    // fov is vertical FOV in degrees; derive horizontal from output aspect.
    const vFovRad = (Math.min(140, Math.max(20, fov)) * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFovRad / 2) * outputAspect)
    const w = Math.min(1, hFov / (2 * Math.PI))
    const h = Math.min(1, vFovRad / Math.PI)
    const cx = ((pan + 180) % 360) / 360
    const cy = (90 - tilt) / 180
    return {
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
    }
  }
  const zoom = Math.min(4, Math.max(1, fov))
  const w = 1 / zoom
  const h = 1 / zoom
  // pan/tilt are -100..100 offsets across the movable range
  const rangeX = 1 - w
  const rangeY = 1 - h
  const cx = 0.5 + (((pan + 100) / 200) - 0.5) * rangeX + w / 2
  const cy = 0.5 + (((tilt + 100) / 200) - 0.5) * rangeY + h / 2
  const x = Math.min(1 - w, Math.max(0, cx - w / 2))
  const y = Math.min(1 - h, Math.max(0, cy - h / 2))
  return { x, y, w, h }
}
