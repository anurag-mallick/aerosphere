import { describe, it, expect } from 'vitest'
import { parseX3PairKey } from '../src/utils/insvPairing'

describe('parseX3PairKey', () => {
  const FRONT = 'VID_20260808_130327_10_020.insv'
  const BACK = 'VID_20260808_130327_00_020.insv'

  it('parses a valid back-lens (00) file', () => {
    expect(parseX3PairKey(BACK)).toEqual({
      key: 'VID_20260808_130327__020.insv',
      lens: '00',
    })
  })

  it('parses a valid front-lens (10) file', () => {
    expect(parseX3PairKey(FRONT)).toEqual({
      key: 'VID_20260808_130327__020.insv',
      lens: '10',
    })
  })

  it('pairs share the same key but different lenses', () => {
    const back = parseX3PairKey(BACK)
    const front = parseX3PairKey(FRONT)
    expect(back).not.toBeNull()
    expect(front).not.toBeNull()
    expect(back.key).toBe(front.key)
    expect(back.lens).toBe('00')
    expect(front.lens).toBe('10')
  })

  it('is case-insensitive on the .insv extension', () => {
    const r = parseX3PairKey('VID_20260808_130327_00_020.INSV')
    expect(r).toEqual({ key: 'VID_20260808_130327__020.insv', lens: '00' })
  })

  it('pairs require matching sequence numbers — differing NNN yields distinct keys', () => {
    const a = parseX3PairKey('VID_20250101_095959_00_001.insv')
    const b = parseX3PairKey('VID_20250101_095959_10_007.insv')
    expect(a.key).not.toBe(b.key)
    // but the same recording always shares its key
    const a2 = parseX3PairKey('VID_20250101_095959_10_001.insv')
    expect(a2.key).toBe(a.key)
  })

  it('returns null for a lone 00-style name without the VID_ pattern', () => {
    expect(parseX3PairKey('CLIP_20260808_130327_00_020.insv')).toBeNull()
  })

  it('returns null when the lens-code segment is missing', () => {
    expect(parseX3PairKey('VID_20260808_130327_020.insv')).toBeNull()
  })

  it('returns null for unrelated files', () => {
    expect(parseX3PairKey('random.mp4')).toBeNull()
    expect(parseX3PairKey('VID_20260808_130327_11_020.mp4')).toBeNull()
    expect(parseX3PairKey('VID_20260808_130327_05_020.insv')).toBeNull()
  })
})
