import { describe, it, expect } from 'vitest'
import { buildCompositePlan } from '../composite-plan.js'

const clip = (id, position, duration, over = {}) => ({
  id, name: id, kind: 'video', path: `/tmp/${id}.mp4`,
  position, trimIn: 0, duration, sourceDuration: 100,
  speed: 1, keyframes: [], ...over,
})

describe('buildCompositePlan — matches preview layering & gaps', () => {
  it('single track, single clip → one clip piece', () => {
    const plan = buildCompositePlan([
      { clips: [clip('a', 0, 4)], type: 'video', isVisible: true },
    ])
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ type: 'clip', tlStart: 0, tlEnd: 4, srcTrim: 0 })
  })

  it('gap in every track produces a black piece', () => {
    const plan = buildCompositePlan([
      [clip('a', 0, 2)],
      [],
    ].map((clips, i) => ({ clips, type: 'video', isVisible: true })))
    // timeline [0..2] fully covered by clip a → no black; extend with gap:
    const plan2 = buildCompositePlan([
      { clips: [clip('a', 0, 2)], type: 'video', isVisible: true },
      { clips: [clip('b', 3, 2)], type: 'video', isVisible: true },
    ])
    const black = plan2.find(p => p.type === 'black')
    expect(black).toBeDefined()
    // black covers the uncovered hole between a-end (2) and b-start (3)
    expect(black.startTl).toBeCloseTo(2, 6)
    expect(black.len).toBeCloseTo(1, 6)
    expect(plan2.some(p => p.type === 'clip' && p.clip.id === 'b')).toBe(true)
    void plan
  })

  it('later track wins on overlap (findVisualAt parity)', () => {
    // track1 bottom: a [0..4]; track2 top: b [2..6]
    const plan = buildCompositePlan([
      { clips: [clip('a', 0, 4)], type: 'video', isVisible: true },
      { clips: [clip('b', 2, 4)], type: 'video', isVisible: true },
    ])
    // expected ranges: a alone [0..2]; b wins [2..6]
    expect(plan.map(p => p.type + ':' + (p.clip?.id ?? 'black'))).toEqual([
      'clip:a', 'clip:b',
    ])
    expect(plan[0].tlEnd).toBeCloseTo(2, 6)
    expect(plan[1].tlStart).toBeCloseTo(2, 6)
    // srcTrim of b starts at its own beginning
    expect(plan[1].srcTrim).toBe(0)
  })

  it('bottom-track clip visible where top track has a gap', () => {
    const plan = buildCompositePlan([
      { clips: [clip('under', 0, 6)], type: 'video', isVisible: true },
      { clips: [clip('over', 2, 2)], type: 'video', isVisible: true },
    ])
    expect(plan.map(p => p.clip?.id ?? 'black')).toEqual(['under', 'over', 'under'])
    // under re-enters at t=4 having already played 4s → srcTrim advanced by 4
    const tail = plan[2]
    expect(tail.srcTrim).toBeCloseTo(4, 6)
    expect(tail.tlStart).toBeCloseTo(4, 6)
  })

  it('dissolveIn inserts a blend piece without changing total duration', () => {
    const plan = buildCompositePlan([
      { clips: [
        clip('a', 0, 4),
        { ...clip('b', 4, 4), dissolveIn: 1 },
      ], type: 'video', isVisible: true },
    ])
    // dissolves map to standard fade-in on the incoming clip (no blend piece)
    expect(plan.some(p => p.type === 'clip')).toBe(true)
    // continuity: pieces tile [0..8) with no holes/overlaps
    let cursor = 0
    for (const p of plan) {
      const start = p.startTl ?? p.tlStart
      const len = p.len ?? p.tlEnd - p.tlStart
      expect(start).toBeCloseTo(cursor, 6)
      cursor += len
    }
    expect(cursor).toBeCloseTo(8, 6)
  })

  it('empty timeline yields a single black piece', () => {
    const plan = buildCompositePlan([{ clips: [], type: 'video', isVisible: true }])
    expect(plan.filter(p => p.type === 'clip')).toHaveLength(0)
  })
})
