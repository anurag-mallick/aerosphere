export type TrackType = 'video' | 'audio'

export interface MediaMetadataInfo {
  resolution?: string
  fps?: number
  codec?: string
  hasAudio?: boolean
  /** true for dual-fisheye/equirectangular 360 sources */
  is360?: boolean
}

export interface LibraryVideo {
  id: string
  name: string
  path: string
  format: 'insv' | 'mp4' | 'other'
  duration: number
  thumbnail?: string
  metadata?: MediaMetadataInfo
  processing?: boolean
  converting?: boolean
  is360?: boolean
}

export interface LibraryPhoto {
  id: string
  name: string
  path: string
}

export interface LibraryAudio {
  id: string
  name: string
  path: string
  duration: number
}

export interface TimelineClip {
  id: string
  sourceId: string
  name: string
  kind: 'video' | 'photo' | 'audio'
  path: string
  /** seconds on the timeline */
  position: number
  /** seconds into the source where playback starts */
  trimIn: number
  /** seconds this clip occupies on the timeline */
  duration: number
  /** full usable length of the source (photos have no hard limit) */
  sourceDuration: number
}

export interface TimelineTrack {
  id: string
  name: string
  type: TrackType
  isVisible: boolean
  clips: TimelineClip[]
}

export const PHOTO_DEFAULT_DURATION = 4

// ---------------------------------------------------------------------------
// Keyframed reframing (Insta360 Studio-style)
// ---------------------------------------------------------------------------

export type EasingMode = 'linear' | 'ease'

export interface ClipKeyframe {
  id: string
  /** seconds relative to the clip's start on the timeline */
  time: number
  /** degrees (360°) or percent offset -100..100 (flat) */
  pan: number
  /** degrees (360°) or percent offset -100..100 (flat) */
  tilt: number
  /** roll degrees (360° and flat rotate) */
  roll: number
  /** vertical field of view in degrees for 360° (20..140); zoom factor for flat (1..4) */
  fov: number
  easing: EasingMode
}

export interface ClipColorAdjust {
  /** -1..1 */
  brightness: number
  /** -1..1 mapped to contrast 1+v */
  contrast: number
  /** -1..1 mapped to saturation 1+v */
  saturation: number
  /** -1..1 mapped around 6500K (colortemperature filter) */
  temperature?: number
  /** -1..1 green/magenta balance */
  tint?: number
  /** -1..1 mapped to gamma 1+v */
  gamma?: number
}

export interface TimelineClip {
  id: string
  sourceId: string
  name: string
  kind: 'video' | 'photo' | 'audio'
  path: string
  /** seconds on the timeline */
  position: number
  /** seconds into the source where playback starts */
  trimIn: number
  /** seconds this clip occupies on the timeline */
  duration: number
  /** full usable length of the source (photos have no hard limit) */
  sourceDuration: number
  /** playback speed multiplier applied to the trimmed section (1 = normal) */
  speed?: number
  /** dual-fisheye / equirectangular source -> reframe with v360 instead of crop */
  is360?: boolean
  /** source lens FOV used when converting dual-fisheye input */
  lensFov?: number
  keyframes?: ClipKeyframe[]
  colorAdjust?: ClipColorAdjust
  /** two-pass vidstab stabilization during export (flat videos only) */
  stabilize?: boolean
  /** video fade-in seconds (0 = off) */
  fadeIn?: number
  /** video fade-out seconds (0 = off) */
  fadeOut?: number
  /** audio gain multiplier for this clip's own sound (1 = original) */
  volume?: number
  /** normalize flat log footage (e.g. DJI D-Log M) towards Rec.709 on export */
  logNormalize?: boolean
  /** custom .cube LUT applied after log normalization */
  lutPath?: string
  /** sibling .srt telemetry file detected next to the source video */
  srtPath?: string | null
  /** burn the .srt telemetry/subtitle track into the exported video */
  burnSubtitles?: boolean
  /** silence this clip's own audio in preview and export */
  muted?: boolean
  /** FFmpeg afftdn noise reduction on this clip's audio */
  audioDenoise?: boolean
  /** normalize this clip's audio to -16 LUFS */
  audioNormalize?: boolean
  /** music clip: automatically dip under dialogue/video audio */
  duckUnderVideo?: boolean
  /** static quarter-turn rotation applied to this clip only */
  rotate90?: 0 | 90 | 180 | 270
  /** burned-in text overlay (titles à la FCP/Resolve) */
  title?: ClipTitle
}

export interface ClipTitle {
  text: string
  /** font size in px at export resolution */
  size: number
  position: 'top' | 'bottom'
}

export interface TimelineMarker {
  id: string
  /** seconds on the timeline */
  time: number
}

// ---------------------------------------------------------------------------
// Electron bridge (exposed by src/preload.js)
// ---------------------------------------------------------------------------

export interface VideoMetadata {
  duration: number
  width: number
  height: number
  codec: string | null
  fps: number | null
  hasAudio: boolean
}

export type FileDialogOptions = {
  fileTypes?: { name: string; extensions: string[] }[]
}

export interface ExportVisualClip {
  kind: 'video' | 'photo'
  path: string
  position: number
  trimIn: number
  duration: number
  speed?: number
  is360?: boolean
  lensFov?: number
  keyframes?: TimelineClip['keyframes']
  colorAdjust?: ClipColorAdjust
  stabilize?: boolean
  fadeIn?: number
  fadeOut?: number
  volume?: number
  logNormalize?: boolean
  lutPath?: string
  subtitlesPath?: string | null
  muted?: boolean
  title?: ClipTitle
  audioDenoise?: boolean
  audioNormalize?: boolean
  rotate90?: 0 | 90 | 180 | 270
}

export interface ExportMusicClip {
  path: string
  position: number
  trimIn: number
  duration: number
  /** duck this music clip under video/dialogue audio (sidechain) */
  duck?: boolean
  denoise?: boolean
  normalize?: boolean
}

export interface ExportTimelineOptions {
  outputPath: string
  width: number
  height: number
  fps: number
  codec: 'h264' | 'h265'
  visualClips: ExportVisualClip[]
  musicClips: ExportMusicClip[]
}

export interface ExportResult {
  ok: boolean
  cancelled: boolean
  outputPath?: string
  error?: string
}

export interface FfmpegStatus {
  available: boolean
  version: string | null
}

export interface MetadataResult {
  ok: boolean
  metadata?: VideoMetadata
  error?: string
}

export interface ThumbnailResult {
  ok: boolean
  thumbnail?: string
  error?: string
}

export interface ConvertInsvResult {
  ok: boolean
  outputPath?: string
  error?: string
}

export interface ExportProgress {
  percent: number
  stage: string
}

export interface ElectronAPI {
  openFileDialog: (options: FileDialogOptions) => Promise<string[]>
  saveFileDialog: (options: {
    title?: string
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }) => Promise<string | null>
  openDirectoryDialog: () => Promise<string[]>

  checkFfmpeg: () => Promise<FfmpegStatus>
  getVideoMetadata: (filePath: string) => Promise<MetadataResult>
  generateThumbnail: (
    filePath: string,
    timeSec?: number
  ) => Promise<ThumbnailResult>
  convertInsv: (inputPath: string) => Promise<ConvertInsvResult>
  findSubtitle: (
    videoPath: string
  ) => Promise<{ ok: boolean; srtPath: string | null; error?: string }>

  exportTimeline: (options: ExportTimelineOptions) => Promise<ExportResult>
  cancelExport: () => Promise<{ ok: boolean }>
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
}
