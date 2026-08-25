export type TrackType = 'video' | 'audio'

export interface MediaMetadataInfo {
  resolution?: string
  fps?: number
  codec?: string
  hasAudio?: boolean
  /** true for dual-fisheye/equirectangular 360 sources */
  is360?: boolean
  /** how the raw frames are laid out — drives v360 input selection */
  projection?: 'dfisheye' | 'equirect'
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
  projection?: 'dfisheye' | 'equirect'
  /** stitched equirectangular (vs raw dual-fisheye .insv) */
  equirect?: boolean
  /** sibling lens file for dual-fisheye .insv pairs */
  pairPath?: string | null
  /** front-lens ('10') counterpart when this entry is a complete X3 pair */
  pairedPath?: string
  /** imported without its matching lens file */
  missingPair?: boolean
  /** pre-stitched low-res LRV proxy shipped next to the .insv files */
  lrvPath?: string | null
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
  /** Lift/Gamma/Gain-style RGB balance (Resolve color wheels) */
  shadowsRed?: number
  shadowsGreen?: number
  shadowsBlue?: number
  midtonesRed?: number
  midtonesGreen?: number
  midtonesBlue?: number
  highlightsRed?: number
  highlightsGreen?: number
  highlightsBlue?: number
  /** PowerWindow-style vignette strength 0..1 */
  vignette?: number
  /** UltraSharpen-inspired: -1 (blur) .. 3 (crisp) */
  sharpen?: number
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
  /** frame layout of this 360° source */
  projection?: 'dfisheye' | 'equirect'
  /** front-lens counterpart for X3 dual-file sources */
  pairedPath?: string
  /** source is already-stitched equirectangular footage */
  equirect?: boolean
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
  /** front-lens counterpart for X3 dual-file sources */
  /** audio EQ: bass gain -1..1 (±12 dB) */
  eqBass?: number
  /** audio EQ: treble gain -1..1 (±12 dB) */
  eqTreble?: number
  /** remove mains hum at 50 or 60 Hz */
  dehum?: 'off' | '50' | '60'
  /** cross-dissolve from the previous clip, seconds (0 = hard cut) */
  dissolveIn?: number
  /** photo: slow automatic zoom-in over the clip duration */
  kenBurns?: boolean
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
  equirect?: boolean
  projection?: 'dfisheye' | 'equirect'
  /** side-by-side dual-fisheye master produced by combine-insv-pair */
  pairedPath?: string
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
  eqBass?: number
  eqTreble?: number
  dehum?: 'off' | '50' | '60'
  /** cross-dissolve from the previous clip, seconds (0 = hard cut) */
  dissolveIn?: number
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

export type OutputFormat = 'mp4' | 'mp4-hevc' | 'webm' | 'mov' | 'prores'

export interface ExportVideoTrack {
  clips: ExportVisualClip[]
}

export interface HwEncoders {
  h264: string | null
  h265: string | null
}

export interface ExportTimelineOptions {
  outputPath: string
  width: number
  height: number
  fps: number
  /** output container + codec family */
  format?: OutputFormat
  /** full track array in top-to-bottom stacking order */
  videoTracks: ExportVideoTrack[]
  musicClips: ExportMusicClip[]
  /** false forces software encoders even when hardware is available */
  useHwEncoding?: boolean
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
  detectHwEncoders: () => Promise<HwEncoders>
  getVideoMetadata: (filePath: string) => Promise<MetadataResult>
  generateThumbnail: (
    filePath: string,
    timeSec?: number
  ) => Promise<ThumbnailResult>
  convertInsv: (inputPath: string) => Promise<ConvertInsvResult>
  findSubtitle: (
    videoPath: string
  ) => Promise<{ ok: boolean; srtPath: string | null; error?: string }>
  generateProxy: (
    videoPath: string
  ) => Promise<{ ok: boolean; proxyPath?: string; existed?: boolean; error?: string }>
  preparePhoto: (
    photoPath: string
  ) => Promise<{ ok: boolean; path?: string; converted?: boolean; error?: string }>
  getPathForFile: (file: File) => string
  savePng: (
    dataUrl: string,
    defaultName: string
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  scanFolder: (
    dirPath: string
  ) => Promise<{ ok: boolean; videos: string[]; photos: string[]; audios: string[] }>
  combineInsvPair: (opts: {
    backPath: string
    frontPath: string
  }) => Promise<{ ok: boolean; outputPath?: string; error?: string }>
  findInsvPair: (insvPath: string) => Promise<{
    ok: boolean
    pairPath: string | null
    lrvPath?: string | null
    error?: string
  }>
  stitchInsv: (opts: {
    frontPath: string
    backPath: string
    lensFov?: number
    swapLenses?: boolean
    quality?: 'preview' | 'standard' | 'master'
    lrvPath?: string | null
  }) => Promise<{ ok: boolean; outputPath?: string; error?: string }>
  onStitchProgress: (
    callback: (progress: { percent: number }) => void
  ) => () => void

  exportTimeline: (options: ExportTimelineOptions) => Promise<ExportResult>
  cancelExport: () => Promise<{ ok: boolean }>
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
}
