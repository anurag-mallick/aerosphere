import { describe, it, expect } from 'vitest'
import { selectHwEncoders } from '../src-shared/ffmpeg-utils.js'

// Mock `ffmpeg -hide_banner -encoders` stdout slices. Real listings look like:
//  V....D h264_videotoolbox   VideoToolbox H.264 Encoder (codec h264)
const VT_OUT = `
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libx265              libx265 H.265 / HEVC (codec hevc)
 V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V....D hevc_videotoolbox    VideoToolbox HEVC Encoder (codec hevc)
`
const NVENC_OUT = `
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
 V....D h264_qsv             Intel Quick Sync Video H.264 Encoder (codec h264)
`
const NONE_OUT = `
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
`

describe('selectHwEncoders', () => {
  it('selects videotoolbox on darwin when present', () => {
    expect(selectHwEncoders(VT_OUT, 'darwin')).toEqual({
      h264: 'h264_videotoolbox',
      h265: 'hevc_videotoolbox',
    })
  })

  it('selects nvenc over qsv on win32 (preference order)', () => {
    expect(selectHwEncoders(NVENC_OUT, 'win32')).toEqual({
      h264: 'h264_nvenc',
      h265: 'hevc_nvenc',
    })
  })

  it('falls to qsv on linux when nvenc absent', () => {
    const qsvOnly = `
 V....D h264_qsv             Intel Quick Sync Video H.264 Encoder (codec h264)
`
    expect(selectHwEncoders(qsvOnly, 'linux')).toEqual({
      h264: 'h264_qsv',
      h265: null,
    })
  })

  it('returns nulls when no hardware encoders exist (CI runners)', () => {
    expect(selectHwEncoders(NONE_OUT, 'darwin')).toEqual({ h264: null, h265: null })
    expect(selectHwEncoders(NONE_OUT, 'linux')).toEqual({ h264: null, h265: null })
  })

  it('handles empty/absent output', () => {
    expect(selectHwEncoders('', 'darwin')).toEqual({ h264: null, h265: null })
    expect(selectHwEncoders(null, 'win32')).toEqual({ h264: null, h265: null })
  })

  it('does not match partial ids (h264_qsvox must not satisfy h264_qsv)', () => {
    const tricky = ' V....D h264_qsvox  fake encoder (codec h264)\n'
    expect(selectHwEncoders(tricky, 'win32').h264).toBeNull()
  })

  it('darwin never picks nvenc even when listed', () => {
    expect(selectHwEncoders(NVENC_OUT, 'darwin')).toEqual({ h264: null, h265: null })
  })
})
