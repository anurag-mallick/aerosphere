import { describe, it, expect } from 'vitest'
import { buildStitchGraph, findInsvPairName } from '../src-shared/stitch-filter.js'

describe('buildStitchGraph (Insta360 X3 dual-fisheye)', () => {
  it('projects each lens onto half the equirect frame and hstacks', () => {
    const { args } = buildStitchGraph({ width: 3840, height: 1920, fps: 30 })
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('[0:v]fps=30')
    expect(fc).toContain('v360=fisheye:e:id_fov=220:yaw=-90:roll=0:w=1920:h=1920')
    expect(fc).toContain('yaw=90:roll=0:w=1920:h=1920')
    expect(fc).toContain('[half0][half1]hstack=inputs=2')
    expect(args).toContain('-map')
    expect(args).toContain('0:a:0?')
  })

  it('supports sample-limited test renders and custom fov', () => {
    const { args } = buildStitchGraph({ width: 1536, height: 768, lensFov: 200, sampleSeconds: 8 })
    expect(args).toContain('-t')
    expect(args[args.indexOf('-t') + 1]).toBe('8')
    const fc = args[args.indexOf('-filter_complex') + 1]
    expect(fc).toContain('id_fov=200')
  })
})

describe('findInsvPairName', () => {
  it('matches X3 dual-file naming in both directions', () => {
    const sibs = ['VID_20260808_130327_00_020.insv', 'VID_20260808_130327_10_020.insv']
    expect(findInsvPairName(sibs[0], sibs)).toBe('vid_20260808_130327_10_020.insv')
    expect(findInsvPairName(sibs[1], sibs)).toBe('vid_20260808_130327_00_020.insv')
  })
  it('returns null when no counterpart exists', () => {
    expect(findInsvPairName('VID_x_00_y.insv', ['VID_x_00_y.insv'])).toBeNull()
    expect(findInsvPairName('random.mp4', ['random.mp4'])).toBeNull()
  })
})
