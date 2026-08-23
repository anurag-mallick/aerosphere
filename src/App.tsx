import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type {
  ExportProgress,
  LibraryAudio,
  LibraryPhoto,
  LibraryVideo,
  TimelineClip,
  TimelineMarker,
  TimelineTrack,
  TrackType,
} from './types/editor'
import { PHOTO_DEFAULT_DURATION } from './types/editor'
import {
  checkFfmpeg,
  convertInsvFile,
  fetchThumbnail,
  fetchVideoMetadata,
  mediaUrl,
  pickFiles,
  pickSavePath,
} from './core/ffmpeg'
import { usePlaybackEngine } from './hooks/usePlaybackEngine'
import { MediaLibrary } from './components/MediaLibrary'
import { PreviewPlayer } from './components/PreviewPlayer'
import { Timeline } from './components/Timeline'
import { Inspector } from './components/Inspector'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useProjectHistory } from './hooks/useProjectHistory'
import { fileNameOf, formatTime, uid, clamp } from './utils/format'
import { interpolateChannel, computeViewRect, type ViewRect } from './utils/keyframes'

const STORAGE_KEY = 've:v1:project'

const VIDEO_FILTERS = [{ name: 'Video Files', extensions: ['insv', 'mp4', 'mov', 'mkv', 'webm'] }]
const PHOTO_FILTERS = [{ name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp'] }]
const AUDIO_FILTERS = [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg'] }]

const RESOLUTION_PRESETS: Record<string, { label: string; width: number; height: number }> = {
  '480': { label: '854 × 480 (SD)', width: 854, height: 480 },
  '720': { label: '1280 × 720 (HD)', width: 1280, height: 720 },
  '1080': { label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
  '1440': { label: '2560 × 1440 (QHD)', width: 2560, height: 1440 },
  '2160': { label: '3840 × 2160 (4K UHD)', width: 3840, height: 2160 },
  v720: { label: '720 × 1280 (Vertical HD)', width: 720, height: 1280 },
  v1080: { label: '1080 × 1920 (Vertical FHD)', width: 1080, height: 1920 },
  sq1080: { label: '1080 × 1080 (Square)', width: 1080, height: 1080 },
  cine: { label: '1920 × 804 (Cinematic 2.39:1)', width: 1920, height: 804 },
}

const RESOLUTION_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Landscape', keys: ['480', '720', '1080', '1440', '2160'] },
  { label: 'Vertical / Social', keys: ['v720', 'v1080'] },
  { label: 'Square', keys: ['sq1080'] },
  { label: 'Cinematic', keys: ['cine'] },
]

const FPS_OPTIONS = [24, 25, 30, 50, 60]

const DELIVERY_PRESETS: { name: string; res: keyof typeof RESOLUTION_PRESETS; fps: 24 | 25 | 30 | 50 | 60; codec: 'h264' | 'h265' }[] = [
  { name: 'YouTube / Web — 1080p', res: '1080', fps: 30, codec: 'h264' },
  { name: 'YouTube / Web — 4K', res: '2160', fps: 30, codec: 'h265' },
  { name: 'Instagram Reels / TikTok', res: 'v1080', fps: 30, codec: 'h264' },
  { name: 'Square feed post', res: 'sq1080', fps: 30, codec: 'h264' },
  { name: 'Cinematic master — 2.39:1 @ 24p', res: 'cine', fps: 24, codec: 'h265' },
  { name: 'Archive master (best quality)', res: '2160', fps: 30, codec: 'h265' },
]

function makeDefaultTracks(): TimelineTrack[] {
  return [
    { id: uid('track'), name: 'Video 1', type: 'video', isVisible: true, clips: [] },
    { id: uid('track'), name: 'Audio 1', type: 'audio', isVisible: true, clips: [] },
  ]
}

interface PersistedProject {
  schemaVersion?: number
  videos: LibraryVideo[]
  photos: LibraryPhoto[]
  audios: LibraryAudio[]
  tracks: TimelineTrack[]
  markers: TimelineMarker[]
}

const PROJECT_SCHEMA_VERSION = 2

/** sequential migrations; index N migrates version N -> N+1 */
const MIGRATIONS: Record<number, (p: PersistedProject) => PersistedProject> = {
  // 1 -> 2: additive fields only (markers, clip.title, audio flags) - no-op,
  // but guarantees every project carries the new shape going forward.
  1: (p) => ({ ...p, markers: Array.isArray(p.markers) ? p.markers : [] }),
}

function loadProject(): PersistedProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    let data = JSON.parse(raw) as PersistedProject
    if (!Array.isArray(data.videos) || !Array.isArray(data.tracks)) return null
    data.tracks = data.tracks.map((t) => ({ ...t, clips: Array.isArray(t.clips) ? t.clips : [] }))
    if (!Array.isArray(data.photos)) data.photos = []
    if (!Array.isArray(data.audios)) data.audios = []
    if (!Array.isArray(data.markers)) data.markers = []

    const from = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1
    for (let v = from; v < PROJECT_SCHEMA_VERSION; v++) {
      const migrate = MIGRATIONS[v]
      data = migrate ? migrate(data) : data
    }
    data.schemaVersion = PROJECT_SCHEMA_VERSION
    return data
  } catch {
    return null
  }
}

function App() {
  const saved = useRef<PersistedProject | null>(loadProject())

  const [videos, setVideos] = useState<LibraryVideo[]>(saved.current?.videos ?? [])
  const [photos, setPhotos] = useState<LibraryPhoto[]>(saved.current?.photos ?? [])
  const [audios, setAudios] = useState<LibraryAudio[]>(saved.current?.audios ?? [])
  const [tracks, setTracks] = useState<TimelineTrack[]>(
    saved.current?.tracks && saved.current.tracks.length > 0
      ? saved.current.tracks
      : makeDefaultTracks()
  )

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [pxPerSec, setPxPerSec] = useState(24)
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [ffmpegVersion, setFfmpegVersion] = useState<string | null>(null)
  const [convertingVideoId, setConvertingVideoId] = useState<string | null>(null)
  const [exportResolution, setExportResolution] =
    useState<keyof typeof RESOLUTION_PRESETS>('1080')
  const [exportFps, setExportFps] = useState(30)
  const [exportCodec, setExportCodec] = useState<'h264' | 'h265'>('h264')
  const [deliveryPreset, setDeliveryPreset] = useState('YouTube / Web — 1080p')
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportState, setExportState] = useState<ExportProgress | null>(null)
  const [markers, setMarkers] = useState<TimelineMarker[]>(saved.current?.markers ?? [])
  const [showShortcuts, setShowShortcuts] = useState(false)

  // ------------------------------------------------------- undo / redo (Cmd+Z)
  const projectSnapshot = useMemo(
    () => ({ videos, photos, audios, tracks }),
    [videos, photos, audios, tracks]
  )
  const applySnapshot = useCallback((snap: typeof projectSnapshot) => {
    setVideos(snap.videos)
    setPhotos(snap.photos)
    setAudios(snap.audios)
    setTracks(snap.tracks)
  }, [])
  const { undo, redo, canUndo, canRedo } = useProjectHistory(projectSnapshot, applySnapshot)

  // ------------------------------------------------------------------ persist
  const storageWarnRef = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION, videos, photos, audios, tracks, markers })
      )
      storageWarnRef.current = false
    } catch {
      // surface quota failures once per failure streak instead of every save
      if (!storageWarnRef.current) {
        storageWarnRef.current = true
        setError(
          'Project couldn’t be saved (storage full) — remove some thumbnails or media.'
        )
      }
    }
  }, [videos, photos, audios, tracks, markers])

  // -------------------------------------------------------------- ffmpeg init
  useEffect(() => {
    checkFfmpeg()
      .then((status) => {
        setFfmpegVersion(status.available ? status.version : null)
        if (!status.available) {
          setError(
            'ffmpeg was not found on this system. Install it (e.g. brew install ffmpeg) and restart.'
          )
        }
      })
      .catch(() => setError('Could not query ffmpeg availability.'))
  }, [])

  // ---------------------------------------------------------------- playback
  const videoTracksList = tracks.filter((t) => t.type === 'video')
  const audioTracksList = tracks.filter((t) => t.type === 'audio')
  const engine = usePlaybackEngine(videoTracksList, audioTracksList)

  // ------------------------------------------------------------- clip editing
  const updateClip = useCallback((trackId: string, clipId: string, patch: Partial<TimelineClip>) => {
    setTracks((prev) =>
      prev.map((track) =>
        track.id !== trackId
          ? track
          : {
              ...track,
              clips: track.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
            }
      )
    )
  }, [])

  const deleteClip = useCallback(
    (clipId: string) => {
      setTracks((prev) =>
        prev.map((track) => ({ ...track, clips: track.clips.filter((c) => c.id !== clipId) }))
      )
      setSelectedClipId((current) => (current === clipId ? null : current))
    },
    []
  )

  // ------------------------------------------------------------ track actions
  const addTrack = useCallback((type: TrackType) => {
    setTracks((prev) => {
      const count = prev.filter((t) => t.type === type).length + 1
      return [
        ...prev,
        { id: uid('track'), name: `${type === 'video' ? 'Video' : 'Audio'} ${count}`, type, isVisible: true, clips: [] },
      ]
    })
  }, [])

  const toggleTrack = useCallback((trackId: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, isVisible: !t.isVisible } : t))
    )
  }, [])

  const deleteTrack = useCallback((trackId: string) => {
    setTracks((prev) => {
      const next = prev.filter((t) => t.id !== trackId)
      return next.length > 0 ? next : makeDefaultTracks()
    })
  }, [])

  // ------------------------------------------------------------ inspector ops
  const selectedClipInfo = useMemo(() => {
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === selectedClipId)
      if (clip) return { track, clip }
    }
    return null
  }, [tracks, selectedClipId])

  const updateSelectedClip = useCallback(
    (patch: Partial<TimelineClip>) => {
      if (!selectedClipInfo) return
      updateClip(selectedClipInfo.track.id, selectedClipInfo.clip.id, patch)
    },
    [selectedClipInfo, updateClip]
  )

  const changeSelectedSpeed = useCallback(
    (speed: number) => {
      if (!selectedClipInfo) return
      const { clip } = selectedClipInfo
      const oldSpeed = clip.speed ?? 1
      const newDuration = Math.max(0.2, (clip.duration * oldSpeed) / speed)
      updateClip(selectedClipInfo.track.id, clip.id, { speed, duration: newDuration })
    },
    [selectedClipInfo, updateClip]
  )

  const inspectorPlayhead = selectedClipInfo
    ? engine.currentTime - selectedClipInfo.clip.position
    : null

  // --------------------------------------------------------- split at playhead
  const canSplit =
    !!selectedClipInfo &&
    inspectorPlayhead !== null &&
    inspectorPlayhead > 0.05 &&
    inspectorPlayhead < selectedClipInfo.clip.duration - 0.05

  const splitSelectedClip = useCallback(() => {
    if (!selectedClipInfo || inspectorPlayhead === null || !canSplit) return
    const { track, clip } = selectedClipInfo
    const t = inspectorPlayhead
    const speed = clip.speed ?? 1
    const kfs = clip.keyframes ?? []

    const left: TimelineClip = {
      ...clip,
      duration: t,
      keyframes: kfs.filter((k) => k.time <= t),
    }
    const right: TimelineClip = {
      ...clip,
      id: uid('clip'),
      position: clip.position + t,
      trimIn: clip.trimIn + t * speed,
      duration: clip.duration - t,
      keyframes: kfs
        .filter((k) => k.time > t)
        .map((k) => ({ ...k, time: Math.round((k.time - t) * 1000) / 1000 })),
    }

    setTracks((prev) =>
      prev.map((tr) =>
        tr.id !== track.id
          ? tr
          : { ...tr, clips: tr.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])) }
      )
    )
    setSelectedClipId(right.id)
  }, [selectedClipInfo, inspectorPlayhead, canSplit])

  // virtual-camera overlay while previewing a keyframed clip
  const activeOverlayClip = engine.activeVideoClip ?? engine.activePhotoClip
  const viewRect: ViewRect | null = useMemo(() => {
    const clip = activeOverlayClip
    if (!clip || !clip.keyframes || clip.keyframes.length === 0) return null
    const t = clamp(engine.currentTime - clip.position, 0, clip.duration)
    const is360 = !!clip.is360
    return computeViewRect(
      is360,
      interpolateChannel(clip.keyframes, t, 'pan', 0),
      interpolateChannel(clip.keyframes, t, 'tilt', 0),
      interpolateChannel(clip.keyframes, t, 'roll', 0),
      interpolateChannel(clip.keyframes, t, 'fov', is360 ? 90 : 1)
    )
  }, [activeOverlayClip, engine.currentTime])

  // --------------------------------------------------------- timeline adds
  const appendClipToTrack = useCallback(
    (type: TrackType, clip: Omit<TimelineClip, 'id' | 'position'>) => {
      setTracks((prev) => {
        const trackIndex = prev.findIndex((t) => t.type === type && t.isVisible)
        const fallbackIndex = prev.findIndex((t) => t.type === type)

        const fullClip: TimelineClip = { ...clip, id: uid('clip'), position: 0 }

        if (trackIndex >= 0 || fallbackIndex >= 0) {
          const index = trackIndex >= 0 ? trackIndex : fallbackIndex
          const target = prev[index]
          const end = target.clips.reduce((max, c) => Math.max(max, c.position + c.duration), 0)
          const nextTracks = [...prev]
          nextTracks[index] = {
            ...target,
            clips: [...target.clips, { ...fullClip, position: end }],
          }
          return nextTracks
        }

        const created: TimelineTrack = {
          id: uid('track'),
          name: type === 'video' ? 'Video 1' : 'Audio 1',
          type,
          isVisible: true,
          clips: [{ ...fullClip }],
        }
        return [...prev, created]
      })
    },
    []
  )

  const addVideoToTimeline = useCallback(
    async (video: LibraryVideo) => {
      // look for a sibling telemetry/subtitle file (DJI drones record these)
      let srtPath: string | null = null
      try {
        const res = await window.electronAPI.findSubtitle(video.path)
        if (res.ok) srtPath = res.srtPath
      } catch {
        // optional feature
      }
      appendClipToTrack('video', {
        sourceId: video.id,
        name: video.name,
        kind: 'video',
        path: video.path,
        trimIn: 0,
        duration: video.duration || 5,
        sourceDuration: video.duration || 5,
        speed: 1,
        is360: video.is360 ?? false,
        keyframes: [],
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        srtPath,
      })
    },
    [appendClipToTrack]
  )

  const addPhotoToTimeline = useCallback(
    (photo: LibraryPhoto) => {
      appendClipToTrack('video', {
        sourceId: photo.id,
        name: photo.name,
        kind: 'photo',
        path: photo.path,
        trimIn: 0,
        duration: PHOTO_DEFAULT_DURATION,
        sourceDuration: MAX_SOURCE,
      })
    },
    [appendClipToTrack]
  )

  const addAudioToTimeline = useCallback(
    (audio: LibraryAudio) => {
      appendClipToTrack('audio', {
        sourceId: audio.id,
        name: audio.name,
        kind: 'audio',
        path: audio.path,
        trimIn: 0,
        duration: audio.duration || 10,
        sourceDuration: audio.duration || 10,
      })
    },
    [appendClipToTrack]
  )

  // ------------------------------------------------------------------ imports
  const importVideos = useCallback(async () => {
    try {
      setError(null)
      const paths = await pickFiles(VIDEO_FILTERS)
      if (!paths || paths.length === 0) return

      const newItems: LibraryVideo[] = paths.map((p) => ({
        id: uid('vid'),
        name: fileNameOf(p),
        path: p,
        format: /\.insv$/i.test(p) ? 'insv' : /\.mp4$/i.test(p) ? 'mp4' : 'other',
        duration: 0,
        processing: true,
      }))
      setVideos((prev) => [...prev, ...newItems])

      for (let i = 0; i < newItems.length; i++) {
        setLoadingMessage(`Reading media ${i + 1} of ${newItems.length}…`)
        const item = newItems[i]
        try {
          const metadata = await fetchVideoMetadata(item.path)
          const thumbnail = await fetchThumbnail(item.path, Math.min(1.2, (metadata.duration || 2) * 0.1))
          const is360 =
            item.format === 'insv' ||
            (metadata.width > 0 && metadata.height > 0 && metadata.width / metadata.height > 1.9 && metadata.width / metadata.height < 2.15)
          setVideos((prev) =>
            prev.map((v) =>
              v.id === item.id
                ? {
                    ...v,
                    processing: false,
                    duration: metadata.duration,
                    thumbnail,
                    is360,
                    metadata: {
                      resolution: metadata.width && metadata.height ? `${metadata.width}×${metadata.height}` : undefined,
                      fps: metadata.fps ?? undefined,
                      codec: metadata.codec ?? undefined,
                      hasAudio: metadata.hasAudio,
                      is360,
                    },
                  }
                : v
            )
          )
        } catch (err) {
          setVideos((prev) => prev.map((v) => (v.id === item.id ? { ...v, processing: false } : v)))
          setError(`Could not read ${item.name}: ${(err as Error).message}`)
        }
      }
    } catch (err) {
      setError(`Import failed: ${(err as Error).message}`)
    } finally {
      setLoadingMessage(null)
    }
  }, [])

  const importPhotos = useCallback(async () => {
    try {
      setError(null)
      const paths = await pickFiles(PHOTO_FILTERS)
      if (!paths || paths.length === 0) return
      setPhotos((prev) => [
        ...prev,
        ...paths.map((p) => ({ id: uid('pho'), name: fileNameOf(p), path: p })),
      ])
    } catch (err) {
      setError(`Import failed: ${(err as Error).message}`)
    }
  }, [])

  const importMusic = useCallback(async () => {
    try {
      setError(null)
      const paths = await pickFiles(AUDIO_FILTERS)
      if (!paths || paths.length === 0) return

      const items: LibraryAudio[] = []
      for (const p of paths) {
        let duration = 0
        try {
          duration = (await fetchVideoMetadata(p)).duration
        } catch {
          // keep default
        }
        items.push({ id: uid('aud'), name: fileNameOf(p), path: p, duration })
      }
      setAudios((prev) => [...prev, ...items])
    } catch (err) {
      setError(`Import failed: ${(err as Error).message}`)
    }
  }, [])

  const removeVideo = useCallback((id: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== id))
  }, [])
  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id))
  }, [])
  const removeAudio = useCallback((id: string) => {
    setAudios((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const convertInsv = useCallback(
    async (id: string) => {
      const video = videos.find((v) => v.id === id)
      if (!video) return
      setConvertingVideoId(id)
      setError(null)
      try {
        const result = await convertInsvFile(video.path)
        if (!result.ok || !result.outputPath) {
          setError(`Conversion failed: ${result.error}`)
          return
        }
        try {
          const metadata = await fetchVideoMetadata(result.outputPath)
          const thumbnail = await fetchThumbnail(result.outputPath, 1)
          setVideos((prev) => [
            ...prev,
            {
              id: uid('vid'),
              name: fileNameOf(result.outputPath!),
              path: result.outputPath!,
              format: 'mp4',
              duration: metadata.duration,
              thumbnail,
              metadata: {
                resolution:
                  metadata.width && metadata.height ? `${metadata.width}×${metadata.height}` : undefined,
                fps: metadata.fps ?? undefined,
                codec: metadata.codec ?? undefined,
                hasAudio: metadata.hasAudio,
              },
            },
          ])
          setNotice(`Converted to MP4: ${fileNameOf(result.outputPath)}`)
        } catch (metaErr) {
          setError(`Converted, but could not read the new file: ${(metaErr as Error).message}`)
        }
      } finally {
        setConvertingVideoId(null)
      }
    },
    [videos]
  )

  // ---------------------------------------------------------------- keyboard
  const addMarker = useCallback(() => {
    setMarkers((prev) => [...prev, { id: uid('mark'), time: Math.round(engine.currentTime * 100) / 100 }])
    setNotice(null)
  }, [engine.currentTime])

  const removeMarker = useCallback((id: string) => {
    setMarkers((prev) => prev.filter((m) => m.id !== id))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault()
        deleteClip(selectedClipId)
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        splitSelectedClip()
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.code === 'Space') {
        e.preventDefault()
        engine.toggle()
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        addMarker()
      } else if (e.key === '?') {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      } else if (e.key === 'Escape') {
        setSelectedClipId(null)
        setShowShortcuts(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedClipId, deleteClip, splitSelectedClip, engine, undo, redo, addMarker])

  // ------------------------------------------------------------------- export
  const runExport = useCallback(async () => {
    if (exportState) return
    setError(null)

    const visualClips = videoTracksList
      .filter((t) => t.isVisible)
      .flatMap((t) => t.clips)
      .filter((c) => c.kind !== 'audio')
      .sort((a, b) => a.position - b.position)
    const musicClips = audioTracksList
      .filter((t) => t.isVisible)
      .flatMap((t) => t.clips)
      .sort((a, b) => a.position - b.position)

    if (visualClips.length === 0) {
      setError('Add at least one video or photo clip to the timeline before exporting.')
      return
    }

    const outputPath = await pickSavePath(`edit-${new Date().toISOString().slice(0, 10)}.mp4`)
    if (!outputPath) return

    const preset = RESOLUTION_PRESETS[exportResolution]
    engine.pause()
    setSelectedClipId(null)
    setExportState({ percent: 0, stage: 'Preparing export…' })

    let unsubscribe: (() => void) | null = null
    try {
      unsubscribe = window.electronAPI.onExportProgress((progress) => {
        setExportState({ percent: progress.percent, stage: progress.stage })
      })

      const result = await window.electronAPI.exportTimeline({
        outputPath,
        width: preset.width,
        height: preset.height,
        fps: exportFps,
        codec: exportCodec,
        visualClips: visualClips.map((c) => ({
          kind: c.kind === 'photo' ? ('photo' as const) : ('video' as const),
          path: c.path,
          position: c.position,
          trimIn: c.trimIn,
          duration: c.duration,
          speed: c.speed,
          is360: c.is360,
          lensFov: c.lensFov,
          keyframes: (c.keyframes ?? []).map((k) => ({ ...k })),
          colorAdjust: c.colorAdjust,
          stabilize: c.stabilize,
          fadeIn: c.fadeIn,
          fadeOut: c.fadeOut,
          volume: c.volume,
          muted: c.muted,
          title: c.title,
          audioDenoise: c.audioDenoise,
          audioNormalize: c.audioNormalize,
          rotate90: c.rotate90,
          logNormalize: c.logNormalize,
          lutPath: c.lutPath,
          subtitlesPath: c.burnSubtitles && c.srtPath ? c.srtPath : null,
        })),
        musicClips: musicClips.map((c) => ({
          path: c.path,
          position: c.position,
          trimIn: c.trimIn,
          duration: c.duration,
          duck: c.duckUnderVideo,
          denoise: c.audioDenoise,
          normalize: c.audioNormalize,
        })),
      })

      if (result.cancelled) {
        setNotice('Export cancelled.')
      } else if (result.ok) {
        setNotice(`Movie exported: ${outputPath}`)
      } else {
        setError(`Export failed: ${result.error}`)
      }
    } catch (err) {
      setError(`Export failed: ${(err as Error).message}`)
    } finally {
      if (unsubscribe) unsubscribe()
      setExportState(null)
    }
  }, [exportState, videoTracksList, audioTracksList, exportResolution, exportFps, exportCodec, engine])

  const openExportDialog = useCallback(() => {
    setError(null)
    setShowExportDialog(true)
  }, [])

  // -------------------------------------------------------------------- view
  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <h1>AeroSphere</h1>
          <span className="tagline">Drone · 360° · Editor</span>
          <span className={`ffmpeg-badge ${ffmpegVersion ? 'ok' : 'bad'}`}>
            {ffmpegVersion ? `ffmpeg ${ffmpegVersion}` : 'ffmpeg missing'}
          </span>
        </div>
        <div className="controls">
          <button
            className="btn-small"
            title="Keyboard shortcuts (?)"
            onClick={() => setShowShortcuts((v) => !v)}
          >
            ⌨ Shortcuts
          </button>
          <button className="btn-primary" onClick={openExportDialog}>
            Export Movie
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div className={`banner ${error ? 'banner-error' : 'banner-ok'}`}>
          <span>{error ?? notice}</span>
          <button
            className="btn-tiny"
            onClick={() => (error ? setError(null) : setNotice(null))}
          >
            ✕
          </button>
        </div>
      )}

      <ErrorBoundary>
      <main className="main-content">
        <MediaLibrary
          videos={videos}
          photos={photos}
          audios={audios}
          convertingVideoId={convertingVideoId}
          onImportVideos={importVideos}
          onImportPhotos={importPhotos}
          onImportMusic={importMusic}
          onAddVideo={addVideoToTimeline}
          onAddPhoto={addPhotoToTimeline}
          onAddAudio={addAudioToTimeline}
          onRemoveVideo={removeVideo}
          onRemovePhoto={removePhoto}
          onRemoveAudio={removeAudio}
          onConvertInsv={convertInsv}
        />

        <div className="right-column">
          <PreviewPlayer
            videoRef={engine.videoRef}
            hasVideo={!!engine.activeVideoClip}
            photoSrc={
              engine.activePhotoClip ? mediaUrl(engine.activePhotoClip.path) : null
            }
            viewRect={viewRect}
            activeTitle={
              (engine.activeVideoClip ?? engine.activePhotoClip)?.title ?? null
            }
            rotate90={(engine.activeVideoClip ?? engine.activePhotoClip)?.rotate90 ?? 0}
            currentTime={engine.currentTime}
            totalDuration={engine.totalDuration}
            isPlaying={engine.isPlaying}
            muted={engine.muted}
            onTogglePlay={engine.toggle}
            onToggleMute={() => engine.setMuted(!engine.muted)}
            onSeek={engine.seek}
          />

          <Timeline
            tracks={tracks}
            pxPerSec={pxPerSec}
            currentTime={engine.currentTime}
            totalDuration={engine.totalDuration}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
            onUpdateClip={updateClip}
            onSeek={(t) => {
              engine.seek(t)
              if (engine.isPlaying) engine.play()
            }}
            onToggleTrack={toggleTrack}
            onDeleteTrack={deleteTrack}
            onAddTrack={addTrack}
            onZoomChange={(pps) => setPxPerSec(Math.min(400, Math.max(2, pps)))}
            onSplit={splitSelectedClip}
            canSplit={canSplit}
            markers={markers}
            onAddMarker={addMarker}
            onRemoveMarker={removeMarker}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
        </div>

        <Inspector
          clip={selectedClipInfo?.clip ?? null}
          clipPlayhead={inspectorPlayhead}
          onUpdateClip={updateSelectedClip}
          onChangeSpeed={changeSelectedSpeed}
        />
      </main>
      </ErrorBoundary>

      {showShortcuts && (
        <div className="loading-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="export-card" onClick={(e) => e.stopPropagation()}>
            <h3>Keyboard shortcuts</h3>
            <table className="shortcut-table">
              <tbody>
                <tr><td><kbd>Space</kbd></td><td>Play / pause</td></tr>
                <tr><td><kbd>S</kbd></td><td>Split selected clip at playhead</td></tr>
                <tr><td><kbd>M</kbd></td><td>Add timeline marker</td></tr>
                <tr><td><kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd></td><td>Undo / redo</td></tr>
                <tr><td><kbd>Delete</kbd></td><td>Remove selected clip</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>Deselect / close dialogs</td></tr>
              </tbody>
            </table>
            <div className="dialog-actions">
              <button className="btn-primary" onClick={() => setShowShortcuts(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportDialog && !exportState && (
        <div className="loading-overlay">
          <div className="export-card">
            <h3>Export settings</h3>
            <div className="form-row">
              <label htmlFor="delivery-preset">Preset</label>
              <select
                id="delivery-preset"
                value={deliveryPreset}
                onChange={(e) => {
                  const name = e.target.value
                  setDeliveryPreset(name)
                  const preset = DELIVERY_PRESETS.find((p) => p.name === name)
                  if (preset) {
                    setExportResolution(preset.res)
                    setExportFps(preset.fps)
                    setExportCodec(preset.codec)
                  }
                }}
              >
                {DELIVERY_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
                <option value="Custom">Custom…</option>
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="export-resolution">Resolution</label>
              <select
                id="export-resolution"
                value={exportResolution}
                onChange={(e) =>
                  setExportResolution(e.target.value as keyof typeof RESOLUTION_PRESETS)
                }
              >
                {RESOLUTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.keys.map((key) => (
                      <option key={key} value={key}>
                        {RESOLUTION_PRESETS[key].label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="export-fps">Frame rate</label>
              <select
                id="export-fps"
                value={exportFps}
                onChange={(e) => setExportFps(Number(e.target.value))}
              >
                {FPS_OPTIONS.map((fps) => (
                  <option key={fps} value={fps}>
                    {fps} fps
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="export-codec">Encoder</label>
              <select
                id="export-codec"
                value={exportCodec}
                onChange={(e) => setExportCodec(e.target.value as typeof exportCodec)}
              >
                <option value="h264">H.264 (compatible)</option>
                <option value="h265">H.265 / HEVC (smaller)</option>
              </select>
            </div>
            <p className="export-meta">
              {videoTracksList.reduce((n, t) => n + t.clips.length, 0)} visual clips ·{' '}
              timeline length {formatTime(engine.totalDuration)}
            </p>
            <div className="dialog-actions">
              <button className="btn-secondary" onClick={() => setShowExportDialog(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setShowExportDialog(false)
                  runExport()
                }}
              >
                Continue…
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingMessage && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>{loadingMessage}</p>
        </div>
      )}

      {exportState && (
        <div className="loading-overlay">
          <div className="export-card">
            <h3>Exporting movie</h3>
            <p>{exportState.stage}</p>
            <div className="export-progress-track">
              <div className="export-progress-fill" style={{ width: `${exportState.percent}%` }} />
            </div>
            <p className="export-percent">{Math.round(exportState.percent)}%</p>
            <button
              className="btn-secondary"
              onClick={() => window.electronAPI.cancelExport()}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const MAX_SOURCE = 3600

export default App
