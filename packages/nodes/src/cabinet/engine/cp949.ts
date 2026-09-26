/**
 * CP949 (windows-949) encoder for MPR files — legacy CNC software reads the
 * Korean comments and file names in this code page. The table is the inverse
 * of the WHATWG `euc-kr` decoder (which is windows-949), built once on first
 * use instead of shipping a 17k-entry literal. It is byte-identical to
 * mmmcraft's generated `cp949Encoder` table.
 */
let table: Map<number, number> | null = null

function cp949Table(): Map<number, number> {
  if (table) return table
  const decoder = new TextDecoder('euc-kr', { fatal: true })
  const map = new Map<number, number>()
  const pair = new Uint8Array(2)
  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x41; trail <= 0xfe; trail += 1) {
      pair[0] = lead
      pair[1] = trail
      let text: string
      try {
        text = decoder.decode(pair)
      } catch {
        continue
      }
      const codePoint = text.codePointAt(0)
      if (text.length !== 1 || codePoint === undefined || codePoint <= 0x7f) continue
      if (!map.has(codePoint)) map.set(codePoint, (lead << 8) | trail)
    }
  }
  table = map
  return map
}

/** Unmapped characters become '?' (0x3f), as in mmmcraft. */
export function encodeCp949(input: string): Uint8Array {
  const map = cp949Table()
  const bytes: number[] = []
  for (const char of input) {
    const codePoint = char.codePointAt(0)
    if (codePoint === undefined) continue
    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
      continue
    }
    const mapped = map.get(codePoint)
    if (mapped === undefined) bytes.push(0x3f)
    else bytes.push((mapped >> 8) & 0xff, mapped & 0xff)
  }
  return new Uint8Array(bytes)
}
