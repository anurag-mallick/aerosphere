/**
 * Tiny synthesized-UI-sound manager (Web Audio API, zero assets).
 *
 * Sounds are short synthesized envelopes so the app ships no audio files and
 * has no licensing concerns. The AudioContext is created lazily on first play
 * (browsers require a user gesture before audio — every call site here is a
 * click/completion handler, so that's satisfied).
 *
 * Toggle is persisted; the header bell button flips it.
 */

const STORE_KEY = 'aero.uiSounds'

type SoundName = 'success' | 'error' | 'info' | 'exportDone' | 'tick' | 'warn'

let ctx: AudioContext | null = null
let enabled = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) !== 'off' : true

const listeners = new Set<() => void>()

export function isSoundEnabled() {
  return enabled
}

export function setSoundEnabled(on: boolean) {
  enabled = on
  try {
    localStorage.setItem(STORE_KEY, on ? 'on' : 'off')
  } catch {
    // private mode etc — in-memory only
  }
  listeners.forEach((l) => l())
}

export function subscribeSoundEnabled(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

function ensureCtx(): AudioContext | null {
  if (!enabled) return null
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** one oscillator blip with gain envelope */
function blip(
  c: AudioContext,
  opts: {
    freq: number
    t0: number
    dur: number
    type?: OscillatorType
    gain?: number
    slideTo?: number
  }
) {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(opts.freq, c.currentTime + opts.t0)
  if (opts.slideTo) {
    osc.frequency.exponentialRampToValueAtTime(opts.slideTo, c.currentTime + opts.t0 + opts.dur)
  }
  const peak = opts.gain ?? 0.08
  g.gain.setValueAtTime(0.0001, c.currentTime + opts.t0)
  g.gain.exponentialRampToValueAtTime(peak, c.currentTime + opts.t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + opts.t0 + opts.dur)
  osc.connect(g).connect(c.destination)
  osc.start(c.currentTime + opts.t0)
  osc.stop(c.currentTime + opts.t0 + opts.dur + 0.05)
}

export function playSound(name: SoundName) {
  const c = ensureCtx()
  if (!c) return
  switch (name) {
    case 'success':
      // two-note rising chime
      blip(c, { freq: 659.25, t0: 0, dur: 0.12 }) // E5
      blip(c, { freq: 880, t0: 0.09, dur: 0.16 }) // A5
      break
    case 'error':
      // low double-buzz
      blip(c, { freq: 196, t0: 0, dur: 0.11, type: 'square', gain: 0.05 })
      blip(c, { freq: 155.56, t0: 0.13, dur: 0.16, type: 'square', gain: 0.05 }) // Eb3
      break
    case 'warn':
      blip(c, { freq: 523.25, t0: 0, dur: 0.1, type: 'triangle' }) // C5
      blip(c, { freq: 493.88, t0: 0.11, dur: 0.14, type: 'triangle' }) // B4
      break
    case 'info':
      // soft pop
      blip(c, { freq: 740, t0: 0, dur: 0.07, gain: 0.05, slideTo: 988 })
      break
    case 'exportDone':
      // rising arpeggio A4-C#5-E5-A5
      blip(c, { freq: 440, t0: 0, dur: 0.11 })
      blip(c, { freq: 554.37, t0: 0.1, dur: 0.11 })
      blip(c, { freq: 659.25, t0: 0.2, dur: 0.11 })
      blip(c, { freq: 880, t0: 0.3, dur: 0.22 })
      break
    case 'tick':
      blip(c, { freq: 1200, t0: 0, dur: 0.035, gain: 0.045, type: 'triangle' })
      break
  }
}

/** fire-and-forget helpers used across the app */
export const sounds = {
  success: () => playSound('success'),
  error: () => playSound('error'),
  warn: () => playSound('warn'),
  info: () => playSound('info'),
  exportDone: () => playSound('exportDone'),
  tick: () => playSound('tick'),
}
