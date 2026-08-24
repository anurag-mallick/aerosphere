// Renderer-side wrappers around the Electron IPC bridge.
import type { VideoMetadata, ConvertInsvResult } from '../types/editor'

export type PreviewQuality = 'proxy' | 'full'

/** global preview-quality preference; 'proxy' serves .aeroproxy.mp4 when present */
let previewQuality: PreviewQuality = 'proxy'

export function setPreviewQuality(q: PreviewQuality) {
  previewQuality = q
}

export function getPreviewQuality(): PreviewQuality {
  return previewQuality
}

export function mediaUrl(filePath: string, quality?: PreviewQuality): string {
  const q = quality ?? previewQuality
  const base = `media://local/${encodeURIComponent(filePath)}`
  return q === 'full' ? `${base}?q=full` : base
}

const api = () => window.electronAPI

export async function checkFfmpeg() {
  return api().checkFfmpeg()
}

export async function fetchVideoMetadata(filePath: string): Promise<VideoMetadata> {
  const res = await api().getVideoMetadata(filePath)
  if (!res.ok || !res.metadata) {
    throw new Error(res.error || 'Failed to read media metadata')
  }
  return res.metadata
}

export async function fetchThumbnail(
  filePath: string,
  timeSec?: number
): Promise<string | undefined> {
  const res = await api().generateThumbnail(filePath, timeSec)
  if (res.ok && res.thumbnail) return res.thumbnail
  return undefined
}

export async function convertInsvFile(inputPath: string): Promise<ConvertInsvResult> {
  return api().convertInsv(inputPath)
}

export async function pickFiles(extensions: { name: string; extensions: string[] }[]) {
  return api().openFileDialog({ fileTypes: extensions })
}

export async function pickLutFile(): Promise<string | null> {
  const paths = await api().openFileDialog({
    fileTypes: [{ name: 'Cube LUT', extensions: ['cube'] }],
  })
  return paths && paths.length > 0 ? paths[0] : null
}

export async function pickSavePath(defaultName: string, ext = 'mp4') {
  const label = ext.toUpperCase()
  return api().saveFileDialog({
    title: 'Export Movie',
    defaultPath: defaultName,
    filters: [
      { name: label, extensions: [ext] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
}
