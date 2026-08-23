/**
 * 360° source detection shared by import, conversion and export paths.
 *
 * Two genuinely different 360° source kinds exist:
 *  - 'dfisheye'  raw dual-fisheye frames (Insta360 X3 .insv recordings)
 *  - 'equirect'  already-stitched 2:1 equirectangular video (Insta360 Studio,
 *                GoPro Max, Ricoh Theta exports, our own X3 stitcher…)
 *
 * Raw .insv files are always dual-fisheye. Any other file whose dimensions
 * sit in the classic 2:1 band (~1.9–2.15) is treated as pre-stitched
 * equirectangular. Everything else is not a 360° source.
 */
export type Projection = 'dfisheye' | 'equirect'

export interface Detect360Result {
  is360: boolean
  /** undefined when the file is not a 360° source */
  projection?: Projection
}

export function detect360Projection(
  fileName: string,
  width?: number,
  height?: number
): Detect360Result {
  if (/\.insv$/i.test(fileName)) {
    return { is360: true, projection: 'dfisheye' }
  }
  if (width && height && width > 0 && height > 0) {
    const ratio = width / height
    if (ratio > 1.9 && ratio < 2.15) {
      return { is360: true, projection: 'equirect' }
    }
  }
  return { is360: false, projection: undefined }
}
