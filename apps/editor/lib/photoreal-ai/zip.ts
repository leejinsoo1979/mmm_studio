import { inflateRawSync } from 'node:zlib'

/**
 * Just enough ZIP for the avatar service's exports (a ZIP holding
 * `avatar/model.glb`): reading stored and deflated entries from the central
 * directory with a size cap on each, and writing stored entries (for the
 * 목업 and tests). No ZIP64, no encryption, no spanning: such an archive is
 * refused.
 */

export type ZipEntry = {
  name: string
  /** Uncompressed size, as the directory states it. */
  size: number
  /** The entry's bytes; throws when it is damaged, unsupported or over the cap. */
  read: () => Uint8Array<ArrayBuffer>
}

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const END = 0x06054b50
const STORED = 0
const DEFLATED = 8

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** CRC-32 (ZIP, PNG). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export const isZip = (bytes: Uint8Array) =>
  bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4

/** The archive's file entries, or null when it isn't a ZIP this reader takes. */
export function readZip(
  bytes: Uint8Array,
  options: { maxEntryBytes: number; maxEntries?: number },
): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)
  let end = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(at) === END) {
      end = at
      break
    }
  }
  if (end < 0) return null
  const count = u16(end + 10)
  const directory = u32(end + 16)
  if (u16(end + 4) !== 0 || count === 0xffff || directory === 0xffffffff) return null
  if (count > (options.maxEntries ?? 256)) return null

  const entries: ZipEntry[] = []
  let at = directory
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== CENTRAL) return null
    const flags = u16(at + 8)
    const method = u16(at + 10)
    const crc = u32(at + 16)
    const packed = u32(at + 20)
    const size = u32(at + 24)
    const nameLength = u16(at + 28)
    const extra = u16(at + 30)
    const comment = u16(at + 32)
    const offset = u32(at + 42)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extra + comment
    if ([packed, size, offset].includes(0xffffffff)) return null
    if (name.endsWith('/')) continue
    const read = () => {
      if (flags & 1) throw new Error('encrypted')
      if (size > options.maxEntryBytes) throw new Error('too_large')
      if (offset + 30 > bytes.length || u32(offset) !== LOCAL) throw new Error('damaged')
      const start = offset + 30 + u16(offset + 26) + u16(offset + 28)
      if (start + packed > bytes.length) throw new Error('damaged')
      const data = bytes.subarray(start, start + packed)
      let out: Uint8Array<ArrayBuffer>
      if (method === STORED) out = new Uint8Array(data)
      else if (method === DEFLATED) {
        out = new Uint8Array(inflateRawSync(data, { maxOutputLength: options.maxEntryBytes }))
      } else throw new Error('unsupported')
      if (out.length !== size || crc32(out) !== crc) throw new Error('damaged')
      return out
    }
    entries.push({ name, size, read })
  }
  return entries
}

/** Stored (uncompressed) entries as a ZIP. */
export function writeZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.bytes)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, LOCAL, true)
    lv.setUint16(4, 20, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, file.bytes.length, true)
    lv.setUint32(22, file.bytes.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, CENTRAL, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, file.bytes.length, true)
    cv.setUint32(24, file.bytes.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local, file.bytes)
    centrals.push(central)
    offset += local.length + file.bytes.length
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, END, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, directorySize, true)
  ev.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
