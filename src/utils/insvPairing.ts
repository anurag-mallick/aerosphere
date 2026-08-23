/**
 * Insta360 X3 dual-file pairing.
 *
 * The X3 always records 360° footage as a MATCHED PAIR of files with an
 * identical prefix, date, time and sequence number, differing only in the
 * lens-code segment:
 *
 *   VID_YYYYMMDD_HHMMSS_00_NNN.insv   ← back lens
 *   VID_YYYYMMDD_HHMMSS_10_NNN.insv   ← front lens
 *
 * Both files are required together to reconstruct one 360° video — a single
 * file alone is just one fisheye circle, not usable 360° footage.
 */

export interface X3PairKey {
  /** shared identifier: the filename with the lens-code segment removed */
  key: string
  lens: '00' | '10'
}

const X3_PAIR_RE = /^(VID_\d{8}_\d{6})_(00|10)((?:_\d+)?)\.insv$/i

export function parseX3PairKey(filename: string): X3PairKey | null {
  const m = X3_PAIR_RE.exec(filename)
  if (!m) return null
  const lens = m[2] as '00' | '10'
  return { key: `${m[1]}_${m[3]}.insv`, lens }
}
