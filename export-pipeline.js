// Pure-Node export pipeline (no Electron imports).
//
// Architecture:
//   1. every visual clip is rendered into short video-only segments
//      (keyframed reframing is sampled into ~0.4s static-camera spans)
//   2. all segments are concatenated losslessly
//   3. one final pass mixes clip audio + music onto the merged video
//
// Implemented with direct ffmpeg process spawning (fluent-ffmpeg 2.x rejects
// lavfi inputs on newer ffmpeg releases).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { buildReframePlan } = require('./keyframe-filter');
const { resolveBinary, probeFile, extractMetadata } = require('./src-shared/ffmpeg-utils');

let activeProcess = null;
let cancelled = false;

function runFfmpeg(args, opts) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      resolveBinary('ffmpeg'),
      ['-hide_banner', '-nostdin', '-y', '-loglevel', 'info', '-stats', ...args],
      { stdio: ['ignore', 'ignore', 'pipe'], cwd: (opts && opts.cwd) || undefined }
    );
    activeProcess = proc;

    let errTail = '';
    let lastReported = -5;

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      errTail = (errTail + text).slice(-4000);
      if (!opts || !opts.duration || !opts.onProgress) return;
      const re = /time=(\d+):(\d{2}):(\d{2}\.\d+)/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        const pct = clampPct((seconds / opts.duration) * 100);
        if (pct - lastReported >= 2) {
          lastReported = pct;
          opts.onProgress(pct);
        }
      }
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (activeProcess === proc) activeProcess = null;
      if (code === 0) return resolve();
      const lines = errTail.trim().split('\n');
      const reason = lines[lines.length - 1] || `ffmpeg exited with code ${code}`;
      reject(new Error(reason.replace(/^Error /, '')));
    });
  });
}

