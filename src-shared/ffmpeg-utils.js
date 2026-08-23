// Shared FFmpeg helpers used by both the Electron main process and the
// export pipeline. CommonJS on purpose — main.js is not ESM.
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

function resolveBinary(name) {
  const candidates = [
    process.env[`${name.toUpperCase()}_PATH`],
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return name; // fall back to PATH lookup
}

function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveBinary('ffprobe'), [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`ffprobe failed for ${filePath}`));
      }
    });
  });
}

/**
 * Extract normalized media metadata from raw ffprobe JSON.
 * Throws a user-facing Error when the probe result is malformed.
 */
function extractMetadata(data) {
  if (!data || !Array.isArray(data.streams)) {
    throw new Error('Could not read video file — it may be corrupt or unsupported');
  }
  const videoStream =
    data.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic === 1)) ||
    data.streams.find((s) => s.codec_type === 'video');
  const audioStream = data.streams.find((s) => s.codec_type === 'audio');
  let fps = null;
  if (videoStream && videoStream.r_frame_rate && videoStream.r_frame_rate.includes('/')) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (num > 0 && den > 0) fps = Math.round((num / den) * 100) / 100;
  }
  return {
    duration: Number(data.format && data.format.duration) || 0,
    width: (videoStream && videoStream.width) || 0,
    height: (videoStream && videoStream.height) || 0,
    codec: (videoStream && videoStream.codec_name) || null,
    fps,
    hasAudio: !!audioStream,
  };
}

module.exports = { resolveBinary, probeFile, extractMetadata };
