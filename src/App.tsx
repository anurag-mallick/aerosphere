import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type {
  ExportProgress,
  LibraryAudio,
  LibraryPhoto,
  LibraryVideo,
  OutputFormat,
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
import { detect360Projection } from './utils/detect360'
import { parseX3PairKey } from './utils/insvPairing'

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
  ig45: { label: '1080 × 1350 (Instagram Feed 4:5)', width: 1080, height: 1350 },
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

/** Output containers/codecs offered in the export dialog */
const OUTPUT_FORMATS: {
  id: OutputFormat
  label: string
  ext: string
  hint: string
}[] = [
  { id: 'mp4', label: 'MP4 · H.264', ext: 'mp4', hint: 'universal — best for uploads' },
  { id: 'mp4-hevc', label: 'MP4 · H.265/HEVC', ext: 'mp4', hint: 'smaller files, modern players' },
  { id: 'webm', label: 'WebM · VP9', ext: 'webm', hint: 'web embeds, open format' },
  { id: 'mov', label: 'MOV · H.264', ext: 'mov', hint: 'Apple ecosystem handoff' },
  { id: 'prores', label: 'MOV · ProRes 422', ext: 'mov', hint: 'editing master — very large' },
]

type DeliveryPreset = {
  name: string
  res: keyof typeof RESOLUTION_PRESETS
  fps: 24 | 25 | 30 | 50 | 60
  format: OutputFormat
}

const DELIVERY_PRESETS: DeliveryPreset[] = [
  // YouTube
  { name: 'YouTube — 1080p', res: '1080', fps: 30, format: 'mp4' },
  { name: 'YouTube — 4K', res: '2160', fps: 30, format: 'mp4-hevc' },
  { name: 'YouTube Shorts — vertical', res: 'v1080', fps: 30, format: 'mp4' },
  // Instagram
  { name: 'Instagram Feed — 4:5 (1080×1350)', res: 'ig45', fps: 30, format: 'mp4' },
  { name: 'Instagram Reels / Stories', res: 'v1080', fps: 30, format: 'mp4' },
  { name: 'Instagram Square — 1:1', res: 'sq1080', fps: 30, format: 'mp4' },
  // Facebook
  { name: 'Facebook Feed — HD', res: '720', fps: 30, format: 'mp4' },
  { name: 'Facebook Feed — 1080p', res: '1080', fps: 30, format: 'mp4' },
  { name: 'Facebook Reels — vertical', res: 'v1080', fps: 30, format: 'mp4' },
  // Masters
  { name: 'Cinematic master — 2.39:1 @ 24p (ProRes)', res: 'cine', fps: 24, format: 'prores' },
  { name: 'Archive master (H.265)', res: '2160', fps: 30, format: 'mp4-hevc' },
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
  const [proxyBusyVideoId, setProxyBusyVideoId] = useState<string | null>(null)
  const [stitchingVideoId, setStitchingVideoId] = useState<string | null>(null)

const [exportResolution, setExportResolution] =
    useState<keyof typeof RESOLUTION_PRESETS>('1080')
  const [exportFps, setExportFps] = useState(30)
  const [exportFormat, setExportFormat] = useState<OutputFormat>('mp4')
  const [deliveryPreset, setDeliveryPreset] = useState('YouTube — 1080p')
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportState, setExportState] = useState<ExportProgress | null>(null)
  const [markers, setMarkers] = useState<TimelineMarker[]>(saved.current?.markers ?? [])
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [dragDepth, setDragDepth] = useState(0)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showInspector, setShowInspector] = useState(true)

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
    (clipId: string, ripple = false) => {
      setTracks((prev) =>
        prev.map((track) => {
          const target = track.clips.find((c) => c.id === clipId)
          if (!target) return { ...track, clips: track.clips.filter((c) => c.id !== clipId) }
          if (!ripple) return { ...track, clips: track.clips.filter((c) => c.id !== clipId) }
          // close the gap: pull later clips on the same track left
          const removedEnd = target.position + target.duration
          const shifted = track.clips
            .filter((c) => c.id !== clipId)
            .map((c) =>
              c.position >= removedEnd - 1e-6 ? { ...c, position: Math.max(0, c.position - target.duration) } : c
            )
          return { ...track, clips: shifted }
        })
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

  // Resolve-style grade copy/paste (color + log + LUT travel together)
  const copiedGradeRef = useRef<{
    colorAdjust?: TimelineClip['colorAdjust']
    logNormalize?: boolean
    lutPath?: string
  } | null>(null)
  const [hasCopiedGrade, setHasCopiedGrade] = useState(false)

  const copyGrade = useCallback(() => {
    if (!selectedClipInfo) return
    const { colorAdjust, logNormalize, lutPath } = selectedClipInfo.clip
    copiedGradeRef.current = { colorAdjust, logNormalize, lutPath }
    setHasCopiedGrade(true)
    setNotice('Grade copied — select another clip and paste.')
  }, [selectedClipInfo])

  const pasteGrade = useCallback(() => {
    const grade = copiedGradeRef.current
    if (!grade || !selectedClipInfo) return
    updateSelectedClip({
      colorAdjust: grade.colorAdjust,
      logNormalize: grade.logNormalize,
      lutPath: grade.lutPath,
    })
  }, [selectedClipInfo, updateSelectedClip])

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
        projection: video.projection,
        pairedPath: video.pairedPath,
        equirect: video.equirect ?? false,
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
  const importVideos = useCallback(async (override?: string[]) => {
    try {
      setError(null)
      const paths = override ?? (await pickFiles(VIDEO_FILTERS))
      if (!paths || paths.length === 0) return

      // Insta360 X3 dual-lens pairing (parseX3PairKey): two picked files with
      // the same key but lens codes 00/10 collapse into ONE library entry —
      // '00' back lens becomes `path`, '10' front lens becomes `pairedPath`.
      // A lone half still imports, flagged missingPair.
      interface X3Group {
        back?: string
        front?: string
        lrv?: string | null
      }
      const seen = new Set<string>()
      const groups = new Map<string, X3Group>()
      const order: { key: string | null; solo: string }[] = []

      for (const p of paths) {
        const pk = parseX3PairKey(fileNameOf(p))
        if (!pk) {
          if (!seen.has(p)) {
            seen.add(p)
            order.push({ key: null, solo: p })
          }
          continue
        }
        if (seen.has(pk.key)) continue
        seen.add(pk.key)
        order.push({ key: pk.key, solo: '' })
        groups.set(pk.key, {})
      }
      for (const p of paths) {
        const pk = parseX3PairKey(fileNameOf(p))
        if (!pk || !groups.has(pk.key)) continue
        const g = groups.get(pk.key)!
        if (pk.lens === '00') g.back = p
        else g.front = p
      }

      const resolved: { path: string; pairedPath: string | null; missingPair: boolean; display: string }[] = []
      for (const o of order) {
        if (!o.key) {
          resolved.push({ path: o.solo, pairedPath: null, missingPair: false, display: fileNameOf(o.solo) })
          continue
        }
        const g = groups.get(o.key)!
        const primary = g.back ?? g.front!
        const paired = g.back && g.front ? (g.back === primary ? g.front : g.back) : null

        let display = fileNameOf(primary).replace(/_(00|10)_/i, '_')

        // complete a half-imported pair straight from disk when possible
        let finalPaired = paired
        let missingPair = !finalPaired
        if (!finalPaired && g.back === primary && g.front !== undefined) {
          // picked only one side but both sides were in the folder scan — handled above
        }
        if (!finalPaired) {
          try {
            const r = await window.electronAPI.findInsvPair(primary)
            if (r.ok && r.pairPath) {
              finalPaired = r.pairPath
              missingPair = false
              display = display.replace(/\.insv$/i, '.insv')
            }
          } catch {
            // optional
          }
        }
        if (missingPair) {
          setError(
            `Missing paired lens file for ${display} — this X3 clip needs both _00_ and _10_ files to stitch correctly.`
          )
        }
        resolved.push({ path: primary, pairedPath: finalPaired, missingPair, display })
      }

      const newItems: LibraryVideo[] = resolved.map((r0) => ({
        id: uid('vid'),
        name: r0.display,
        path: r0.path,
        format: /\.insv$/i.test(r0.path) ? 'insv' : /\.mp4$/i.test(r0.path) ? 'mp4' : 'other',
        duration: 0,
        processing: true,
        pairedPath: r0.pairedPath ?? undefined,
        pairPath: r0.pairedPath,
        missingPair: r0.missingPair,
      }))
      setVideos((prev) => [...prev, ...newItems])

      for (let i = 0; i < newItems.length; i++) {
        setLoadingMessage(`Reading media ${i + 1} of ${newItems.length}…`)
        const item = newItems[i]
        try {
          const metadata = await fetchVideoMetadata(item.path)
          const thumbnail = await fetchThumbnail(item.path, Math.min(1.2, (metadata.duration || 2) * 0.1))
          const det = detect360Projection(item.path, metadata.width, metadata.height)
          const is360 = det.is360
          let lrvPath: string | null = null
          if (item.format === 'insv' && !item.pairPath) {
            try {
              const pair = await window.electronAPI.findInsvPair(item.path)
              lrvPath = pair.ok ? (pair.lrvPath ?? null) : null
            } catch {
              // optional feature
            }
          }
          setVideos((prev) =>
            prev.map((v) =>
              v.id === item.id
                ? {
                    ...v,
                    processing: false,
                    duration: metadata.duration,
                    thumbnail,
                    is360: is360 || !!item.pairPath || det.is360,
                    projection: item.pairPath ? 'dfisheye' : det.projection,
                    pairedPath: item.pairPath ?? undefined,
                    pairPath: item.pairPath ?? null,
                    lrvPath,
                    metadata: {
                      resolution: metadata.width && metadata.height ? `${metadata.width}×${metadata.height}` : undefined,
                      fps: metadata.fps ?? undefined,
                      codec: metadata.codec ?? undefined,
                      hasAudio: metadata.hasAudio,
                      is360: is360 || !!item.pairPath || det.is360,
                    },
                  }
                : v
            )
          )
        } catch (err) {
          setVideos((prev) => prev.filter((v) => v.id !== item.id))
          setError(`Skipped ${item.name}: ${(err as Error).message}`)
        }
      }
    } catch (err) {
      setError(`Import failed: ${(err as Error).message}`)
    } finally {
      setLoadingMessage(null)
    }
  }, [])

  // folder import: recursive scan, then route each media type through the
  // same pipelines used by manual imports (pairing included for .insv)
  const importFolder = useCallback(
    async (dirOverride?: string) => {
      try {
        setError(null)
        let dir = dirOverride
        if (!dir) {
          const dirs = await window.electronAPI.openDirectoryDialog()
          dir = dirs?.[0]
        }
        if (!dir) return
        setLoadingMessage('Scanning folder…')
        const res = await window.electronAPI.scanFolder(dir)
        if (!res.ok) throw new Error('scan failed')
        const total = (res.videos?.length ?? 0) + (res.photos?.length ?? 0) + (res.audios?.length ?? 0)
        if (total === 0) {
          setNotice('No supported media found in that folder.')
          return
        }
        if (res.videos?.length) await importVideos(res.videos)
        if (res.photos?.length) {
          setPhotos((prev) => [
            ...prev,
            ...res.photos.map((p) => ({ id: uid('pho'), name: fileNameOf(p), path: p })),
          ])
        }
        if (res.audios?.length) {
          const items: LibraryAudio[] = []
          for (const p of res.audios) {
            let duration = 0
            try {
              duration = (await fetchVideoMetadata(p)).duration
            } catch {
              // keep default
            }
            items.push({ id: uid('aud'), name: fileNameOf(p), path: p, duration })
          }
          setAudios((prev) => [...prev, ...items])
        }
        setNotice(`Imported ${total} file${total === 1 ? '' : 's'} from folder.`)
      } catch (err) {
        setError(`Folder import failed: ${(err as Error).message}`)
      } finally {
        setLoadingMessage(null)
      }
    },
    [importVideos]
  )


  const addPhotoEntries = useCallback(
    async (paths: string[]) => {
      const entries: LibraryPhoto[] = []
      for (const p of paths) {
        try {
          const res = await window.electronAPI.preparePhoto(p)
          entries.push({
            id: uid('pho'),
            name: fileNameOf(res.path ?? p),
            path: res.ok && res.path ? res.path : p,
          })
        } catch {
          entries.push({ id: uid('pho'), name: fileNameOf(p), path: p })
        }
      }
      setPhotos((prev) => [...prev, ...entries])
      return entries.length
    },
    []
  )

  // --------------------------------------------------- drag & drop import
  const VIDEO_EXTS = ['mp4', 'mov', 'insv', 'webm', 'mkv', 'm4v']
  const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'heic', 'webp']
  const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'ogg']

  const importDropped = useCallback(
    async (paths: string[]) => {
      try {
        const vids: string[] = []
        const phs: string[] = []
        const auds: string[] = []
        for (const p of paths) {
          const ext = p.split('.').pop()?.toLowerCase() ?? ''
          if (VIDEO_EXTS.includes(ext)) vids.push(p)
          else if (PHOTO_EXTS.includes(ext)) phs.push(p)
          else if (AUDIO_EXTS.includes(ext)) auds.push(p)
          else {
            // no/unknown extension → treat as a folder and scan it
            try {
              const res = await window.electronAPI.scanFolder(p)
              if (res.ok) {
                vids.push(...res.videos)
                phs.push(...res.photos)
                auds.push(...res.audios)
              }
            } catch {
              // unrecognizable entry — ignore
            }
          }
        }
        if (vids.length) await importVideos(vids)
        if (phs.length) {
          setPhotos((prev) => [...prev, ...phs.map((p2) => ({ id: uid('pho'), name: fileNameOf(p2), path: p2 }))])
        }
        if (auds.length) {
          const items: LibraryAudio[] = []
          for (const p2 of auds) {
            let duration = 0
            try {
              duration = (await fetchVideoMetadata(p2)).duration
            } catch {
              // keep default
            }
            items.push({ id: uid('aud'), name: fileNameOf(p2), path: p2, duration })
          }
          setAudios((prev) => [...prev, ...items])
        }
        const total = vids.length + phs.length + auds.length
        if (total > 0) setNotice(`Imported ${total} dropped item${total === 1 ? '' : 's'}.`)
      } catch (err) {
        setError(`Drop import failed: ${(err as Error).message}`)
      }
    },
    [importVideos]
  )

  // test/dev hook: automated UI tests drive imports through this
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__aeroTest = {
      importFolder: (dir: string) => importFolder(dir),
      importPathsGrouped: async (paths: string[]) => {
        const vids = paths.filter((p) => VIDEO_EXTS.includes(p.split('.').pop()?.toLowerCase() ?? ''))
        const phs = paths.filter((p) => PHOTO_EXTS.includes(p.split('.').pop()?.toLowerCase() ?? ''))
        const auds = paths.filter((p) => AUDIO_EXTS.includes(p.split('.').pop()?.toLowerCase() ?? ''))
        if (vids.length) await importVideos(vids)
        if (phs.length) await addPhotoEntries(phs)
        if (auds.length) {
          const items: LibraryAudio[] = []
          for (const p2 of auds) {
            let duration = 0
            try { duration = (await fetchVideoMetadata(p2)).duration } catch {}
            items.push({ id: uid('aud'), name: fileNameOf(p2), path: p2, duration })
          }
          setAudios((prev) => [...prev, ...items])
        }
      },
    }
  }, [importVideos])

  const importPhotos = useCallback(async () => {
    try {
      setError(null)
      const paths = await pickFiles(PHOTO_FILTERS)
      if (!paths || paths.length === 0) return
      await addPhotoEntries(paths)
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

  const generateProxy = useCallback(
    async (id: string) => {
      const video = videos.find((v) => v.id === id)
      if (!video) return
      setProxyBusyVideoId(id)
      setError(null)
      try {
        const res = await window.electronAPI.generateProxy(video.path)
        if (!res.ok) setError(`Proxy failed: ${res.error}`)
        else setNotice(res.existed ? 'Proxy already exists — preview will use it.' : '480p proxy ready — high-res footage now previews smoothly.')
      } finally {
        setProxyBusyVideoId(null)
      }
    },
    [videos]
  )

  // ---------------------------------------------- Insta360 X3 dual-file stitch
  const stitchInsvPair = useCallback(
    async (id: string, quality: 'preview' | 'standard' | 'master' = 'preview') => {
      const video = videos.find((v) => v.id === id)
      if (!video?.pairPath) return
      setStitchingVideoId(id)
      setError(null)
      let unsub: (() => void) | null = null
      try {
        unsub = window.electronAPI.onStitchProgress((p) => {
          setLoadingMessage(`Stitching 360° pair… ${Math.round(p.percent)}%`)
        })
        setLoadingMessage('Stitching 360° pair…')
        const res = await window.electronAPI.stitchInsv({
          frontPath: video.path,
          backPath: video.pairPath,
          quality,
          lrvPath: video.lrvPath,
        })
        if (!res.ok || !res.outputPath) {
          setError(`Stitch failed: ${res.error}`)
          return
        }
        const meta = await fetchVideoMetadata(res.outputPath)
        const thumbnail = await fetchThumbnail(res.outputPath, 1)
        setVideos((prev) => [
          ...prev,
          {
            id: uid('vid'),
            name: fileNameOf(res.outputPath!),
            path: res.outputPath!,
            format: 'mp4',
            duration: meta.duration,
            thumbnail,
            is360: true,
            equirect: true,
            metadata: { is360: true },
          },
        ])
        setNotice(`360° video stitched: ${fileNameOf(res.outputPath)} — add it to the timeline to reframe.`)
      } finally {
        unsub?.()
        setLoadingMessage(null)
        setStitchingVideoId(null)
      }
    },
    [videos]
  )

  const convertInsv = useCallback(
    async (id: string) => {
      const video = videos.find((v) => v.id === id)
      if (!video) return
      setConvertingVideoId(id)
      setError(null)
      try {
        let sourcePath = video.path
        if (video.pairedPath) {
          // X3 pair: build the side-by-side dual-fisheye master first, then
          // run the fast remux on THAT — not on the raw '00' lens alone.
          const comb = await window.electronAPI.combineInsvPair({
            backPath: video.path,
            frontPath: video.pairedPath,
          })
          if (!comb.ok || !comb.outputPath) {
            setError(`Pair combine failed: ${comb.error}`)
            return
          }
          sourcePath = comb.outputPath
        }
        const result = await convertInsvFile(sourcePath)
        if (!result.ok || !result.outputPath) {
          setError(`Conversion failed: ${result.error}`)
          return
        }
        try {
          const metadata = await fetchVideoMetadata(result.outputPath)
          const thumbnail = await fetchThumbnail(result.outputPath, 1)
          // a remux keeps the original dual-fisheye layout — force it instead
          // of trusting the (now .mp4) extension-based detection
          const det = detect360Projection(result.outputPath!, metadata.width, metadata.height)
          const projection: 'dfisheye' | 'equirect' =
            video.projection ?? det.projection ?? 'dfisheye'
          setVideos((prev) => [
            ...prev,
            {
              id: uid('vid'),
              name: fileNameOf(result.outputPath!),
              path: result.outputPath!,
              format: 'mp4',
              duration: metadata.duration,
              thumbnail,
              is360: true,
              projection,
              metadata: {
                resolution:
                  metadata.width && metadata.height ? `${metadata.width}×${metadata.height}` : undefined,
                fps: metadata.fps ?? undefined,
                codec: metadata.codec ?? undefined,
                hasAudio: metadata.hasAudio,
                is360: true,
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

  // -------------------------------------------------- duplicate / marker nav
  const duplicateSelected = useCallback(() => {
    if (!selectedClipInfo) return
    const { track, clip } = selectedClipInfo
    const copy: TimelineClip = {
      ...clip,
      id: uid('clip'),
      keyframes: (clip.keyframes ?? []).map((k) => ({ ...k, id: uid('kf') })),
    }
    setTracks((prev) =>
      prev.map((tr) =>
        tr.id !== track.id
          ? tr
          : {
              ...tr,
              clips: [...tr.clips, { ...copy, position: clip.position + clip.duration }],
            }
      )
    )
  }, [selectedClipInfo])

  const jumpMarker = useCallback(
    (dir: 1 | -1) => {
      const t = engine.currentTime
      const sorted = markers.map((m) => m.time).sort((a, b) => a - b)
      const target =
        dir === 1 ? sorted.find((m) => m > t + 0.05) : [...sorted].reverse().find((m) => m < t - 0.05)
      engine.seek(target ?? clamp(t + dir, 0, engine.totalDuration))
    },
    [markers, engine]
  )

  // ------------------------------------------------------- grab still frame
  const captureFrame = useCallback(async () => {
    try {
      let dataUrl: string | null = null
      if (engine.activeVideoClip && engine.videoRef.current && engine.videoRef.current.videoWidth > 0) {
        const v = engine.videoRef.current
        const canvas = document.createElement('canvas')
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        canvas.getContext('2d')?.drawImage(v, 0, 0)
        dataUrl = canvas.toDataURL('image/png')
      } else if (engine.activePhotoClip) {
        const img = document.querySelector<HTMLImageElement>('.preview-photo')
        if (img && img.naturalWidth > 0) {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          canvas.getContext('2d')?.drawImage(img, 0, 0)
          dataUrl = canvas.toDataURL('image/png')
        }
      }
      if (!dataUrl) {
        setError('Nothing to capture — play or seek to a frame first.')
        return
      }
      const res = await window.electronAPI.savePng(
        dataUrl,
        `frame-${Math.round(engine.currentTime * 1000)}ms.png`
      )
      if (res.ok) setNotice(`Still saved: ${res.path}`)
      else if (res.error) setError(res.error)
    } catch (err) {
      setError(`Capture failed: ${(err as Error).message}`)
    }
  }, [engine])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault()
        deleteClip(selectedClipId, e.shiftKey)
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        splitSelectedClip()
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        duplicateSelected()
      } else if (e.code === 'Space') {
        e.preventDefault()
        engine.toggle()
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        addMarker()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        jumpMarker(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        jumpMarker(-1)
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
  }, [selectedClipId, deleteClip, splitSelectedClip, engine, undo, redo, addMarker, duplicateSelected, jumpMarker])

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

    const fmtMeta = OUTPUT_FORMATS.find((f) => f.id === exportFormat)
    const outputPath = await pickSavePath(
      `aerosphere-${new Date().toISOString().slice(0, 10)}.${fmtMeta?.ext ?? 'mp4'}`,
      fmtMeta?.ext ?? 'mp4'
    )
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
        format: exportFormat,
        visualClips: visualClips.map((c) => ({
          kind: c.kind === 'photo' ? ('photo' as const) : ('video' as const),
          path: c.path,
          position: c.position,
          trimIn: c.trimIn,
          duration: c.duration,
          speed: c.speed,
          is360: c.is360,
          projection: c.projection,
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
          equirect: c.equirect,
          pairedPath: c.pairedPath,
          dissolveIn: c.dissolveIn,
          kenBurns: c.kenBurns,
          eqBass: c.eqBass || 0,
          eqTreble: c.eqTreble || 0,
          dehum: c.dehum || 'off',
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
          eqBass: c.eqBass || 0,
          eqTreble: c.eqTreble || 0,
          dehum: c.dehum || 'off',
          durationTl: c.duration,
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
  }, [exportState, videoTracksList, audioTracksList, exportResolution, exportFps, exportFormat, engine])

  const openExportDialog = useCallback(() => {
    setError(null)
    setShowExportDialog(true)
  }, [])

  // -------------------------------------------------------------------- view
  return (
    <div
      className={`app ${showSidebar ? '' : 'hide-sidebar'} ${showInspector ? '' : 'hide-inspector'}`}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragDepth((d) => d + 1)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        setDragDepth((d) => Math.max(0, d - 1))
      }}
      onDrop={async (e) => {
        e.preventDefault()
        setDragDepth(0)
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => !!p)
        if (paths.length === 0) return
        setLoadingMessage('Importing dropped items…')
        await importDropped(paths)
        setLoadingMessage(null)
      }}
    >
      {dragDepth > 0 && (
        <div className="drop-overlay">
          <div className="drop-message">⬇ Drop video · photo · audio files or whole folders</div>
        </div>
      )}
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
            className={`btn-small ${showSidebar ? 'active' : ''}`}
            title="Toggle media library"
            onClick={() => setShowSidebar((v) => !v)}
          >
            📚 Library
          </button>
          <button
            className={`btn-small ${showInspector ? 'active' : ''}`}
            title="Toggle inspector"
            onClick={() => setShowInspector((v) => !v)}
          >
            🧰 Inspector
          </button>
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
          onGenerateProxy={generateProxy}
          proxyBusyVideoId={proxyBusyVideoId}
          onImportFolder={(dir) => importFolder(dir)}
          onStitchInsv={stitchInsvPair}
          stitchingVideoId={stitchingVideoId}
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
            onCaptureFrame={captureFrame}
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
          onCopyGrade={() => copyGrade()}
          canPasteGrade={hasCopiedGrade}
          onPasteGrade={pasteGrade}
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
                    setExportFormat(preset.format)
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
              <label htmlFor="export-format">Format</label>
              <select
                id="export-format"
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as OutputFormat)}
              >
                {OUTPUT_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} — {f.hint}
                  </option>
                ))}
              </select>
            </div>
            <p className="export-meta">
              {videoTracksList.reduce((n, t) => n + t.clips.length, 0)} visual clips ·{' '}
              timeline length {formatTime(engine.totalDuration)} · saves as{' '}
              .{OUTPUT_FORMATS.find((f) => f.id === exportFormat)?.ext}
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
