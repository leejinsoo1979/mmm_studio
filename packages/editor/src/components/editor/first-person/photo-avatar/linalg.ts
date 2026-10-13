/**
 * The little dense linear algebra the photo fit needs: 3-vectors and 3×3
 * rotations, symmetric positive definite solves (Cholesky), a box-bounded
 * quadratic minimiser, and the best similarity between two point sets.
 * Matrices are row-major `Float64Array`s.
 */

export type Vec3 = [number, number, number]
/** A 3×3 matrix, row-major. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const norm3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2])

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!
    }
  }
  return out
}

export const transpose3 = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]

export const apply3 = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]

/** The rotation by `w` (axis × angle, radians): Rodrigues' formula. */
export function rotation(w: Vec3): Mat3 {
  const angle = norm3(w)
  if (angle < 1e-12) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1]
  const [x, y, z] = [w[0] / angle, w[1] / angle, w[2] / angle]
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ]
}

/** The axis × angle (radians) of a rotation: the inverse of `rotation`. */
export function rotationLog(m: Mat3): Vec3 {
  const cos = Math.min(1, Math.max(-1, (m[0] + m[4] + m[8] - 1) / 2))
  const angle = Math.acos(cos)
  const v: Vec3 = [m[7] - m[5], m[2] - m[6], m[3] - m[1]]
  if (angle < 1e-6) return [v[0] / 2, v[1] / 2, v[2] / 2]
  if (Math.PI - angle < 1e-4) {
    // Near a half turn the antisymmetric part vanishes: the axis from the diagonal.
    const axis: Vec3 = [
      Math.sqrt(Math.max(0, (m[0] + 1) / 2)),
      Math.sqrt(Math.max(0, (m[4] + 1) / 2)),
      Math.sqrt(Math.max(0, (m[8] + 1) / 2)),
    ]
    if (m[1] + m[3] < 0) axis[1] = -axis[1]
    if (m[2] + m[6] < 0) axis[2] = -axis[2]
    return [axis[0] * angle, axis[1] * angle, axis[2] * angle]
  }
  const s = angle / (2 * Math.sin(angle))
  return [v[0] * s, v[1] * s, v[2] * s]
}

/** Rotation about the y axis (radians). */
export const rotationY = (angle: number): Mat3 => rotation([0, angle, 0])
export const rotationX = (angle: number): Mat3 => rotation([angle, 0, 0])
export const rotationZ = (angle: number): Mat3 => rotation([0, 0, angle])

/**
 * Solves `A x = b` in place for a symmetric positive definite `A` (n×n,
 * row-major; overwritten by its Cholesky factor). False when `A` is not
 * positive definite.
 */
export function choleskySolve(a: Float64Array, b: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let sum = a[j * n + j]!
    for (let k = 0; k < j; k++) sum -= a[j * n + k]! * a[j * n + k]!
    if (!(sum > 0)) return false
    const diagonal = Math.sqrt(sum)
    a[j * n + j] = diagonal
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j]!
      for (let k = 0; k < j; k++) s -= a[i * n + k]! * a[j * n + k]!
      a[i * n + j] = s / diagonal
    }
  }
  for (let i = 0; i < n; i++) {
    let s = b[i]!
    for (let k = 0; k < i; k++) s -= a[i * n + k]! * b[k]!
    b[i] = s / a[i * n + i]!
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!
    for (let k = i + 1; k < n; k++) s -= a[k * n + i]! * b[k]!
    b[i] = s / a[i * n + i]!
  }
  return true
}

/**
 * Minimises `½ xᵀ H x − gᵀ x` over `lower ≤ x ≤ upper` (H symmetric positive
 * definite, n×n row-major) by cyclic coordinate descent from `x` (updated in
 * place): exact for each coordinate, and quick for the few hundred unknowns
 * of a face fit, whose H is dominated by its diagonal prior.
 */
export function boxQuadratic(
  h: Float64Array,
  g: Float64Array,
  x: Float64Array,
  lower: Float64Array,
  upper: Float64Array,
  n: number,
  sweeps = 60,
  tolerance = 1e-10,
): void {
  // The gradient of the quadratic at x, kept up to date: H x − g.
  const grad = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = -g[i]!
    for (let k = 0; k < n; k++) s += h[i * n + k]! * x[k]!
    grad[i] = s
  }
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let moved = 0
    for (let i = 0; i < n; i++) {
      const hii = h[i * n + i]!
      if (!(hii > 0)) continue
      const old = x[i]!
      const next = Math.min(upper[i]!, Math.max(lower[i]!, old - grad[i]! / hii))
      const step = next - old
      if (step === 0) continue
      x[i] = next
      moved = Math.max(moved, Math.abs(step) * Math.sqrt(hii))
      for (let k = 0; k < n; k++) grad[k] = grad[k]! + h[k * n + i]! * step
    }
    if (moved < tolerance) break
  }
}