function clampPct(v) {
  return Math.max(0, Math.min(100, v));
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function requestCancel() {
  cancelled = true;
  if (activeProcess) {
    try {
      activeProcess.kill('SIGKILL');
    } catch {
      // already finished
    }
  }
}

function videoCodecArgs(codec) {
  if (codec === 'h265' || codec === 'hevc') {
    return ['-c:v', 'libx265', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'];
  }
  if (codec === 'prores') {
    // editing master — 10-bit 4:2:2, PCM audio in MOV
    return ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le'];
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
}

/** extension + audio codec for a requested output format */
function outputSpec(format) {
  switch (format) {
    case 'webm':
      return { ext: 'webm', videoCodec: 'vp9', audioArgs: ['-c:a', 'libopus', '-b:a', '160k'] };
    case 'mov':
      return { ext: 'mov', videoCodec: 'h264', audioArgs: ['-c:a', 'aac', '-b:a', '192k'] };
    case 'prores':
      return { ext: 'mov', videoCodec: 'prores', audioArgs: ['-c:a', 'pcm_s16le'] };
    case 'mp4-hevc':
      return { ext: 'mp4', videoCodec: 'h265', audioArgs: ['-c:a', 'aac', '-b:a', '192k'] };
    default:
      return { ext: 'mp4', videoCodec: 'h264', audioArgs: ['-c:a', 'aac', '-b:a', '192k'] };
  }
}

/**
 * Pure arg-builder for the final container conversion.
 * Returns null when the internal mp4 can be used as-is (plain copy).
 */
function buildFinalizeArgs(spec, input, output) {
  if (spec.ext === 'mp4') {
    // internal pipeline is already mp4/h264 or mp4/hevc with aac — just copy
    return { args: ['-i', input, '-c', 'copy', output], reencode: false };
  }
  const videoArgs =
    spec.videoCodec === 'vp9'
      ? ['-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p']
      : spec.videoCodec === 'prores'
        ? ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
  return {
    args: ['-i', input, ...videoArgs, ...spec.audioArgs, '-movflags', '+faststart', output],
    reencode: true,
  };
}

/** atempo accepts 0.5..2.0 per instance - chain for extreme speeds */
function tempoChain(speed) {
  if (!speed || Math.abs(speed - 1) < 1e-6) return [];
  const factors = [];
  let s = speed;
  while (s > 2 + 1e-9) {
    factors.push(2);
    s /= 2;
  }
  while (s < 0.5 - 1e-9) {
    factors.push(0.5);
    s /= 0.5;
  }
  factors.push(s);
  return factors.map((f) => `atempo=${f.toFixed(6)}`);
}

function colorEqArgs(colorAdjust) {
  if (!colorAdjust) return [];
  const parts = [];
  if (colorAdjust.brightness) parts.push(`brightness=${clamp(colorAdjust.brightness, -1, 1).toFixed(3)}`);
  if (colorAdjust.contrast) parts.push(`contrast=${(1 + clamp(colorAdjust.contrast, -0.99, 2)).toFixed(3)}`);
  if (colorAdjust.saturation) parts.push(`saturation=${(1 + clamp(colorAdjust.saturation, -0.99, 2)).toFixed(3)}`);
  if (colorAdjust.gamma) parts.push(`gamma=${(1 + clamp(colorAdjust.gamma, -0.99, 2)).toFixed(3)}`);
  const out = parts.length ? [`eq=${parts.join(':')}`] : [];
  if (colorAdjust.temperature) {
    const temp = 6500 + clamp(colorAdjust.temperature, -1, 1) * 2500;
    out.push(`colortemperature=temperature=${temp.toFixed(0)}:pl=1`);
  }
  if (colorAdjust.tint) {
    // green <-> magenta balance
    out.push(`colorbalance=gm=${clamp(colorAdjust.tint, -1, 1).toFixed(3)}`);
  }
  return out;
}

function logNormalizeArgs(enabled) {
  if (!enabled) return [];
  // approximate D-Log / D-Log M -> Rec.709 normalization
  return [`curves=all='0/0.02 0.125/0.14 0.25/0.30 0.5/0.55 0.75/0.80 1/1'`];
}

function lutArgs(lutFile) {
  // `lutFile` must already be a colon-free RELATIVE name (see copyLutToWorkDir)
  if (!lutFile) return [];
  return [`lut3d=file=${lutFile}`];
}

/**
 * Copy a user-supplied .cube LUT into the export workDir under a generated
 * colon-free name. Windows drive letters (C:\…) would otherwise break
 * ffmpeg's filtergraph parser. Returns the bare filename or null.
 */
function copyLutToWorkDir(lutPath, clipIndex, workDir) {
  if (!lutPath) return null;
  const dest = path.join(workDir, `lut-${clipIndex}.cube`);
  try {
    fs.copyFileSync(lutPath, dest);
    return path.basename(dest);
  } catch {
    return null;
  }
}

/** video fade in/out, timed relative to the START of the given span */
function videoFadeArgs({ fadeIn, fadeOut }, segStartTl, segDurTl, clipDurTl) {
  const out = [];
  const fi = clamp(fadeIn || 0, 0, clipDurTl);
  const fo = clamp(fadeOut || 0, 0, clipDurTl);
  if (fi > 0 && segStartTl <= 1e-6) {
    out.push(`fade=t=in:st=0:d=${Math.min(fi, segDurTl).toFixed(3)}`);
  }
  if (fo > 0 && segStartTl + segDurTl >= clipDurTl - 1e-6) {
    const st = Math.max(0, segDurTl - Math.min(fo, segDurTl));
    out.push(`fade=t=out:st=${st.toFixed(3)}:d=${Math.min(fo, segDurTl).toFixed(3)}`);
  }
  return out;
}

/** drawtext text escaping: backslash, colon, apostrophe, percent */
function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\\\:')
    .replace(/'/g, '’')
    .replace(/%/g, '%%');
}

function resolveFont() {
  const candidates = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    'C:/Windows/Fonts/arial.ttf',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** quarter-turn helpers: transpose filters + swapped intermediate dimensions */
function transposeArgs(rot90) {
  const q = (((rot90 | 0) % 360) + 360) % 360;
  if (q === 90) return ['transpose=1'];
  if (q === 180) return ['transpose=1', 'transpose=1'];
  if (q === 270) return ['transpose=2'];
  return [];
}

function rotatedDims(rot90, width, height) {
  const q = (((rot90 | 0) % 360) + 360) % 360;
  return q % 180 === 90 ? { w: height, h: width } : { w: width, h: height };
}

/** burned-in title overlay filter for one clip */
function titleArgs(title) {  if (!title || !title.text || !String(title.text).trim()) return [];
  const font = resolveFont();
  const fontPart = font ? `:fontfile='${font}'` : '';
  const y = title.position === 'top' ? '24' : 'h-th-24';
  return [
    `drawtext=text='${escapeDrawtext(title.text)}':fontsize=${clamp(
      Math.round(title.size || 42),
      12,
      300
    )}:fontcolor=white:borderw=3:bordercolor=black@0.65:x='(w-text_w)/2':y=${y}${fontPart}`,
  ];
}

// ---------------------------------------------------------------------------
// SRT telemetry handling
// ---------------------------------------------------------------------------

function parseSrt(text) {
  const entries = [];
  const ts =
    /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const m = ts.exec(block);
    if (!m) continue;
    const start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const end = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000;
    const lines = block.split('\n');
    const idx = lines.findIndex((l) => ts.test(l));
    entries.push({
      start,
      end,
      text: lines.slice(idx + 1).join('\n').trim(),
    });
  }
  return entries;
}

function fmtSrtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mn = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const mm = String(ms % 1000).padStart(3, '0');
  return `${h}:${mn}:${ss},${mm}`;
}

function serializeSrt(entries) {
  return (
    entries
      .map(
        (e, i) => `${i + 1}\n${fmtSrtTime(e.start)} --> ${fmtSrtTime(e.end)}\n${e.text}`
      )
      .join('\n\n') + '\n'
  );
}

/**
 * Build a timeline-aligned .srt from all clips that opted into burn-in.
 * Entries are clipped to [trimIn, trimIn+spanSource], shifted by -trimIn,
 * scaled by 1/speed (matching setpts compression), offset by clip.position.
 */
function buildTimelineSubtitles(visualClips, workDir) {
  let all = [];
  visualClips.forEach((clip, ci) => {
    if (!clip.burnSubtitles || !clip.subtitlesPath) return;
    if (!fs.existsSync(clip.subtitlesPath)) return;
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    const spanSource = clip.duration * speed;
    let text = '';
    try {
      text = fs.readFileSync(clip.subtitlesPath, 'utf8');
    } catch {
      return;
    }
    for (const e of parseSrt(text)) {
      // keep entries inside the trimmed region (with 1s slack for rounding)
      const relStart = e.start - clip.trimIn;
      const relEnd = e.end - clip.trimIn;
      if (relEnd <= -1 || relStart >= spanSource + 1) continue;
      const tlStart = Math.max(0, relStart / speed) + clip.position;
      const tlEnd = Math.min(relEnd / speed, clip.duration) + clip.position;
      if (tlEnd - tlStart < 0.05) continue;
      all.push({ start: tlStart, end: tlEnd, text: e.text });
    }
    void ci;
  });
  if (all.length === 0) return null;
  all.sort((a, b) => a.start - b.start);
  const outPath = path.join(workDir, 'telemetry.srt');
  fs.writeFileSync(outPath, serializeSrt(all));
  return path.basename(outPath); // used with cwd=workDir (colon-free)
}

function checkCancelled() {
  if (cancelled) throw Object.assign(new Error('Export cancelled'), { cancelled: true });
}

// ---------------------------------------------------------------------------
// export orchestration
// ---------------------------------------------------------------------------

/**
 * options: { outputPath, width, height, fps, codec, visualClips[], musicClips[], onProgress(percent, stage) }
 */
async function runExport(options) {
  const { outputPath, width, height, fps } = options;
  const outSpec = outputSpec(options.format);
  const visualClips = Array.isArray(options.visualClips) ? options.visualClips : [];
  const musicClips = (Array.isArray(options.musicClips) ? options.musicClips : []).filter((m) => m && m.path);
  const onProgress = options.onProgress || (() => {});

  if (visualClips.length === 0) {
    return { ok: false, cancelled: false, error: 'Timeline has no clips to export.' };
  }

  cancelled = false;
  const workDir = path.join(os.tmpdir(), `video-editor-export-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  const SEGMENT_WEIGHT = 78;
  const CONCAT_WEIGHT = 12;
  const AUDIO_WEIGHT = 10;
  const report = (percent, stage) => onProgress(clampPct(percent), stage);

  try {
    // ------------------------------------------------------- render segments
    const segPaths = [];
    const totalSpansEstimate = visualClips.reduce((n, c) => {
      if (c.kind === 'photo') return n + 1;
      const planSpans = buildReframePlan({
        is360: !!c.is360,
        lensFov: c.lensFov,
        width,
        height,
        keyframes: c.keyframes,
        trimIn: c.trimIn,
        duration: c.duration,
        speed: c.speed || 1,
        fps,
      }).spans.length;
      return n + planSpans;
    }, 0);

    let doneSpans = 0;
    const audioSources = []; // {path, trimIn, spanSource, speed, delaySec}

    for (let ci = 0; ci < visualClips.length; ci++) {
      checkCancelled();
      const clip = visualClips[ci];
      const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
      const stage = `Rendering clip ${ci + 1} of ${visualClips.length}`;
      report((doneSpans / totalSpansEstimate) * SEGMENT_WEIGHT, stage);

      const colorFilters = colorEqArgs(clip.colorAdjust);
      const safeLut = copyLutToWorkDir(clip.lutPath, ci, workDir);
      const rot = clip.rotate90 | 0;
      const dims = rotatedDims(rot, width, height);
      let stabTransform = null;

      if (clip.kind === 'photo') {
        const segPath = path.join(workDir, `seg-${segPaths.length}.mp4`);
        const vf = [
          ...logNormalizeArgs(clip.logNormalize),
          ...lutArgs(safeLut),
          ...colorFilters,
          ...videoFadeArgs(clip, 0, clip.duration, clip.duration),
          ...titleArgs(clip.title),
          `scale=${dims.w}:${dims.h}`,
          ...transposeArgs(rot),
          `fps=${fps}`,
          'setsar=1',
        ].join(',');
        await runFfmpeg([
          '-loop', '1',
          '-framerate', String(fps),
          '-i', clip.path,
          '-an',
          '-vf', vf,
          '-t', String(clip.duration),
          ...videoCodecArgs('h264'),
          segPath,
        ], { duration: clip.duration, onProgress: undefined });
        doneSpans += 1;
        segPaths.push(segPath);
        continue;
      }

      const plan = buildReframePlan({
        is360: !!clip.is360,
        lensFov: clip.lensFov,
        width: dims.w,
        height: dims.h,
        keyframes: clip.keyframes,
        trimIn: clip.trimIn,
        duration: clip.duration,
        speed,
        fps,
      });

      // stabilization pass 1 (flat videos only)
      if (clip.stabilize && !clip.is360) {
        checkCancelled();
        report((doneSpans / totalSpansEstimate) * SEGMENT_WEIGHT, `${stage} - analyzing motion`);
        const trfPath = path.join(workDir, `stab-${ci}.trf`);
        await runFfmpeg([
          '-ss', String(Math.max(0, clip.trimIn)),
          '-t', String(clip.duration * speed),
          '-i', clip.path,
          '-an',
          '-vf', `vidstabdetect=shakiness=8:accuracy=15:result=${trfPath}`,
          '-f', 'null',
          '-',
        ]);
        stabTransform = `vidstabtransform=input=${trfPath}:smoothing=30`;
      }

      let probeHasAudio = null; // lazy
      const trimSafe = Math.max(0, clip.trimIn);
      for (let si = 0; si < plan.spans.length; si++) {
        checkCancelled();
        const span = plan.spans[si];
        const segPath = path.join(workDir, `seg-${segPaths.length}.mp4`);
        // timeline-relative position of this span (for fade placement)
        const segStartTl = (span.ss - trimSafe) / speed;
        const segDurTl = span.dur / speed;
        const vfParts = [
          ...(stabTransform ? [stabTransform] : []),
          ...logNormalizeArgs(clip.logNormalize),
          ...lutArgs(safeLut),
          ...(span.filter ? [span.filter] : []),
          ...colorFilters,
          ...videoFadeArgs(clip, segStartTl, segDurTl, clip.duration),
          ...titleArgs(clip.title),
          ...transposeArgs(rot),
          // compress wall-clock time for speed ramps (paren-free form)
          ...(Math.abs(speed - 1) > 1e-6
            ? [`setpts=PTS/${speed.toFixed(6)}-STARTPTS/${speed.toFixed(6)}`]
            : []),
          `fps=${fps}`,
          'setsar=1',
        ];
        await runFfmpeg([
          '-ss', String(Math.max(0, span.ss)),
          '-t', String(span.dur),
          '-i', clip.path,
          '-an',
          '-vf', vfParts.join(','),
          ...videoCodecArgs('h264'),
          segPath,
        ]);
        doneSpans += 1;
        segPaths.push(segPath);
        if (si % 3 === 0 || si === plan.spans.length - 1) {
          report((doneSpans / totalSpansEstimate) * SEGMENT_WEIGHT, stage);
        }
      }

      if (probeHasAudio === null) {
        try {
          probeHasAudio = extractMetadata(await probeFile(clip.path)).hasAudio;
        } catch {
          probeHasAudio = false;
        }
      }
      if (probeHasAudio && !clip.muted) {
        audioSources.push({
          path: clip.path,
          trimIn: trimSafe,
          spanSource: clip.duration * speed,
          speed,
          delaySec: Math.max(0, clip.position),
          durationTl: clip.duration,
          volume: clip.volume != null ? clamp(clip.volume, 0, 4) : 1,
          fadeIn: clip.fadeIn || 0,
          fadeOut: clip.fadeOut || 0,
        });
      }
    }

    // ------------------------------------------------------------------ concat
    checkCancelled();
    report(SEGMENT_WEIGHT, 'Concatenating timeline');
    const mergedPath = path.join(workDir, 'merged.mp4');
    const listPath = path.join(workDir, 'concat.txt');
    fs.writeFileSync(listPath, segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));

    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', mergedPath]);

    // -------------------------------------------------------------- audio mix
    let finalPath = mergedPath;
    const subtitleFile = buildTimelineSubtitles(visualClips, workDir);
    const needMix =
      audioSources.length > 0 || musicClips.length > 0 || !!subtitleFile;

    if (needMix && !cancelled) {
      report(SEGMENT_WEIGHT + CONCAT_WEIGHT, 'Mixing audio track');
      const args = ['-i', mergedPath];
      const filters = [];
      const sources = [];
      let inputIdx = 1;

      let firstVoiceInput = null; // input index of the first dialogue-bearing clip

      audioSources.forEach((src) => {
        args.push('-ss', String(src.trimIn), '-t', String(src.spanSource), '-i', src.path);
        const label = `v${inputIdx}`;
        const tempo = tempoChain(src.speed).join(',');
        const chainParts = [
          'aresample=44100',
          'aformat=channel_layouts=stereo',
          // Voice Isolation-style cleanup (Fairlight/FCP inspired)
          src.denoise ? 'afftdn=nr=12:nf=-25' : '',
          // broadcast loudness normalization
          src.normalize ? 'loudnorm=I=-16:TP=-1.5:LRA=11' : '',
          Math.abs(src.volume - 1) > 1e-6 ? `volume=${src.volume.toFixed(4)}` : '',
          tempo,
        ];
        if (src.fadeIn > 0) {
          chainParts.push(`afade=t=in:st=0:d=${Math.min(src.fadeIn, src.durationTl).toFixed(3)}`);
        }
        if (src.fadeOut > 0) {
          const st = Math.max(0, src.durationTl - src.fadeOut);
          chainParts.push(`afade=t=out:st=${st.toFixed(3)}:d=${Math.min(src.fadeOut, src.durationTl).toFixed(3)}`);
        }
        chainParts.push(`adelay=${Math.round(src.delaySec * 1000)}|${Math.round(src.delaySec * 1000)}`);
        filters.push(`[${inputIdx}:a]${chainParts.filter(Boolean).join(',')}[${label}]`);
        sources.push(`[${label}]`);
        if (firstVoiceInput === null) firstVoiceInput = inputIdx;
        inputIdx += 1;
      });
      musicClips.forEach((m, j) => {
        args.push('-ss', String(Math.max(0, m.trimIn)), '-t', String(m.duration), '-i', m.path);
        const delayMs = Math.round(Math.max(0, m.position) * 1000);
        const musicChain = [
          'aresample=44100',
          'aformat=channel_layouts=stereo',
          m.denoise ? 'afftdn=nr=12:nf=-25' : '',
          m.normalize ? 'loudnorm=I=-16:TP=-1.5:LRA=11' : '',
          `adelay=${delayMs}|${delayMs}`,
        ].filter(Boolean);
        filters.push(`[${inputIdx}:a]${musicChain.join(',')}[m${j}raw]`);

        if (m.duck && firstVoiceInput !== null) {
          // Resolve/Fairlight-style ducker: music dips under dialogue via sidechain
          filters.push(
            `[m${j}raw][${firstVoiceInput}:a]sidechaincompress=` +
              'threshold=0.02:ratio=6:attack=60:release=600[m' + j + ']'
          );
        } else {
          filters.push(`[m${j}raw]anull[m${j}]`);
        }
        sources.push(`[m${j}]`);
        inputIdx += 1;
      });

      if (sources.length === 0 && !subtitleFile) {
        throw new Error('Audio mixing requested but no usable audio streams were found.');
      }

      // full-length silent base keeps the mix anchored to the timeline length
      const totalDur = visualClips.reduce(
        (mx, c) => Math.max(mx, c.position + c.duration),
        0
      );
      const graphParts = [
        `anullsrc=r=44100:cl=stereo,atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS[base]`,
        ...filters,
      ];
      if (sources.length > 0) {
        graphParts.push(
          `[base]${sources.join('')}amix=inputs=${sources.length + 1}:duration=first:normalize=0[aout]`
        );
      } else {
        // subtitles-only burn-in: silence as the audio track
        graphParts.push('[base]anull[aout]');
      }

      finalPath = path.join(workDir, 'final.mp4');
      args.push(
        '-filter_complex', graphParts.join(';'),
        '-map', '0:v',
        '-map', '[aout]',
      );
      if (subtitleFile) {
        // burn-in requires a re-encode; run from workDir so the path stays colon-free
        args.push(
          '-vf',
          `subtitles=${subtitleFile}:force_style='FontSize=15,PrimaryColour=&H00FFFFFF&,OutlineColour=&H66000000&,BorderStyle=1,Shadow=0,MarginV=14'`,
          ...videoCodecArgs('h264'),
        );
      } else {
        args.push('-c:v', 'copy');
      }
      args.push(
        '-c:a', 'aac',
        '-b:a', '192k',
        finalPath
      );

      await runFfmpeg(args, { duration: undefined, onProgress: undefined, cwd: workDir });
    }

    // ---------------------------------------------------- final container
    checkCancelled();
    if (outSpec.ext === 'mp4') {
      fs.copyFileSync(finalPath, outputPath);
    } else {
      onProgress(99, `Writing ${String(outSpec.ext).toUpperCase()} file`);
      const fin = buildFinalizeArgs(outSpec, finalPath, outputPath);
      await runFfmpeg(fin.args);
    }
    onProgress(100, 'Done');
    return { ok: true, cancelled: false, outputPath };
  } catch (err) {
    if ((err && err.cancelled) || cancelled) {
      return { ok: false, cancelled: true, error: 'Export cancelled' };
    }
    return { ok: false, cancelled: false, error: (err && err.message) || 'Unknown export error' };
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}

module.exports = {
  runExport,
  requestCancel,
  probeFile,
  extractMetadata,
  // pure helpers (exposed for tests)
  tempoChain,
  colorEqArgs,
  videoFadeArgs,
  lutArgs,
  copyLutToWorkDir,
  parseSrt,
  serializeSrt,
  buildTimelineSubtitles,
  clamp,
  outputSpec,
  buildFinalizeArgs,
};
