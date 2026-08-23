import { describe, it, expect } from 'vitest'
import { expandTimelinePieces } from '../export-pipeline.js'

const base = (over = {}) => ({
  kind: 'video', path: 'x.mp4', position: 0, trimIn: 0,
  duration: 4, sourceDuration: 10, speed: 1, keyframes: [], ...over,
})

describe('expandTimelinePieces — dissolves', () => {
  it('hard cut by default: two clips stay whole', () => {
    const pieces = expandTimelinePieces([
      base({ id: 'a' }),
      base({ id: 'b', position: 4 }),
    ])
    expect(pieces.filter((p) => p.type === 'clip')).toHaveLength(2)
    expect(pieces.some((p) => p.type === 'blend')).toBe(false)
  })

  it('dissolve splits into prev-tail + blend + cur-head with preserved total time', () => {
    const pieces = expandTimelinePieces([
      base({ id: 'a' }),
      base({ id: 'b', position: 4, dissolveIn: 1 }),
    ])
    const blend = pieces.find((p) => p.type === 'blend')
    expect(blend).toBeDefined()
    expect(blend.len).toBe(1)
    expect(blend.startTl).toBe(4)

    const clips = pieces.filter((p) => p.type === 'clip')
    expect(clips).toHaveLength(2)
    // prev trimmed by the shared second
    const a = clips.find((p) => p.clip.id === 'a')
    expect(a.tlEnd - a.tlStart).toBeCloseTo(3, 6)
    // current skips its first shared second
    const b = clips.find((p) => p.clip.id === 'b')
    expect(b.tlStart - b.clip.position).toBeCloseTo(1, 6)
    expect(b.srcTrim).toBeCloseTo(1, 6)
    // total timeline unchanged
    expect(b.tlEnd).toBeCloseTo(8, 6)
  })

  it('clamps dissolve to 40% of either neighbor duration', () => {
    const pieces = expandTimelinePieces([
      base({ id: 'short', duration: 0.5 }),
      base({ id: 'b', position: 0.5, dissolveIn: 2 }),
    ])
    const blend = pieces.find((p) => p.type === 'blend')
    expect(blend.len).toBeLessThanOrEqual(0.2) // 40% of 0.5
  })
})