/** The eigen-decomposition of a symmetric 3×3 matrix (Jacobi): eigenvalues, and eigenvectors as columns. */
export function symmetricEigen3(m: Mat3): { values: Vec3; vectors: Mat3 } {
  const a = [...m] as Mat3
  const v: Mat3 = [...IDENTITY3]
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5])
    if (off < 1e-15) break
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const apq = a[p * 3 + q]!
      if (Math.abs(apq) < 1e-18) continue
      const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq)
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1)
      const s = t * c
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p]!
        const akq = a[k * 3 + q]!
        a[k * 3 + p] = c * akp - s * akq
        a[k * 3 + q] = s * akp + c * akq
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k]!
        const aqk = a[q * 3 + k]!
        a[p * 3 + k] = c * apk - s * aqk
        a[q * 3 + k] = s * apk + c * aqk
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p]!
        const vkq = v[k * 3 + q]!
        v[k * 3 + p] = c * vkp - s * vkq
        v[k * 3 + q] = s * vkp + c * vkq
      }
    }
  }
  return { values: [a[0], a[4], a[8]], vectors: v }
}

/**
 * The rotation nearest to `m` (its polar factor, determinant +1), through
 * the eigen-decomposition of mᵀm.
 */
export function nearestRotation(m: Mat3): Mat3 {
  const { values, vectors } = symmetricEigen3(mulMat3(transpose3(m), m))
  // (mᵀm)^(−½) = V diag(1/√λ) Vᵀ; R = m (mᵀm)^(−½), with the smallest axis flipped if needed.
  const inv = values.map((value) => 1 / Math.sqrt(Math.max(value, 1e-30))) as Vec3
  const root = new Array(9).fill(0) as Mat3
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0
      for (let k = 0; k < 3; k++) s += vectors[r * 3 + k]! * inv[k]! * vectors[c * 3 + k]!
      root[r * 3 + c] = s
    }
  }
  let out = mulMat3(m, root)
  if (determinant3(out) < 0) {
    // Flip the direction m stretches least.
    let smallest = 0
    for (let k = 1; k < 3; k++) if (values[k]! < values[smallest]!) smallest = k
    const flip = new Array(9).fill(0) as Mat3
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        flip[r * 3 + c] =
          (r === c ? 1 : 0) - 2 * vectors[r * 3 + smallest]! * vectors[c * 3 + smallest]!
      }
    }
    out = mulMat3(out, flip)
  }
  return out
}

export const determinant3 = (m: Mat3) =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[1] * (m[3] * m[8] - m[5] * m[6]) +
  m[2] * (m[3] * m[7] - m[4] * m[6])

export type Similarity = { scale: number; rotation: Mat3; translation: Vec3 }

/**
 * The similarity (scale, rotation, translation) carrying `from` onto `to`
 * best in least squares (Umeyama), each point weighted by `weights`;
 * `withScale` false keeps the scale at 1.
 */
export function similarity(
  from: readonly Vec3[],
  to: readonly Vec3[],
  weights?: readonly number[],
  withScale = true,
): Similarity {
  let total = 0
  const ca: Vec3 = [0, 0, 0]
  const cb: Vec3 = [0, 0, 0]
  for (let i = 0; i < from.length; i++) {
    const w = weights?.[i] ?? 1
    total += w
    for (let k = 0; k < 3; k++) {
      ca[k] = ca[k]! + w * from[i]![k]!
      cb[k] = cb[k]! + w * to[i]![k]!
    }
  }
  for (let k = 0; k < 3; k++) {
    ca[k] = ca[k]! / total
    cb[k] = cb[k]! / total
  }
  const cov = new Array(9).fill(0) as Mat3
  let spread = 0
  for (let i = 0; i < from.length; i++) {
    const w = weights?.[i] ?? 1
    const a = [from[i]![0] - ca[0], from[i]![1] - ca[1], from[i]![2] - ca[2]]
    const b = [to[i]![0] - cb[0], to[i]![1] - cb[1], to[i]![2] - cb[2]]
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) cov[r * 3 + c] = cov[r * 3 + c]! + w * b[r]! * a[c]!
    spread += w * (a[0]! * a[0]! + a[1]! * a[1]! + a[2]! * a[2]!)
  }
  const r = nearestRotation(cov)
  let scale = 1
  if (withScale) {
    // trace(Rᵀ cov) / spread.
    let trace = 0
    for (let k = 0; k < 9; k++) trace += r[k]! * cov[k]!
    scale = trace / Math.max(spread, 1e-30)
  }
  const rc = apply3(r, ca)
  return {
    scale,
    rotation: r,
    translation: [cb[0] - scale * rc[0], cb[1] - scale * rc[1], cb[2] - scale * rc[2]],
  }
}

export const applySimilarity = (
  { scale, rotation: r, translation: t }: Similarity,
  p: Vec3,
): Vec3 => {
  const q = apply3(r, p)
  return [scale * q[0] + t[0], scale * q[1] + t[1], scale * q[2] + t[2]]
}
