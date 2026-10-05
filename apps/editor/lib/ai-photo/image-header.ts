/**
 * An image's real type and size from its first bytes (the declared type is
 * never trusted): JPEG SOFn, WebP VP8 / VP8L / VP8X, PNG IHDR. Pure, no
 * decoder, safe on both sides.
 */

export type AiPhotoImageType = 'image/jpeg' | 'image/webp' | 'image/png'

export type ImageHeader = { type: AiPhotoImageType; width: number; height: number }

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)
const u24le = (b: Uint8Array, i: number) => u16le(b, i) | ((b[i + 2] ?? 0) << 16)
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 0x10000 + u16be(b, i + 2)
const ascii = (b: Uint8Array, i: number, text: string) =>
  b.length >= i + text.length && [...text].every((c, k) => b[i + k] === c.charCodeAt(0))

function jpegHeader(b: Uint8Array): ImageHeader | null {
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1] ?? 0
    // Fill bytes before a marker.
    if (marker === 0xff) {
      i++
      continue
    }
    // Markers without a length: TEM, RSTn, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2
      continue
    }
    // EOI or start of scan before any frame header.
    if (marker === 0xd9 || marker === 0xda) return null
    const length = u16be(b, i + 2)
    if (length < 2) return null
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) {
      if (i + 9 > b.length) return null
      return { type: 'image/jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7) }
    }
    i += 2 + length
  }
  return null
}

function webpHeader(b: Uint8Array): ImageHeader | null {
  if (b.length < 30) return null
  if (ascii(b, 12, 'VP8 ')) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { type: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null
    // 14 bits of width - 1, then 14 bits of height - 1.
    const bits = (u16le(b, 21) | (u16le(b, 23) << 16)) >>> 0
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (ascii(b, 12, 'VP8X')) {
    return { type: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  }
  return null
}

/** The image's type and size, or null for anything that isn't a JPEG, WebP or PNG. */
export function sniffImage(bytes: Uint8Array): ImageHeader | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpegHeader(bytes)
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return webpHeader(bytes)
  if (ascii(bytes, 0, '\u0089PNG\r\n\u001a\n') && bytes.length >= 24 && ascii(bytes, 12, 'IHDR')) {
    return { type: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20) }
  }
  return null
}
