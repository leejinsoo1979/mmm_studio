import { describe, expect, test } from 'bun:test'
import { exifLens, focalPixels, lensOf, readExifLens } from './photo-exif'

/** A JPEG's first bytes with an EXIF block: FocalLengthIn35mmFilm `mm` and, if given, the frame's size. */
function jpegWithLens(mm: number, little: boolean, frame?: [number, number]): Uint8Array {
  const tiff: number[] = []
  const u16 = (v: number) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255])
  const u32 = (v: number) =>
    little
      ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24]
      : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8))
  // IFD0 at 8: one entry pointing at the Exif IFD (at 26).
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0))
  const entries: number[][] = [[...u16(0xa405), ...u16(3), ...u32(1), ...u16(mm), 0, 0]]
  if (frame) {
    entries.push([...u16(0xa002), ...u16(4), ...u32(1), ...u32(frame[0])])
    entries.push([...u16(0xa003), ...u16(3), ...u32(1), ...u16(frame[1]), 0, 0])
  }
  tiff.push(...u16(entries.length), ...entries.flat(), ...u32(0))
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const length = app1.length + 2
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    length >> 8,
    length & 255,
    ...app1,
    0xff,
    0xda,
    0,
    2,
  ])
}

describe('the lens from an uploaded photo', () => {
  test('reads FocalLengthIn35mmFilm in either byte order', () => {
    expect(exifLens(jpegWithLens(26, true))).toEqual({ focal35: 26, frame: null })
    expect(exifLens(jpegWithLens(52, false))).toEqual({ focal35: 52, frame: null })
  })

  test('reads the frame size the camera wrote, SHORT or LONG', () => {
    expect(exifLens(jpegWithLens(26, true, [4032, 3024]))).toEqual({
      focal35: 26,
      frame: [4032, 3024],
    })
    expect(exifLens(jpegWithLens(28, false, [4000, 3000]))?.frame).toEqual([4000, 3000])
  })

  test('believes it only for the frame the camera wrote, turned either way', () => {
    const lens = exifLens(jpegWithLens(26, true, [4032, 3024]))
    expect(lensOf(lens, 4032, 3024)).toBe(26)
    expect(lensOf(lens, 3024, 4032)).toBe(26)
    // A crop keeps the whole frame's EXIF but not its field of view.
    expect(lensOf(lens, 2000, 2400)).toBeNull()
    // No size recorded: nothing to doubt it by.
    expect(lensOf(exifLens(jpegWithLens(26, true)), 640, 480)).toBe(26)
    expect(lensOf(null, 640, 480)).toBeNull()
  })

  test('turns it into pixels by the picture diagonal', () => {
    expect(focalPixels(26, 4032, 3024)).toBeCloseTo((26 / Math.hypot(36, 24)) * 5040, 6)
  })

  test('gives nothing for a picture without one', async () => {
    expect(exifLens(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull()
    expect(exifLens(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(exifLens(new Uint8Array(0))).toBeNull()
    expect(await readExifLens(new Blob([Uint8Array.from([1, 2, 3])]))).toBeNull()
    expect(await readExifLens(new Blob([jpegWithLens(24, true)]))).toEqual({
      focal35: 24,
      frame: null,
    })
  })
})
