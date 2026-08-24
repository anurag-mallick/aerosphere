import { describe, it, expect } from 'vitest'
import { buildReframePlan, reframeFilterAt, sampleChannel } from '../keyframe-filter.js'
import { resolveBinary } from '../src-shared/ffmpeg-utils.js'

const kfs = [
  { time: 0, pan: 0, tilt: 0, roll: 0, fov: 90, easing: 'ease' },
  { time: 1, pan: 90, tilt: 20, roll: 0, fov: 60, easing: 'linear' },
  { time: 2, pan: -45, tilt: -10, roll: 15, fov: 100, easing: 'ease' },
]

describe('sampleChannel', () => {
  it('clamps before first and after last keyframe', () => {
    expect(sampleChannel(kfs, -1, 'pan')).toBe(0)
    expect(sampleChannel(kfs, 99, 'pan')).toBe(-45)
  })
  it('smoothsteps the eased segment', () => {
    expect(sampleChannel(kfs, 0.5, 'pan')).toBeCloseTo(45, 6)
    expect(sampleChannel(kfs, 0.25, 'pan')).toBeCloseTo(14.0625, 6)
  })
  it('interpolates linear segments linearly', () => {
    expect(sampleChannel(kfs, 1.5, 'pan')).toBeCloseTo(22.5, 6)
  })
})

describe('buildReframePlan — 360', () => {
  const plan = buildReframePlan({
    is360: true, lensFov: 220, width: 1280, height: 720,
    keyframes: kfs, trimIn: 0.5, duration: 2, speed: 1,
  })

  it('produces contiguous spans covering trimIn..trimIn+duration', () => {
    expect(plan.spans.length).toBeGreaterThan(3)
    expect(plan.spans[0].ss).toBeCloseTo(0.5, 6)
    const last = plan.spans[plan.spans.length - 1]
    expect(last.ss + last.dur).toBeLessThanOrEqual(2.5 + 1e-6)
    for (let i = 1; i < plan.spans.length; i++) {
      expect(plan.spans[i].ss).toBeCloseTo(plan.spans[i - 1].ss + plan.spans[i - 1].dur, 6)
    }
  })

  it('renders static v360 filters (no expressions to break parsing)', () => {
    for (const s of plan.spans) {
      expect(s.filter.startsWith('v360=dfisheye:e:id_fov=220')).toBe(true)
      expect(s.filter).not.toContain('?')
      expect(s.filter).not.toMatch(/if\(|lt\(|gt\(/)
    }
  })

  it('doubles source coverage at 2x speed', () => {
    const p2 = buildReframePlan({ ...base360(), speed: 2 })
    const total = p2.spans.reduce((s, sp) => s + sp.dur, 0)
    expect(total).toBeCloseTo(4, 5)
  })

  function base360() {
    return { is360: true, lensFov: 220, width: 1280, height: 720, keyframes: kfs, trimIn: 0.5, duration: 2 }
  }
})

describe('buildReframePlan — flat virtual camera', () => {
  it('uses animated crop + scale', () => {
    const plan = buildReframePlan({
      is360: false, width: 1920, height: 1080, keyframes: kfs, trimIn: 0, duration: 2,
    })
    expect(plan.hasReframing).toBe(true)
    for (const s of plan.spans) {
      expect(s.filter.startsWith('crop=')).toBe(true)
      expect(s.filter.includes('scale=1920:1080')).toBe(true)
    }
  })

  it('is a no-op without keyframes', () => {
    const plan = buildReframePlan({ is360: false, width: 1920, height: 1080, duration: 3 })
    expect(plan.spans).toHaveLength(1)
    expect(plan.spans[0].filter).toBe('')
  })
})

describe('static filters render through real ffmpeg', () => {
  it('mid-plan 360 filter is accepted', async () => {
    const { execFileSync } = await import('node:child_process')
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const plan = buildReframePlan({
      is360: true, lensFov: 210, width: 320, height: 180,
      keyframes: [
        { time: 0, pan: 0, tilt: 0, roll: 0, fov: 100, easing: 'ease' },
        { time: 2, pan: 90, tilt: 15, roll: 0, fov: 60, easing: 'ease' },
      ],
      trimIn: 0, duration: 2,
    })
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aero-')), 'seg.mp4')
    const mid = plan.spans[Math.floor(plan.spans.length / 2)].filter
    execFileSync(
      resolveBinary('ffmpeg'),
      ['-y', '-loglevel', 'error', '-f', 'lavfi',
       '-i', 'testsrc2=duration=0.4:size=512x256:rate=12',
       '-vf', mid, '-frames:v', '4', out],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    expect(fs.existsSync(out)).toBe(true)
  }, 30000)
})

describe('360 source projection selection', () => {
  const kf = [
    { time: 0, pan: 0, tilt: 0, roll: 0, fov: 90, easing: 'ease' },
    { time: 2, pan: 45, tilt: 10, roll: 0, fov: 80, easing: 'linear' },
  ]

  it('raw .insv style sources use the dfisheye input', () => {
    const plan = buildReframePlan({ is360: true, projection: 'dfisheye', lensFov: 220, width: 640, height: 360, duration: 2 })
    expect(plan.spans[0].filter).toContain('v360=dfisheye:e:id_fov=')
  })

  it('pre-stitched equirectangular sources use the equirect input (no id_fov)', () => {
    const plan = buildReframePlan({ is360: true, projection: 'equirect', width: 640, height: 360, duration: 2 })
    expect(plan.spans[0].filter).toMatch(/v360=e:e(:yaw|=)/)
    expect(plan.spans[0].filter).not.toContain('id_fov=')
    expect(plan.spans[0].filter).not.toContain('dfisheye')
  })

  it('animated keyframed filters keep the chosen input token', () => {
    const dfish = buildReframePlan({ is360: true, projection: 'dfisheye', lensFov: 210, width: 320, height: 180, keyframes: kf, duration: 2 })
    const eqr = buildReframePlan({ is360: true, projection: 'equirect', width: 320, height: 180, keyframes: kf, duration: 2 })
    expect(dfish.spans[0].filter).toContain('v360=dfisheye:e:')
    expect(eqr.spans[0].filter).toContain('v360=e:e:')
    expect(eqr.spans[0].filter).not.toContain('id_fov')
  })

  it('defaults to dfisheye when projection omitted (back-compat)', () => {
    const plan = buildReframePlan({ is360: true, lensFov: 220, width: 320, height: 180, duration: 1 })
    expect(plan.spans[0].filter).toContain('v360=dfisheye:e:id_fov=220')
  })
})
