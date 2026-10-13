/**
 * Colour differences for the bench's skin, hair and iris gates: sRGB bytes
 * to CIELAB (D65) and the CIEDE2000 difference between two colours.
 */

export type Rgb = [number, number, number]
export type Lab = [number, number, number]

const linear = (byte: number) => {
  const c = byte / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function rgbToLab([r, g, b]: Rgb): Lab {
  const R = linear(r)
  const G = linear(g)
  const B = linear(b)
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIEDE2000 (Sharma, Wu and Dalal's formulation; kL = kC = kH = 1). */
export function deltaE2000(a: Lab, b: Lab): number {
  const [L1, a1, b1] = a
  const [L2, a2, b2] = b
  const rad = Math.PI / 180
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cm = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h = (bb: number, ap: number) => {
    if (bb === 0 && ap === 0) return 0
    const angle = Math.atan2(bb, ap) / rad
    return angle >= 0 ? angle : angle + 360
  }
  const h1p = h(b1, a1p)
  const h2p = h(b2, a2p)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad)
  const Lpm = (L1 + L2) / 2
  const Cpm = (C1p + C2p) / 2
  let hpm = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2
    else hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  }
  const T =
    1 -
    0.17 * Math.cos((hpm - 30) * rad) +
    0.24 * Math.cos(2 * hpm * rad) +
    0.32 * Math.cos((3 * hpm + 6) * rad) -
    0.2 * Math.cos((4 * hpm - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2)
  const Sc = 1 + 0.045 * Cpm
  const Sh = 1 + 0.015 * Cpm * T
  const Rt = -Math.sin(2 * dTheta * rad) * Rc
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  )
}

export const deltaERgb = (a: Rgb, b: Rgb) => deltaE2000(rgbToLab(a), rgbToLab(b))

/** The per-channel median of the RGBA pixels `use` picks (by pixel index), or null when none. */
export function medianRgb(data: ArrayLike<number>, use: (pixel: number) => boolean): Rgb | null {
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  let count = 0
  for (let i = 0; i < data.length / 4; i++) {
    if (!use(i)) continue
    for (let k = 0; k < 3; k++) histograms[k]![data[i * 4 + k]!]! += 1
    count++
  }
  if (!count) return null
  return histograms.map((h) => {
    let seen = 0
    for (let v = 0; v < 256; v++) {
      seen += h[v]!
      if (seen * 2 >= count) return v
    }
    return 255
  }) as Rgb
}

export const luminance = ([r, g, b]: Rgb) =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
