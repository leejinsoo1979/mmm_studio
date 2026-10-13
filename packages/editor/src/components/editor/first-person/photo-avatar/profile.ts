import { applySimilarity, similarity, type Vec3 } from './linalg'

/**
 * Measuring a fitted head's profile against the true head's, in
 * millimetres: what tells a face that is the person's shape from a mask
 * that only matches from the front (whose nose is flat from the side).
 *
 * Both heads are put in the true head's frame (+y up, the face towards +z)
 * by the similarity that best carries the fit's eye and mouth corners onto
 * the truth's — points a front photo already places well, so a profile
 * that is wrong stays wrong. The profile is the outline seen from the
 * side: at each height, the frontmost point of the head.
 */

/** Landmarks the two heads are aligned by: the eyes' and the mouth's corners. */
export const ALIGN_LANDMARKS = [33, 133, 362, 263, 61, 291] as const

export type HeadSurface = {
  /** xyz per vertex. */
  positions: ArrayLike<number>
  triangles: ArrayLike<number>
  /** MediaPipe landmarks on the surface (at least the alignment ones and the profile's). */
  landmarks: Map<number, Vec3>
}

/** The frontmost z of the surface at each height from `bottom` up by `step` (NaN where it has none). */
export function profileCurve(
  positions: ArrayLike<number>,
  triangles: ArrayLike<number>,
  bottom: number,
  step: number,
  rows: number,
  transform?: (p: Vec3) => Vec3,
): Float64Array {
  const count = positions.length / 3
  const xs = new Float64Array(count * 3)
  for (let i = 0; i < count; i++) {
    const p: Vec3 = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!]
    const q = transform ? transform(p) : p
    xs[i * 3] = q[0]
    xs[i * 3 + 1] = q[1]
    xs[i * 3 + 2] = q[2]
  }
  const front = new Float64Array(rows).fill(Number.NaN)
  for (let t = 0; t < triangles.length; t += 3) {
    const corner = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!]
    const ys = corner.map((v) => xs[v * 3 + 1]!)
    const lo = Math.max(0, Math.ceil((Math.min(...ys) - bottom) / step))
    const hi = Math.min(rows - 1, Math.floor((Math.max(...ys) - bottom) / step))
    for (let row = lo; row <= hi; row++) {
      const y = bottom + row * step
      // Where the triangle's edges cross this height: the frontmost of those points.
      for (let k = 0; k < 3; k++) {
        const a = corner[k]!
        const b = corner[(k + 1) % 3]!
        const ya = xs[a * 3 + 1]!
        const yb = xs[b * 3 + 1]!
        if ((ya - y) * (yb - y) > 0 || ya === yb) continue
        const s = (y - ya) / (yb - ya)
        const z = xs[a * 3 + 2]! + s * (xs[b * 3 + 2]! - xs[a * 3 + 2]!)
        if (!(z <= front[row]!)) front[row] = z
      }
    }
  }
  return front
}

export type ProfileError = {
  /** At the forehead (MediaPipe 151's height), mm: fit minus truth (+ is too far forward). */
  forehead: number
  /** At the nose bridge's deepest point (the nasion), mm. */
  bridge: number
  /** At the nose's tip, mm. */
  noseTip: number
  /** How far the nose stands out from the bridge, fit minus truth (mm): its projection. */
  noseProjection: number
  /** At the chin's frontmost point, mm. */
  chin: number
  /**
   * Over the whole profile from the brows to the chin's bottom, each point's distance to the
   * nearest of the fit's (mm): mean and largest.
   */
  lineMean: number
  lineMax: number
  /** The same errors with the fit moved in depth by its median offset: the profile's shape alone. */
  shape: { forehead: number; bridge: number; noseTip: number; chin: number }
}

const STEP = 0.0005

/**
 * The fit's profile against the truth's (see above); `truth` and `fit`
 * carry MediaPipe landmarks on their surfaces, the truth's also those that
 * mark the profile's heights (10, 9, 151, 168, 6, 2, 17, 152).
 */
export function profileError(fit: HeadSurface, truth: HeadSurface): ProfileError {
  const from: Vec3[] = []
  const to: Vec3[] = []
  for (const l of ALIGN_LANDMARKS) {
    const a = fit.landmarks.get(l)
    const b = truth.landmarks.get(l)
    if (a && b) {
      from.push(a)
      to.push(b)
    }
  }
  const align = similarity(from, to)
  const at = (l: number) => truth.landmarks.get(l)![1]
  const bottom = at(152) - 0.01
  const top = at(10) + 0.01
  const rows = Math.ceil((top - bottom) / STEP)
  const truthCurve = profileCurve(truth.positions, truth.triangles, bottom, STEP, rows)
  const fitCurve = profileCurve(fit.positions, fit.triangles, bottom, STEP, rows, (p) =>
    applySimilarity(align, p),
  )
  const rowOf = (y: number) => Math.round((y - bottom) / STEP)
  const diff = (row: number) => (fitCurve[row]! - truthCurve[row]!) * 1000
  /** The row of the truth's frontmost (or deepest) point between two heights. */
  const extreme = (y0: number, y1: number, deepest: boolean) => {
    let best = -1
    for (let row = rowOf(Math.min(y0, y1)); row <= rowOf(Math.max(y0, y1)); row++) {
      const z = truthCurve[row]!
      if (Number.isNaN(z)) continue
      if (best < 0 || (deepest ? z < truthCurve[best]! : z > truthCurve[best]!)) best = row
    }
    return Math.max(best, 0)
  }
  const bridgeRow = extreme(at(9), at(6), true)
  const tipRow = extreme(at(6), at(2), false)
  const chinRow = extreme(at(17), at(152), false)
  // The whole line: each point of the truth's profile from the brows to the chin's bottom, to the
  // nearest point of the fit's (so the flat runs under the nose and chin count fairly).
  let sum = 0
  let max = 0
  let counted = 0
  const reach = Math.round(0.015 / STEP)
  for (let row = rowOf(at(152) + 0.002); row <= rowOf(at(9)); row++) {
    const z = truthCurve[row]!
    if (Number.isNaN(z)) continue
    let nearest = Number.POSITIVE_INFINITY
    for (let other = Math.max(0, row - reach); other <= Math.min(rows - 1, row + reach); other++) {
      const w = fitCurve[other]!
      if (Number.isNaN(w)) continue
      nearest = Math.min(nearest, Math.hypot((other - row) * STEP, w - z))
    }
    if (!Number.isFinite(nearest)) continue
    sum += nearest * 1000
    max = Math.max(max, nearest * 1000)
    counted++
  }
  // The fit's profile moved in depth by its median offset from the truth's: its shape alone,
  // without where the eye corners put it.
  const offsets: number[] = []
  for (let row = rowOf(at(152) + 0.002); row <= rowOf(at(9)); row++) {
    const d = diff(row)
    if (!Number.isNaN(d)) offsets.push(d)
  }
  offsets.sort((a, b) => a - b)
  const shift = offsets.length ? offsets[Math.floor(offsets.length / 2)]! : 0
  return {
    forehead: diff(rowOf(at(151))),
    bridge: diff(bridgeRow),
    noseTip: diff(tipRow),
    noseProjection: diff(tipRow) - diff(bridgeRow),
    chin: diff(chinRow),
    lineMean: counted ? sum / counted : Number.NaN,
    lineMax: max,
    shape: {
      forehead: diff(rowOf(at(151))) - shift,
      bridge: diff(bridgeRow) - shift,
      noseTip: diff(tipRow) - shift,
      chin: diff(chinRow) - shift,
    },
  }
}
