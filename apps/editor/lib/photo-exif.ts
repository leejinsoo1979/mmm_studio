/**
 * An uploaded photo's lens from its EXIF block, where the camera wrote one
 * (phones do; screenshots, webcam frames and AI pictures don't): the focal
 * length in 35 mm film terms. No photo can tell how long a lens was from
 * the face alone (a near face through a wide lens and a far one through a
 * long lens differ only in how the nose and ears stand out), and a lens
 * guessed too wide makes the fitted face too wide and too flat.
 *
 * Believed only for the picture the camera wrote: a crop keeps the EXIF of
 * the whole frame but not its field of view, so where EXIF records the
 * frame's size and the picture is not that size (either way round), the
 * lens is left to the fit.
 */

/** The 35 mm frame's diagonal (mm), against which an equivalent focal length is given. */
const FULL_FRAME_DIAGONAL = Math.hypot(36, 24)

/** EXIF lives in the first APP1 segment, at most 64 KB, at the very start of a JPEG. */
const HEAD_BYTES = 128 * 1024

const EXIF_IFD = 0x8769
const FOCAL_35 = 0xa405
const PIXEL_X = 0xa002
const PIXEL_Y = 0xa003

export type ExifLens = {
  /** FocalLengthIn35mmFilm (mm). */
  focal35: number
  /** The frame's size as EXIF records it (PixelXDimension × PixelYDimension), or null. */
  frame: [number, number] | null
}

/** EXIF's lens in a JPEG's bytes, or null where it has none. */
export function exifLens(bytes: Uint8Array): ExifLens | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!
    // Start of scan: the markers are over.
    if (marker === 0xda) return null
    if (marker === 0xe1 && isExif(bytes, at + 4)) return readTiff(bytes, at + 10, length - 8)
    at += 2 + length
  }
  return null
}

const isExif = (bytes: Uint8Array, at: number) =>
  bytes[at] === 0x45 && bytes[at + 1] === 0x78 && bytes[at + 2] === 0x69 && bytes[at + 3] === 0x66

function readTiff(bytes: Uint8Array, start: number, size: number): ExifLens | null {
  const end = Math.min(bytes.length, start + size)
  const little = bytes[start] === 0x49
  const u16 = (at: number) =>
    at + 2 > end
      ? Number.NaN
      : little
        ? bytes[at]! | (bytes[at + 1]! << 8)
        : (bytes[at]! << 8) | bytes[at + 1]!
  const u32 = (at: number) =>
    at + 4 > end
      ? Number.NaN
      : little
        ? (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16)) + bytes[at + 3]! * 2 ** 24
        : bytes[at]! * 2 ** 24 + ((bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!)
  /** A tag's value in an IFD at `offset` (from the TIFF header): its first SHORT or LONG. */
  const find = (offset: number, tag: number): number | null => {
    const count = u16(start + offset)
    if (!Number.isFinite(count)) return null
    for (let k = 0; k < count; k++) {
      const entry = start + offset + 2 + k * 12
      if (u16(entry) !== tag) continue
      const type = u16(entry + 2)
      const value = type === 3 ? u16(entry + 8) : type === 4 ? u32(entry + 8) : Number.NaN
      return Number.isFinite(value) ? value : null
    }
    return null
  }
  const first = u32(start + 4)
  if (!Number.isFinite(first)) return null
  const exif = find(first, EXIF_IFD)
  if (exif === null) return null
  const focal35 = find(exif, FOCAL_35)
  if (!focal35 || focal35 <= 0) return null
  const x = find(exif, PIXEL_X)
  const y = find(exif, PIXEL_Y)
  return { focal35, frame: x && y ? [x, y] : null }
}

/**
 * The 35 mm-equivalent focal length (mm) of a `width` × `height` picture
 * from its EXIF, or null where it has none or the picture is not the frame
 * the camera wrote.
 */
export function lensOf(lens: ExifLens | null, width: number, height: number): number | null {
  if (!lens) return null
  if (lens.frame) {
    const [x, y] = lens.frame
    const same = (x === width && y === height) || (x === height && y === width)
    if (!same) return null
  }
  return lens.focal35
}

/** A 35 mm-equivalent focal length as pixels on a `width` × `height` picture (by its diagonal). */
export const focalPixels = (focal35: number, width: number, height: number) =>
  (focal35 / FULL_FRAME_DIAGONAL) * Math.hypot(width, height)

/** A picture file's EXIF lens (its first bytes read), or null. */
export async function readExifLens(file: Blob): Promise<ExifLens | null> {
  try {
    return exifLens(new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer()))
  } catch {
    return null
  }
}
