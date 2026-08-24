import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { ViewRect } from '../utils/keyframes'
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
  /** whether the source is a 360° clip (equirect or dfisheye) */
  is360?: boolean
  /** how the raw frames are laid out — drives v360 input selection */
  projection?: 'dfisheye' | 'equirect'
  /** lens FOV in degrees for dfisheye unwrapping (default 220 for X3) */
  lensFov?: number
  /** called when user drags/scrolls the 360 viewport — writes to clip keyframes */
  onViewChange?: (pan: number, tilt: number, fov: number) => void
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
          <video ref={videoRef} className={`preview-video ${hasVideo ? '' : 'hidden'}`} playsInline />
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
          {viewRect && !showPlaceholder && (
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
          {props.is360 && props.projection && (
            <Preview360Viewport
              videoTextureSource={videoRef.current as HTMLVideoElement}
              pan={0}
              tilt={0}
              roll={0}
              fov={props.lensFov ?? 90}
              onViewChange={props.onViewChange}
              width={640}
              height={400}
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
      </div>
    </div>
  )
}
