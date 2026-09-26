/**
 * Minimal ZIP writer (stored, no compression) for bundling per-panel MPR
 * files. File names are written as raw bytes without the UTF-8 flag, so the
 * caller decides their encoding (CP949 for Korean CNC software, as mmmcraft
 * does via JSZip's `encodeFileName`).
 */
/** 1980-01-01, the earliest DOS date (0 is not a valid date). */
const DOS_DATE = (1 << 5) | 1

let crcTable: Uint32Array | null = null

function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export type ZipEntry = { name: Uint8Array; data: Uint8Array }

export function zipStored(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const crc = crc32(entry.data)
    const local = new Uint8Array(30 + entry.name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(12, DOS_DATE, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, entry.data.length, true)
    lv.setUint32(22, entry.data.length, true)
    lv.setUint16(26, entry.name.length, true)
    local.set(entry.name, 30)
    chunks.push(local, entry.data)

    const dir = new Uint8Array(46 + entry.name.length)
    const dv = new DataView(dir.buffer)
    dv.setUint32(0, 0x02014b50, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(6, 20, true)
    dv.setUint16(14, DOS_DATE, true)
    dv.setUint32(16, crc, true)
    dv.setUint32(20, entry.data.length, true)
    dv.setUint32(24, entry.data.length, true)
    dv.setUint16(28, entry.name.length, true)
    dv.setUint32(42, offset, true)
    dir.set(entry.name, 46)
    central.push(dir)
    offset += local.length + entry.data.length
  }
  const dirSize = central.reduce((sum, c) => sum + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, dirSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + dirSize + end.length)
  let at = 0
  for (const chunk of [...chunks, ...central, end]) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
