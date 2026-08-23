// Builds Insta360-Studio-style reframing plans for ffmpeg.
//
// ffmpeg's v360/crop expression evaluators cannot receive animated
// expressions reliably through any escaping strategy (ternary ':' separators
// are unrecoverable inside filter option values), so reframing is rendered
// as a sequence of SHORT STATIC segments: keyframe intervals are sampled
// into micro-spans (~0.4s) whose virtual-camera parameters are plain
// numbers, rendered independently and concatenated. Audio is mixed in a
// later pass, so video-only segments are safe.
'use strict';

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a, b, p) {
  return a + (b - a) * p;
}

function easeValue(p, mode) {
  if (mode === 'linear') return p;
  const x = clamp(p, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Interpolate channel value at time t across sorted keyframes.
 */
function sampleChannel(kfs, t, name) {
  if (!kfs || kfs.length === 0) return null;
  const sorted = kfs;
  if (t <= sorted[0].time) return sorted[0][name];
  const last = sorted[sorted.length - 1];
  if (t >= last.time) return last[name];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time;
      const p = span > 0 ? (t - a.time) / span : 1;
      const s = easeValue(p, a.easing);
      return lerp(a[name], b[name], s);
    }
  }
  return last[name];
}

/**
 * Build the static reframe filter string for one instant.
 * pan/tilt: degrees (360) or percent offsets (flat); fov: vertical FOV
 * degrees (360) or zoom factor >=1 (flat); roll: degrees.
 */
function reframeFilterAt(opts, pan, tilt, roll, fov) {
  const { is360, width, height, lensFov } = opts;
  if (is360) {
    const lf = clamp(lensFov || 220, 120, 300);
    return (
      `v360=dfisheye:e:id_fov=${lf.toFixed(3)}` +
      `:yaw=${pan.toFixed(4)}:pitch=${tilt.toFixed(4)}:roll=${roll.toFixed(4)}` +
      `:d_fov=${clamp(fov, 20, 140).toFixed(3)}` +
      `:w=${width}:h=${height}`
    );
  }
  const zoom = clamp(fov, 1, 4);
  const cw = Math.round(width / zoom);
  const ch = Math.round(height / zoom);
  const offX = ((pan + 100) / 200) * (width - cw);
  const offY = ((tilt + 100) / 200) * (height - ch);
  let f =
    `crop=${Math.max(16, cw)}:${Math.max(16, ch)}:` +
    `${Math.round(clamp(offX, 0, width - cw))}:${Math.round(clamp(offY, 0, height - ch))}` +
    `,scale=${width}:${height}`;
  if (Math.abs(roll) > 0.01) {
    f += `,rotate=${((roll * Math.PI) / 180).toFixed(5)}:c=black`;
  }
  return f;
}

/**
 * Build the reframing render plan for one visual clip.
 *
 * opts: {
 *   is360, lensFov?, width, height,
 *   keyframes?: [{time(sec timeline-relative), pan, tilt, roll, fov, easing}],
 *   trimIn, duration(timeline sec), speed, fps,
 * }
 *
 * Returns { spans: [{ ss, dur, filter }], hasReframing:boolean }
 * `ss`/`dur` are SOURCE-file seconds covering trimIn .. trimIn+duration*speed.
 */
function buildReframePlan(opts) {
  const { width, height, keyframes, trimIn = 0, duration, speed = 1, fps = 30 } = opts;
  const spanSource = duration * speed;
  const usable = keyframes && keyframes.length > 0;

  if (!usable) {
    // no animation - single static span (or no filter at all for flat)
    const filter = opts.is360
      ? reframeFilterAt({ ...opts, keyframes: null }, 0, 0, 0, 90)
      : '';
    return { spans: [{ ss: trimIn, dur: spanSource, filter }], hasReframing: !!opts.is360 };
  }

  const kfs = [...keyframes].sort((a, b) => a.time - b.time);

  // breakpoints in timeline time: keyframe times clipped to [0, duration]
  const marks = new Set([0, duration]);
  for (const k of kfs) {
    if (k.time > 0 && k.time < duration) marks.add(k.time);
  }
  const bounds = [...marks].sort((a, b) => a - b);

  // refine long intervals into short static steps for smoother motion
  const MAX_STEP = 0.4;
  const times = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const len = b - a;
    const steps = Math.max(1, Math.ceil(len / MAX_STEP));
    for (let s = 0; s < steps; s++) times.push(a + ((b - a) * s) / steps);
  }
  times.push(duration);

  const spans = [];
  for (let i = 0; i < times.length - 1; i++) {
    const tlStart = times[i];
    const tlEnd = times[i + 1];
    // sample the virtual camera at the middle of the step
    const mid = (tlStart + tlEnd) / 2;
    const pan = sampleChannel(kfs, mid, 'pan') ?? 0;
    const tilt = sampleChannel(kfs, mid, 'tilt') ?? 0;
    const roll = sampleChannel(kfs, mid, 'roll') ?? 0;
    const fov = sampleChannel(kfs, mid, 'fov') ?? (opts.is360 ? 90 : 1);
    const filter = reframeFilterAt(opts, pan, tilt, roll, fov);
    spans.push({
      ss: trimIn + tlStart * speed,
      dur: (tlEnd - tlStart) * speed,
      filter,
    });
  }
  void fps;
  return { spans, hasReframing: true };
}

module.exports = { buildReframePlan, reframeFilterAt, sampleChannel };
