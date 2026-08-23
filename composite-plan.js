/**
 * Multi-track composite planning for export — mirrors the preview's
 * "later track wins" layering and real gaps (empty = black).
 *
 * Input: video tracks in TOP-TO-BOTTOM stacking order (same array the
 * renderer passes to usePlaybackEngine.findVisualAt). Output: ordered
 * render pieces:
 *
 *   { type:'clip',  clip, tlStart, tlEnd, srcTrim }   srcTrim in source secs
 *   { type:'blend', prevClip, clip, startTl, len }    cross-dissolve zone
 *   { type:'black', startTl, len }                    nothing active
 */
'use strict';

const MIN_PIECE = 0.05;
const COALESCE_EPS = 1e-6;

function clampNum(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function buildCompositePlan(videoTracks) {
  const maxEnd = Math.max(
    MIN_PIECE,
    ...videoTracks.flatMap((t) => t.clips.map((c) => c.position + c.duration))
  );

  // ── sweep: constant-topmost-clip ranges ("later track wins") ──────────
  const points = new Set([0, maxEnd]);
  for (const t of videoTracks) {
    for (const c of t.clips) {
      points.add(clampNum(c.position, 0, maxEnd));
      points.add(clampNum(c.position + c.duration, 0, maxEnd));
    }
  }
  const bounds = [...points].sort((a, b) => a - b);

  const topmostAt = (time) => {
    for (let i = videoTracks.length - 1; i >= 0; i--) {
      const clip = videoTracks[i].clips.find(
        (c) => time >= c.position - 1e-6 && time < c.position + c.duration - 1e-6
      );
      if (clip) return clip;
    }
    return null;
  };

  const segments = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end - start < 1e-9) continue;
    const clip = topmostAt(start + 1e-9);
    const last = segments[segments.length - 1];
    if (last && last.clip === clip) last.end = end;
    else segments.push({ clip, start, end });
  }

  // ── dissolve pass: shrink A tail / B head, record boundary ────────────
  const blendAfter = new Map(); // segment index -> {len, prevClip}
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1];
    const b = segments[i];
    if (!a.clip || !b.clip || a.clip === b.clip) continue;
    const want = clampNum(Number(b.clip.dissolveIn) || 0, 0, 2);
    if (want < 0.05) continue;
    const len = Math.min(want, (a.end - a.start) * 0.4, (b.end - b.start) * 0.4);
    if (len < 0.05) continue;
    a.end -= len;
    b.start += len;
    blendAfter.set(i, { len, prevClip: a.clip });
  }

  // ── emit ordered pieces ────────────────────────────────────────────────
  const pieces = [];
  let cursor = 0;
  const pushBlack = (start, end) => {
    const len = end - start;
    if (len > MIN_PIECE / 2) pieces.push({ type: 'black', startTl: start, len });
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.start > cursor + COALESCE_EPS) {
      pushBlack(cursor, seg.start);
      cursor = seg.start;
    }

    const blendInfo = blendAfter.get(i);
    if (blendInfo) {
      pieces.push({
        type: 'blend',
        prevClip: blendInfo.prevClip,
        clip: seg.clip,
        startTl: cursor,
        len: blendInfo.len,
      });
      cursor += blendInfo.len;
    }

    if (!seg.clip) {
      pushBlack(cursor, seg.end);
      cursor = seg.end;
      continue;
    }

    const speed = seg.clip.speed || 1;
    pieces.push({
      type: 'clip',
      clip: seg.clip,
      tlStart: cursor,
      tlEnd: seg.end,
      srcTrim: Math.max(
        0,
        seg.clip.trimIn +
          (Math.max(0, seg.start - seg.clip.position) + (blendInfo ? blendInfo.len : 0)) * speed
      ),
    });
    cursor = seg.end;
  }
  if (maxEnd - cursor > MIN_PIECE / 2) pushBlack(cursor, maxEnd);

  return pieces;
}

module.exports = { buildCompositePlan };
