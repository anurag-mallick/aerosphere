import { useCallback, useEffect, useRef } from 'react'
import type { TimelineClip, TimelineMarker, TimelineTrack, TrackType } from '../types/editor'
import { clamp } from '../utils/format'
import { formatTime } from '../utils/format'
import { DroneIcon, Insta360Icon, VideoIcon, PhotoIcon, AudioIcon, WaveIcon } from './icons'

const TRACK_HEADER_WIDTH = 168
const LANE_HEIGHT = 60
const MIN_CLIP_DUR = 0.2
const MAX_PHOTO_DUR = 600
const SNAP_PX = 8
const BASE_PPS = 24

type DragMode = 'move' | 'trim-start' | 'trim-end'

interface DragState {
  mode: DragMode
  clip: TimelineClip
  track: TimelineTrack
  startX: number
  pps: number
  origPosition: number
  origTrimIn: number
  origDuration: number
}

interface TimelineProps {
  tracks: TimelineTrack[]
  pxPerSec: number
  currentTime: number
  totalDuration: number
  selectedClipId: string | null
  onSelectClip: (id: string | null) => void
  onUpdateClip: (trackId: string, clipId: string, patch: Partial<TimelineClip>) => void
  onSeek: (t: number) => void
  onToggleTrack: (trackId: string) => void
  onDeleteTrack: (trackId: string) => void
  onAddTrack: (type: TrackType) => void
  onZoomChange: (pxPerSec: number) => void
  onSplit: () => void
  canSplit: boolean
  markers: TimelineMarker[]
  onAddMarker: () => void
  onRemoveMarker: (id: string) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

/** source-aware icon: 360 cameras and drones get their own mark */
function ClipIcon({ clip }: { clip: TimelineClip }) {
  if (clip.kind === 'audio') return <AudioIcon size={14} />
  if (clip.kind === 'photo') return <PhotoIcon size={14} />
  return clip.is360 ? <Insta360Icon size={14} /> : <DroneIcon size={14} />
}

function snapTo(points: number[], value: number, pps: number): number {
  for (const point of points) {
    if (Math.abs(value - point) * pps < SNAP_PX) return point
  }
  return value
}

export function Timeline(props: TimelineProps) {
  const {
    tracks,
    pxPerSec,
    currentTime,
    totalDuration,
    selectedClipId,
    onSelectClip,
    onUpdateClip,
    onSeek,
    onToggleTrack,
    onDeleteTrack,
    onAddTrack,
    onZoomChange,
    onSplit,
    canSplit,
    markers,
    onAddMarker,
    onRemoveMarker,
  } = props

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const contentSeconds = Math.max(totalDuration + 20, 60)
  const contentWidth = contentSeconds * pxPerSec
  const playheadX = currentTime * pxPerSec

  // pick a tick interval whose pixel width stays readable
  const tickSteps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const tickStep = tickSteps.find((s) => s * pxPerSec >= 72) ?? 1200
  const ticks: number[] = []
  for (let t = 0; t <= contentSeconds; t += tickStep) ticks.push(Math.round(t * 10) / 10)

  // keep the playhead visible during playback
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const x = playheadX
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 48) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2)
    }
  }, [playheadX])

  /** other clips on this track as sorted [start,end) intervals */
  const overlapIntervals = (track: TimelineTrack, excludeId: string) =>
    track.clips
      .filter((c) => c.id !== excludeId)
      .map((c) => ({ start: c.position, end: c.position + c.duration }))
      .sort((a, b) => a.start - b.start)

  /**
   * Nearest non-overlapping position for a candidate [pos, pos+dur):
   * if it collides with an interval, snap to whichever side is closer.
   * Repeats until stable so cascades across multiple neighbors settle.
   */
  const clampToFreePosition = (
    pos: number,
    dur: number,
    intervals: { start: number; end: number }[]
  ): number => {
    let p = Math.max(0, pos)
    for (let pass = 0; pass < 3; pass++) {
      let collided = false
      for (const o of intervals) {
        if (p < o.end - 1e-6 && p + dur > o.start + 1e-6) {
          const leftOption = o.start - dur
          const rightOption = o.end
          const leftValid = leftOption >= 0
          const rightValid = true
          const goLeft =
            leftValid &&
            (!rightValid || Math.abs(leftOption - p) <= Math.abs(rightOption - p))
          p = goLeft ? Math.max(0, leftOption) : rightOption
          collided = true
        }
      }
      if (!collided) break
    }
    return Math.max(0, p)
  }

  const beginDrag = useCallback(
    (event: React.PointerEvent, clip: TimelineClip, track: TimelineTrack, mode: DragMode) => {
      event.stopPropagation()
      event.preventDefault()
      onSelectClip(clip.id)

      const snaps =
        mode === 'move'
          ? [0, ...track.clips.filter((c) => c.id !== clip.id).flatMap((c) => [c.position, c.position + c.duration])]
          : []

      dragRef.current = {
        mode,
        clip,
        track,
        startX: event.clientX,
        pps: pxPerSec,
        origPosition: clip.position,
        origTrimIn: clip.trimIn,
        origDuration: clip.duration,
      }

      const onMove = (ev: PointerEvent) => {
        const state = dragRef.current
        if (!state) return
        const deltaSec = (ev.clientX - state.startX) / state.pps
        const o = state.clip
        const trackState = state.track

        if (state.mode === 'move') {
          const snapped = snapTo(snaps, Math.max(0, state.origPosition + deltaSec), state.pps)
          const freePos = clampToFreePosition(
            Math.max(0, snapped),
            o.duration,
            overlapIntervals(trackState, o.id)
          )
          onUpdateClip(trackState.id, o.id, { position: freePos })
          return
        }

        if (state.mode === 'trim-end') {
          const sourceLimit =
            o.kind === 'photo' ? MAX_PHOTO_DUR : Math.max(MIN_CLIP_DUR, o.sourceDuration - o.trimIn)
          // never extend past the next clip on this track
          const rightNeighborStart = overlapIntervals(trackState, o.id)
            .map((iv) => iv.start)
            .filter((start) => start >= o.position + MIN_CLIP_DUR - 1e-6)
            .sort((a, b) => a - b)[0]
          const neighborLimit =
            rightNeighborStart !== undefined ? rightNeighborStart - o.position : Infinity
          const limit = Math.min(sourceLimit, neighborLimit)
          if (limit < MIN_CLIP_DUR) return
          const duration = clamp(
            snapTo([o.position + o.duration], state.origDuration + deltaSec, state.pps) - o.position,
            MIN_CLIP_DUR,
            limit
          )
          onUpdateClip(trackState.id, o.id, { duration })
          return
        }

        // trim-start (videos / audio only)
        if (o.kind === 'photo') return
        const lower = Math.max(-state.origTrimIn, -state.origPosition)
        const upper = Math.min(
          state.origDuration - MIN_CLIP_DUR,
          o.sourceDuration - MIN_CLIP_DUR - state.origTrimIn
        )
        if (upper <= lower) return
        const shift = clamp(deltaSec, lower, upper)
        const candDuration = state.origDuration - shift
        const candPosition = clampToFreePosition(
          Math.max(0, snapTo(snaps, state.origPosition + shift, state.pps)),
          candDuration,
          overlapIntervals(trackState, o.id)
        )
        const appliedShift = candPosition - state.origPosition
        onUpdateClip(trackState.id, o.id, {
          position: candPosition,
          trimIn: state.origTrimIn + appliedShift,
          duration: state.origDuration - appliedShift,
        })
      }

      const finish = () => {
        dragRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    },
    [onSelectClip, onUpdateClip, pxPerSec]
  )

  const seekFromEvent = useCallback(
    (clientX: number, target: HTMLElement) => {
      const rect = target.getBoundingClientRect()
      onSeek((clientX - rect.left) / pxPerSec)
    },
    [onSeek, pxPerSec]
  )

  const startRulerDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    onSelectClip(null)
    seekFromEvent(event.clientX, event.currentTarget)
    const target = event.currentTarget
    const onMove = (ev: PointerEvent) => seekFromEvent(ev.clientX, target)
    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
  }

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <button className="btn-small" onClick={() => onAddTrack('video')}>
          + Video Track
        </button>
        <button className="btn-small" onClick={() => onAddTrack('audio')}>
          + Audio Track
        </button>
        <button
          className={`btn-small ${canSplit ? 'btn-split-ready' : ''}`}
          onClick={onSplit}
          disabled={!canSplit}
          title="Split selected clip at playhead (S)"
        >
          ✂ Split
        </button>
        <button className="btn-small" onClick={props.onUndo} disabled={!props.canUndo} title="Undo (⌘Z)">
          ↩ Undo
        </button>
        <button className="btn-small" onClick={props.onRedo} disabled={!props.canRedo} title="Redo (⇧⌘Z)">
          ↪ Redo
        </button>
        <button className="btn-small" onClick={onAddMarker} title="Add marker at playhead (M)">
          🚩 Marker
        </button>
        <span className="toolbar-hint">Click a library item’s “+ Timeline” to build your edit · drag clips to move · drag edges to trim</span>
        <div className="zoom-controls">
          <button className="btn-small" title="Zoom out" onClick={() => onZoomChange(pxPerSec / 1.4)}>
            −
          </button>
          <span className="zoom-value">{Math.round((pxPerSec / BASE_PPS) * 100)}%</span>
          <button className="btn-small" title="Zoom in" onClick={() => onZoomChange(pxPerSec * 1.4)}>
            +
          </button>
        </div>
      </div>

      <div className="timeline-body">
        <div className="track-headers" style={{ width: TRACK_HEADER_WIDTH }}>
          <div className="ruler-spacer" />
          {tracks.map((track) => (
            <div className="track-header" key={track.id} style={{ height: LANE_HEIGHT }}>
              <span className="track-type-icon">
                {track.type === 'video' ? <VideoIcon size={15} /> : <WaveIcon size={15} />}
              </span>
              <span className="track-name" title={track.name}>
                {track.name}
              </span>
              <button
                className="btn-tiny"
                onClick={() => onToggleTrack(track.id)}
                title={track.isVisible ? 'Hide track' : 'Show track'}
              >
                {track.isVisible ? '👁' : '🚫'}
              </button>
              <button
                className="btn-tiny btn-danger"
                onClick={() => onDeleteTrack(track.id)}
                title="Delete track"
              >
                🗑
              </button>
            </div>
          ))}
        </div>

        <div className="timeline-scroll" ref={scrollRef}>
          <div className="timeline-canvas" style={{ width: contentWidth }}>
            <div className="ruler" onPointerDown={startRulerDrag}>
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * pxPerSec }}>
                  <span>{formatTime(t)}</span>
                </div>
              ))}
              {markers.map((m) => (
                <button
                  key={m.id}
                  className="ruler-marker"
                  style={{ left: m.time * pxPerSec }}
                  title={`Marker @ ${formatTime(m.time)} — right-click to delete`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSeek(m.time)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onRemoveMarker(m.id)
                  }}
                >
                  🚩
                </button>
              ))}
            </div>

            {tracks.map((track) => (
              <div
                key={track.id}
                className={`track-lane ${track.isVisible ? '' : 'muted'} ${track.type}`}
                style={{
                  height: LANE_HEIGHT,
                  backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${Math.max(
                    pxPerSec - 1,
                    0
                  )}px, rgba(255,255,255,0.03) ${Math.max(pxPerSec - 1, 0)}px, rgba(255,255,255,0.03) ${pxPerSec}px)`,
                }}
                onPointerDown={(e) => {
                  onSelectClip(null)
                  seekFromEvent(e.clientX, e.currentTarget.closest('.timeline-canvas') as HTMLElement)
                }}
              >
                {track.clips.map((clip) => {
                  const selected = clip.id === selectedClipId
                  return (
                    <div
                      key={clip.id}
                      className={`timeline-clip kind-${clip.kind} ${selected ? 'selected' : ''}`}
                      style={{
                        left: clip.position * pxPerSec,
                        width: Math.max(clip.duration * pxPerSec, 10),
                        height: LANE_HEIGHT - 10,
                      }}
                      onPointerDown={(e) => beginDrag(e, clip, track, 'move')}
                      title={`${clip.name} · ${clip.duration.toFixed(1)}s @ ${formatTime(clip.position)}`}
                    >
                      <span className="clip-icon"><ClipIcon clip={clip} /></span>
                      <div className="clip-timeline-info">
                        <p className="clip-name">{clip.name}</p>
                        <p className="clip-duration">
                          {clip.duration.toFixed(1)}s{(clip.speed ?? 1) !== 1 ? ` · ${clip.speed}×` : ''}
                        </p>
                      </div>
                      {(clip.keyframes ?? []).map((k) => (
                        <span
                          key={k.id}
                          className="kf-marker"
                          style={{ left: `${Math.min(100, Math.max(0, (k.time / clip.duration) * 100))}%` }}
                          title={`keyframe @ ${k.time.toFixed(2)}s`}
                        />
                      ))}
                      {clip.kind !== 'photo' && (
                        <div
                          className="resize-handle left"
                          onPointerDown={(e) => beginDrag(e, clip, track, 'trim-start')}
                        />
                      )}
                      <div
                        className="resize-handle right"
                        onPointerDown={(e) => beginDrag(e, clip, track, 'trim-end')}
                      />
                    </div>
                  )
                })}
                {track.clips.length === 0 && (
                  <div className="lane-empty-hint">Drop zone — click here to seek</div>
                )}
              </div>
            ))}

            <div className="playhead" style={{ left: playheadX }}>
              <div className="playhead-knob" />
            </div>
          </div>
        </div>
      </div>

      <footer className="timeline-footer">
        <span>Playhead {formatTime(currentTime)}</span>
        <span>Timeline length {formatTime(totalDuration)}</span>
        <span>{tracks.reduce((n, t) => n + t.clips.length, 0)} clips</span>
      </footer>
    </div>
  )
}
