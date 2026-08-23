import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { ViewRect } from '../utils/keyframes'
import { formatTime } from '../utils/format'
import { DroneIcon, Insta360Icon } from './icons'

interface PreviewPlayerProps {
  videoRef: RefObject<HTMLVideoElement>
  hasVideo: boolean
  photoSrc: string | null
  viewRect: ViewRect | null
  currentTime: number
  totalDuration: number
  isPlaying: boolean
  muted: boolean
  onTogglePlay: () => void
  onToggleMute: () => void
  onSeek: (t: number) => void
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
          style={mediaAspect ? { aspectRatio: String(mediaAspect) } : undefined}
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
