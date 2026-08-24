import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { ViewRect } from '../utils/keyframes'
import type { ClipKeyframe } from '../types/editor'
import { formatTime } from '../utils/format'
import { DroneIcon, Insta360Icon } from './icons'
import { Preview360Viewport } from './Preview360Viewport'

interface PreviewPlayerProps {
  videoRef: RefObject<HTMLVideoElement>
  hasVideo: boolean
  photoSrc: string | null
  viewRect: ViewRect | null
  activeTitle?: { text: string; size: number; position: 'top' | 'bottom' } | null
  rotate90?: number
  currentTime: number
  totalDuration: number
  isPlaying: boolean
  muted: boolean
  onTogglePlay: () => void
  onToggleMute: () => void
  onSeek: (t: number) => void
  onCaptureFrame: () => void
  /** whether the active clip is a 360° source — swaps flat preview for the WebGL viewport */
  is360?: boolean
  /** frame layout of the 360° source */
  projection?: 'dfisheye' | 'equirect'
  /** lens FOV of the dual-fisheye source (default 220 for X3) */
  lensFov?: number
  /** interpolated camera state at the current playhead (360 clips only) */
  view360?: { pan: number; tilt: number; roll: number; fov: number }
  /** clip-relative playhead time + duration, for the mini-map */
  clipTime?: number
  clipDuration?: number
  /** keyframes of the active clip — mini-map path */
  keyframes?: ClipKeyframe[]
  /** viewport drag/zoom → upsert keyframe at playhead */
  onViewChange?: (pan: number, tilt: number, fov: number) => void
  /** mini-map dot click → seek within clip */
  onSeekClipTime?: (t: number) => void
  /** preview quality preference — proxy (480p) or full source */
  previewQuality?: 'proxy' | 'full'
  /** flip proxy/full preview */
  onTogglePreviewQuality?: () => void
}

export function PreviewPlayer(props: PreviewPlayerProps) {
  const {
    videoRef,
    hasVideo,
    photoSrc,
    viewRect,
    currentTime,
    totalDuration,
    isPlaying,
    muted,
  } = props
  const activeTitle = props.activeTitle
  const rotate = ((props.rotate90 ?? 0) % 360 + 360) % 360
  const rotated = rotate === 90 || rotate === 270

  // track the displayed media box so the reframing overlay aligns exactly
  const [mediaAspect, setMediaAspect] = useState<number | null>(null)

  useEffect(() => {
    setMediaAspect(null)
  }, [photoSrc])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onMeta = () => setMediaAspect(v.videoWidth > 0 ? v.videoWidth / v.videoHeight : null)
    v.addEventListener('loadedmetadata', onMeta)
    return () => v.removeEventListener('loadedmetadata', onMeta)
  }, [videoRef])

  const showPlaceholder = !hasVideo && !photoSrc

  return (
    <div className="preview-panel">
      <div className="preview-stage">
        <div
          className={`preview-frame ${hasVideo || photoSrc ? '' : 'empty'}`}
          style={{
            aspectRatio: mediaAspect
              ? String(rotated && mediaAspect > 0 ? 1 / mediaAspect : mediaAspect)
              : undefined,
            transform: rotate ? `rotate(${rotate}deg)` : undefined,
          }}
        >
          <video
            ref={videoRef}
            className={`preview-video ${hasVideo ? '' : 'hidden'}`}
            style={
              props.is360
                // keep the element in-flow so it still sizes preview-frame —
                // display:none here collapses the frame to 0×0 and the WebGL
                // viewport (absolutely positioned inside it) vanishes with it
                ? { visibility: 'hidden' }
                : undefined
            }
            playsInline
            // required so WebGL VideoTexture uploads are not origin-tainted
            // (media:// responses send Access-Control-Allow-Origin: *)
            crossOrigin="anonymous"
            // load metadata + first frames immediately so paused scrubbing
            // works and the 360 viewport can texture before first play
            preload="auto"
          />
          {photoSrc && (
            <img
              className="preview-photo"
              src={photoSrc}
              alt=""
              onLoad={(e) => {
                const img = e.currentTarget
                setMediaAspect(img.naturalWidth > 0 ? img.naturalWidth / img.naturalHeight : null)
              }}
            />
          )}
          {activeTitle && activeTitle.text.trim() && (
            <div
              className={`preview-title pos-${activeTitle.position}`}
              style={{ fontSize: `${Math.max(14, activeTitle.size / 2.2)}px` }}
            >
              {activeTitle.text}
            </div>
          )}
          {viewRect && !showPlaceholder && !props.is360 && (
            <div
              className="view-rect"
              style={{
                left: `${viewRect.x * 100}%`,
                top: `${viewRect.y * 100}%`,
                width: `${viewRect.w * 100}%`,
                height: `${viewRect.h * 100}%`,
              }}
            >
              <span>view</span>
            </div>
          )}
          {/* mediaAspect flips on loadedmetadata — a render-time videoWidth
              read stays 0 forever when paused (no re-render after src swap) */}
          {props.is360 && mediaAspect !== null && (
            <Preview360Viewport
              videoEl={videoRef.current ?? null}
              pan={props.view360?.pan ?? 0}
              tilt={props.view360?.tilt ?? 0}
              roll={props.view360?.roll ?? 0}
              fov={props.view360?.fov ?? 90}
              projection={props.projection}
              lensFov={props.lensFov}
              clipTime={props.clipTime}
              clipDuration={props.clipDuration}
              keyframes={props.keyframes}
              onViewChange={props.onViewChange}
              onSeekClipTime={props.onSeekClipTime}
            />
          )}
        </div>
        {showPlaceholder && (
          <div className="preview-placeholder">
            <div className="placeholder-icons">
              <DroneIcon size={30} />
              <Insta360Icon size={30} />
            </div>
            <p>
              Import <b>drone</b> or <b>360°</b> footage and start editing
            </p>
          </div>
        )}
        <button className="mute-toggle" style={{ right: 44 }} onClick={props.onCaptureFrame} title="Grab still frame (PNG)">
          📸
        </button>
        <button className="mute-toggle" onClick={props.onToggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="transport-bar">
        <button className="btn-icon transport-play" onClick={props.onTogglePlay}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span className="time-display">
          {formatTime(currentTime)} <span className="time-sep">/</span>{' '}
          {formatTime(totalDuration)}
        </span>
        <input
          className="seek-slider"
          type="range"
          min={0}
          max={Math.max(0.1, totalDuration)}
          step={0.05}
          value={Math.min(currentTime, totalDuration)}
          onChange={(e) => props.onSeek(Number(e.target.value))}
        />
        {hasVideo && (
          <button
            className={`btn-icon quality-toggle ${props.previewQuality === 'full' ? 'active' : ''}`}
            onClick={props.onTogglePreviewQuality}
            title={
              props.previewQuality === 'full'
                ? 'Previewing FULL quality — click for smooth 480p proxy'
                : 'Previewing 480p proxy — click for FULL-quality preview (needs a faster machine)'
            }
          >
            {props.previewQuality === 'full' ? '🎞' : '⚡'}
          </button>
        )}
      </div>
    </div>
  )
}
