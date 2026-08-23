/**
 * Insta360 X3 dual-file stitching (calibrated for the X3):
 *
 * The X3 records one 2880x2880 circular fisheye PER LENS into two separate
 * .insv files (`..._00_...insv` = lens A/front, `..._10_...insv` = lens B/back).
 * The fisheye circle fills the whole frame (verified empirically - no black
 * margins), so the full frame maps to the lens field of view.
 *
 * Stitching = project each fisheye onto half of an equirectangular frame and
 * hstack them. With id_fov >= 190 the two hemispheres overlap slightly, which
 * hides the seam. Default lens FOV of 220 deg matches community calibrations
 * for the X3; it is adjustable for fine-tuning.
 *
 * Yaw convention: lens A -> -90 (left hemisphere), lens B -> +90 (right).
 * If a particular recording is swapped, pass swapped yaws.
 */
'use strict';

function buildStitchGraph(opts) {
  const {
    width = 3840,
    height = 1920,
    fps = 30,
    lensFov = 220,
    yawA = -90,
    yawB = 90,
    sampleSeconds = null,
  } = opts;

  const halfW = Math.round(width / 2);
  const fov = Math.min(300, Math.max(120, Number(lensFov) || 220));

  const chain = (inputIdx, yaw) =>
    `[${inputIdx}:v]fps=${fps},setpts=PTS-STARTPTS,` +
    `v360=fisheye:e:id_fov=${fov}:yaw=${yaw}:roll=0:w=${halfW}:h=${height},setsar=1[half${inputIdx}]`;

  const filterComplex =
    `${chain(0, yawA)};` +
    `${chain(1, yawB)};` +
    `[half0][half1]hstack=inputs=2,format=yuv420p[out]`;

  const args = ['-filter_complex', filterComplex, '-map', '[out]', '-map', '0:a:0?'];
  if (sampleSeconds) args.push('-t', String(sampleSeconds));
  return { args };
}

/** Pair-matching for Insta360 dual-file naming: ..._00_... <-> ..._10_... */
function findInsvPairName(fileName, siblings) {
  const m = /^(.*?)(00|10)([^0-9].*)?\.insv$/i.exec(fileName);
  if (!m) return null;
  const other = m[2] === '00' ? '10' : '00';
  const wanted = `${m[1]}${other}${m[3] || ''}.insv`;
  return siblings.find((s) => s.toLowerCase() === wanted.toLowerCase()) ?? null;
}

module.exports = { buildStitchGraph, findInsvPairName };
