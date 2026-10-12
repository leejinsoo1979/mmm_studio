import { describe, expect, test } from 'bun:test'
import { deflateRawSync } from 'node:zlib'
import { crc32, isZip, readZip, writeZip } from './zip'

const text = (value: string) => new TextEncoder().encode(value)

describe('zip', () => {
  test('writes and reads stored entries, skipping folders', () => {
    const zip = writeZip([
      { name: 'avatar/', bytes: new Uint8Array() },
      { name: 'avatar/model.glb', bytes: text('glTF body') },
    ])
    expect(isZip(zip)).toBe(true)
    const entries = readZip(zip, { maxEntryBytes: 1024 })!
    expect(entries.map((entry) => [entry.name, entry.size])).toEqual([['avatar/model.glb', 9]])
    expect(new TextDecoder().decode(entries[0]!.read())).toBe('glTF body')
  })

  test('reads deflated entries, checking size and CRC', () => {
    const data = text('a'.repeat(5000))
    const zip = writeZip([{ name: 'model.glb', bytes: data }])
    // Turn the stored entry into a deflated one, as most ZIP tools write it.
    const packed = deflateRawSync(data)
    const deflated = rebuild('model.glb', data, packed)
    const [entry] = readZip(deflated, { maxEntryBytes: 10_000 })!
    expect(entry!.read()).toEqual(data)
    expect(readZip(zip, { maxEntryBytes: 10_000 })).toHaveLength(1)
    const [capped] = readZip(deflated, { maxEntryBytes: 100 })!
    expect(() => capped!.read()).toThrow()
  })

  test('refuses what it does not take', () => {
    expect(readZip(text('not a zip at all, just text'), { maxEntryBytes: 100 })).toBeNull()
    const zip = writeZip([{ name: 'a', bytes: text('x') }])
    const corrupt = new Uint8Array(zip)
    corrupt[31] = 'y'.charCodeAt(0)
    expect(() => readZip(corrupt, { maxEntryBytes: 100 })![0]!.read()).toThrow('damaged')
    const many = writeZip(Array.from({ length: 5 }, (_, i) => ({ name: `${i}`, bytes: text('x') })))
    expect(readZip(many, { maxEntryBytes: 100, maxEntries: 4 })).toBeNull()
  })

  test('crc32 matches the standard check value', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926)
  })
})

/** A one-entry ZIP whose entry is deflated. */
function rebuild(name: string, data: Uint8Array, packed: Uint8Array): Uint8Array {
  const nameBytes = text(name)
  const local = new Uint8Array(30 + nameBytes.length)
  const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true)
  lv.setUint16(4, 20, true)
  lv.setUint16(8, 8, true)
  lv.setUint32(14, crc32(data), true)
  lv.setUint32(18, packed.length, true)
  lv.setUint32(22, data.length, true)
  lv.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)
  const central = new Uint8Array(46 + nameBytes.length)
  const cv = new DataView(central.buffer)
  cv.setUint32(0, 0x02014b50, true)
  cv.setUint16(10, 8, true)
  cv.setUint32(16, crc32(data), true)
  cv.setUint32(20, packed.length, true)
  cv.setUint32(24, data.length, true)
  cv.setUint16(28, nameBytes.length, true)
  central.set(nameBytes, 46)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, 1, true)
  ev.setUint16(10, 1, true)
  ev.setUint32(12, central.length, true)
  ev.setUint32(16, local.length + packed.length, true)
  const out = new Uint8Array(local.length + packed.length + central.length + end.length)
  out.set(local, 0)
  out.set(packed, local.length)
  out.set(central, local.length + packed.length)
  out.set(end, local.length + packed.length + central.length)
  return out
}
