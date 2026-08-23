import { describe, it, expect } from 'vitest'
import {
  outputSpec,
  buildFinalizeArgs,
  tempoChain,
  colorEqArgs,
  videoFadeArgs,
  lutArgs,
  copyLutToWorkDir,
  parseSrt,
  serializeSrt,
  buildTimelineSubtitles,
  clamp,
} from '../export-pipeline.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('tempoChain', () => {
  it('is empty at 1x', () => expect(tempoChain(1)).toEqual([]))
  it('splits 4x into two chained steps', () => {
    expect(tempoChain(4)).toEqual(['atempo=2.000000', 'atempo=2.000000'])
  })
  it('splits 0.25x into two half-speed steps', () => {
    expect(tempoChain(0.25)).toEqual(['atempo=0.500000', 'atempo=0.500000'])
  })
})

describe('colorEqArgs', () => {
  it('emits nothing for defaults', () => {
    expect(colorEqArgs({ brightness: 0, contrast: 0, saturation: 0 })).toEqual([])
    expect(colorEqArgs(undefined)).toEqual([])
  })
  it('maps temperature around 6500K with lightness preserved', () => {
    const [f] = colorEqArgs({ temperature: 0.25 })
    expect(f).toContain('temperature=7125')
    expect(f).toContain('pl=1')
  })
  it('routes tint through colorbalance gm', () => {
    expect(colorEqArgs({ tint: -0.5 })).toEqual(['colorbalance=gm=-0.500'])
  })
  it('includes gamma when set', () => {
    const [f] = colorEqArgs({ gamma: 0.3 })
    expect(f).toContain('gamma=1.300')
  })
})

describe('videoFadeArgs', () => {
  it('fade-in lands on the first span only', () => {
    const args = videoFadeArgs({ fadeIn: 0.5, fadeOut: 0 }, 0, 1, 4)
    expect(args).toEqual(['fade=t=in:st=0:d=0.500'])
  })
  it('fade-out is timed against the last span', () => {
    const args = videoFadeArgs({ fadeOut: 0.5 }, 3, 1, 4)
    expect(args).toEqual(['fade=t=out:st=0.500:d=0.500'])
  })
  it('ignores fades for middle segments', () => {
    expect(videoFadeArgs({ fadeIn: 0.5, fadeOut: 0.5 }, 1, 1, 4)).toEqual([])
  })
})

describe('srt handling', () => {
  const srt = `1
00:00:00,500 --> 00:00:01,500
ALT 120m

2
00:00:02,000 --> 00:00:04,000
SPD 10m/s
`
  it('parses entries', () => {
    const entries = parseSrt(srt)
    expect(entries).toHaveLength(2)
    expect(entries[0].start).toBeCloseTo(0.5, 6)
    expect(entries[1].text).toBe('SPD 10m/s')
  })

  it('round-trips through serializeSrt', () => {
    const out = parseSrt(serializeSrt(parseSrt(srt)))
    expect(out[1].start).toBeCloseTo(2, 6)
  })

  it('shifts, speed-scales and offsets for the timeline', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-srt-'))
    const srtPath = path.join(dir, 'clip.srt')
    fs.writeFileSync(srtPath, srt)
    const file = buildTimelineSubtitles(
      [{
        kind: 'video', path: 'x.mp4', position: 5, trimIn: 0.5, duration: 2,
        speed: 2, subtitlesPath: srtPath, burnSubtitles: true,
      }],
      dir
    )
    expect(file).toBe('telemetry.srt')
    const shifted = parseSrt(fs.readFileSync(path.join(dir, 'telemetry.srt'), 'utf8'))
    // entry 1: (0.5-0.5)/2 + 5 = 5 ; entry 2 ends at (4-0.5)/2+5 = 6.75 -> clipped at duration end 7
    expect(shifted[0].start).toBeCloseTo(5, 3)
    expect(shifted.length).toBeGreaterThan(0)
  })

  it('returns null when nothing opted in', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-srt-'))
    expect(buildTimelineSubtitles([{ kind: 'video', path: 'x.mp4', position: 0, trimIn: 0, duration: 2 }], dir)).toBeNull()
  })
})

describe('clamp / lutArgs / copyLutToWorkDir', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
  it('requires a colon-free lut file name', () => {
    expect(lutArgs(null)).toEqual([])
    expect(lutArgs('lut-0.cube')).toEqual(['lut3d=file=lut-0.cube'])
  })
  it('copies luts into the workdir with generated names', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aero-lut-'))
    const src = path.join(dir, 'C:\\fake\\look.cube')
    const safeSrc = path.join(dir, 'look.cube')
    fs.writeFileSync(safeSrc, 'LUT_3D_SIZE 2\n')
    expect(copyLutToWorkDir(safeSrc, 3, dir)).toBe('lut-3.cube')
    expect(fs.existsSync(path.join(dir, 'lut-3.cube'))).toBe(true)
    expect(copyLutToWorkDir(src, 4, dir)).toBeNull()
  })
})

describe('output formats', () => {
  it('defaults to mp4/h264 with plain copy finalization', () => {
    const spec = outputSpec(undefined)
    expect(spec.ext).toBe('mp4')
    expect(spec.videoCodec).toBe('h264')
    const fin = buildFinalizeArgs(spec, 'in.mp4', 'out.mp4')
    expect(fin.reencode).toBe(false)
    expect(fin.args.join(' ')).toContain('-c copy')
  })

  it('webm transcodes to vp9 + opus', () => {
    const spec = outputSpec('webm')
    expect(spec.ext).toBe('webm')
    const fin = buildFinalizeArgs(spec, 'in.mp4', 'out.webm')
    expect(fin.reencode).toBe(true)
    expect(fin.args.join(' ')).toContain('libvpx-vp9')
    expect(fin.args.join(' ')).toContain('libopus')
    expect(fin.args[fin.args.length - 1]).toBe('out.webm')
  })

  it('prores masters use prores_ks with pcm audio in mov', () => {
    const spec = outputSpec('prores')
    expect(spec.ext).toBe('mov')
    const fin = buildFinalizeArgs(spec, 'in.mp4', 'out.mov')
    expect(fin.reencode).toBe(true)
    expect(fin.args.join(' ')).toContain('prores_ks')
    expect(fin.args.join(' ')).toContain('pcm_s16le')
  })

  it('hevc keeps the mp4 fast path', () => {
    const spec = outputSpec('mp4-hevc')
    expect(spec.ext).toBe('mp4')
    expect(spec.videoCodec).toBe('h265')
    expect(buildFinalizeArgs(spec, 'a.mp4', 'b.mp4').reencode).toBe(false)
  })
})
