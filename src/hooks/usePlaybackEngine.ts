import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineClip, TimelineTrack } from '../types/editor'
import { clamp } from '../utils/format'
import { mediaUrl } from '../core/ffmpeg'

interface ActiveVisual {
  clip: TimelineClip
  trackId: string
}

interface ActiveAudio {
  clip: TimelineClip
  trackId: string
}

/**
 * Master-clock playback engine.
 *
 * While playing, wall-clock time advances every frame, except when a video
 * element is actively playing a clip - then the timeline clock is derived
 * from the element itself so A/V stays perfectly in sync.
 */
export function usePlaybackEngine(videoTracks: TimelineTrack[], audioTracks: TimelineTrack[]) {
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [muted, setMuted] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const timeRef = useRef(0)
  const isPlayingRef = useRef(false)
  // pool of detached audio players - supports several simultaneous clips
  const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  const totalDuration = useMemo(() => {
    let max = 0
    for (const track of [...videoTracks, ...audioTracks]) {
      for (const clip of track.clips) {
        max = Math.max(max, clip.position + clip.duration)
      }
    }
    return Math.max(max, 1)
  }, [videoTracks, audioTracks])

  const findVisualAt = useCallback(
    (t: number): ActiveVisual | null => {
      // later tracks win (they render on top)
      for (let i = videoTracks.length - 1; i >= 0; i--) {
        const track = videoTracks[i]
        if (!track.isVisible) continue
        const clip = track.clips.find(
          (c) => t >= c.position - 1e-6 && t < c.position + c.duration - 1e-6
        )
        if (clip) return { clip, trackId: track.id }
      }
      return null
    },
    [videoTracks]
  )

  const activeVisual = useMemo(() => findVisualAt(currentTime), [findVisualAt, currentTime])
  /** ALL audio clips covering the playhead (multi-track simultaneous playback) */
  const activeAudioList = useMemo(() => {
    const list: ActiveAudio[] = []
    for (const track of audioTracks) {
      if (!track.isVisible) continue
      for (const clip of track.clips) {
        if (
          currentTime >= clip.position - 1e-6 &&
          currentTime < clip.position + clip.duration - 1e-6
        ) {
          list.push({ clip, trackId: track.id })
        }
      }
    }
    return list
  }, [audioTracks, currentTime])
  const activeVideoClip = activeVisual && activeVisual.clip.kind === 'video' ? activeVisual.clip : null
  const activePhotoClip = activeVisual && activeVisual.clip.kind === 'photo' ? activeVisual.clip : null

  const setTime = useCallback((t: number) => {
    timeRef.current = t
    setCurrentTime(t)
  }, [])

  // master clock loop
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      let next = timeRef.current
      const av = findVisualAt(timeRef.current)
      const v = videoRef.current
      if (
        av &&
        av.clip.kind === 'video' &&
        v &&
        !v.paused &&
        !v.seeking &&
        v.readyState >= 2 &&
        Number.isFinite(v.currentTime)
      ) {
        const derived = v.currentTime - av.clip.trimIn + av.clip.position
        next = Number.isFinite(derived) ? derived : timeRef.current + dt
      } else {
        next += dt
      }
      if (next >= totalDuration) {
        setTime(totalDuration)
        setIsPlaying(false)
        return
      }
      setTime(Math.max(0, next))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, findVisualAt, totalDuration, setTime])

  // swap the video element's source whenever the active video clip changes
  const activeVideoClipId = activeVideoClip ? activeVideoClip.id : null
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const clip = activeVideoClip
    if (!clip) {
      v.pause()
      v.removeAttribute('src')
      v.load()
      return
    }
    const onMeta = () => {
      try {
        v.currentTime = clamp(
          clip.trimIn + (timeRef.current - clip.position),
          0,
          Math.max(0.05, clip.sourceDuration)
        )
      } catch {
        // ignore seek before data
      }
      if (isPlayingRef.current) v.play().catch(() => {})
    }
    v.addEventListener('loadedmetadata', onMeta)
    v.src = mediaUrl(clip.path)
    v.load()
    return () => v.removeEventListener('loadedmetadata', onMeta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVideoClipId])

  // pooled audio: one detached player per simultaneously active clip
  const audioKey = activeAudioList.map((a) => a.clip.id).join('|')
  useEffect(() => {
    const pool = audioPoolRef.current
    const wanted = new Map(activeAudioList.map((a) => [a.clip.id, a.clip]))

    for (const [id, el] of [...pool]) {
      if (!wanted.has(id)) {
        el.pause()
        pool.delete(id)
      }
    }

    for (const [clipId, clip] of wanted) {
      let el = pool.get(clipId)
      if (!el) {
        el = new Audio(mediaUrl(clip.path))
        el.preload = 'auto'
        el.addEventListener('loadedmetadata', () => {
          try {
            el!.currentTime = clamp(
              clip.trimIn + (timeRef.current - clip.position),
              0,
              Math.max(0.05, clip.sourceDuration)
            )
          } catch {
            // not seekable yet
          }
          if (isPlayingRef.current) el!.play().catch(() => {})
        })
        pool.set(clipId, el)
      }
      if (isPlayingRef.current && el.paused && el.readyState >= 3) {
        el.play().catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKey])

  // destroy all pooled players on unmount
  useEffect(() => {
    const pool = audioPoolRef.current
    return () => {
      for (const el of pool.values()) {
        el.pause()
        el.removeAttribute('src')
      }
      pool.clear()
    }
  }, [])

  // play/pause follows transport state
  useEffect(() => {
    const v = videoRef.current
    if (isPlaying) {
      if (activeVideoClip && v && v.readyState > 0) v.play().catch(() => {})
      for (const el of audioPoolRef.current.values()) {
        if (el.readyState >= 3) el.play().catch(() => {})
      }
    } else {
      v?.pause()
      for (const el of audioPoolRef.current.values()) el.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // correct drift after seeks (guarded so natural playback isn't thrashed)
  useEffect(() => {
    // while playing the clock is DERIVED from the element each frame —
    // correcting here would reset the element and stall the clock
    if (isPlayingRef.current) return
    const v = videoRef.current
    if (v && activeVideoClip) {
      const target = activeVideoClip.trimIn + (currentTime - activeVideoClip.position)
      if (Number.isFinite(target) && !v.seeking && Math.abs(v.currentTime - target) > 0.35) {
        try {
          v.currentTime = Math.max(0, target)
        } catch {
          // not seekable yet
        }
      }
    }
    for (const [clipId, el] of audioPoolRef.current) {
      const entry = activeAudioList.find((x) => x.clip.id === clipId)
      if (!entry) continue
      const target = entry.clip.trimIn + (currentTime - entry.clip.position)
      if (
        Number.isFinite(target) &&
        !el.seeking &&
        Math.abs(el.currentTime - target) > 0.35
      ) {
        try {
          el.currentTime = Math.max(0, target)
        } catch {
          // not seekable yet
        }
      }
    }
  }, [currentTime, activeVideoClip, activeAudioList])

  const activeAudioClipIds = activeAudioList.map((a) => a.clip.id).join('|')
  useEffect(() => {
    if (videoRef.current) {
      // per-clip mute wins while its clip is on screen
      videoRef.current.muted = muted || !!activeVideoClip?.muted
    }
    for (const el of audioPoolRef.current.values()) el.muted = muted
  }, [muted, activeVideoClip, activeAudioClipIds])

  const play = useCallback(() => {
    if (timeRef.current >= totalDuration - 0.01) setTime(0)
    setIsPlaying(true)
  }, [totalDuration, setTime])

  const pause = useCallback(() => setIsPlaying(false), [])
  const toggle = useCallback(() => (isPlaying ? pause() : play()), [isPlaying, pause, play])

  const seek = useCallback(
    (t: number) => setTime(clamp(t, 0, totalDuration)),
    [totalDuration, setTime]
  )

  return {
    currentTime,
    isPlaying,
    muted,
    setMuted,
    totalDuration,
    videoRef,
    activeVideoClip,
    activePhotoClip,
    activeAudioClips: activeAudioList,
    play,
    pause,
    toggle,
    seek,
  }
}

export type PlaybackEngine = ReturnType<typeof usePlaybackEngine>
