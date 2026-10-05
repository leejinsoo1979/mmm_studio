import {
  type Bone,
  type BufferGeometry,
  type Material,
  Matrix3,
  Matrix4,
  type Mesh,
  type Object3D,
  type Skeleton,
  type SkinnedMesh,
  Vector3,
} from 'three'
import type { PointMove, Shaper } from './avatar-shape'
import { originalGeometry } from './head-geometry'

/**
 * The player's build: how tall they stand and the body sliders (the Sims'
 * and inZOI's body sculpting), each −1–1 with 0 leaving that part as the
 * character has it.
 */

export const BODY_SLIDER_GROUPS = ['build', 'torso', 'limbs'] as const
export type BodySliderGroup = (typeof BODY_SLIDER_GROUPS)[number]

export const BODY_SLIDERS = [
  { id: 'weight', group: 'build' },
  { id: 'muscle', group: 'build' },
  { id: 'headSize', group: 'build' },
  { id: 'torsoLength', group: 'torso' },
  { id: 'shoulders', group: 'torso' },
  { id: 'chest', group: 'torso' },
  { id: 'waist', group: 'torso' },
  { id: 'belly', group: 'torso' },
  { id: 'hips', group: 'torso' },
  { id: 'neck', group: 'limbs' },
  { id: 'arms', group: 'limbs' },
  { id: 'legLength', group: 'limbs' },
  { id: 'legs', group: 'limbs' },
] as const satisfies readonly { id: string; group: BodySliderGroup }[]

export type BodySliderId = (typeof BODY_SLIDERS)[number]['id']

/** `height` (−1–1) scales the whole body; the sliders reshape it part by part. */
export type BodyShape = {
  height: number
  sliders: Partial<Record<BodySliderId, number>>
}

export const DEFAULT_BODY_SHAPE: BodyShape = { height: 0, sliders: {} }

const SLIDER_IDS = new Set<string>(BODY_SLIDERS.map((slider) => slider.id))
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const setting = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, -1, 1) : 0

/** A build as saved or received (anything unknown dropped, values kept in range). */
export function readBodyShape(value: unknown): BodyShape {
  const body = value as Partial<BodyShape> | null
  if (!body || typeof body !== 'object') return DEFAULT_BODY_SHAPE
  const sliders: BodyShape['sliders'] = {}
  if (body.sliders && typeof body.sliders === 'object') {
    for (const [id, value] of Object.entries(body.sliders)) {
      const kept = setting(value)
      if (SLIDER_IDS.has(id) && kept !== 0) sliders[id as BodySliderId] = kept
    }
  }
  return { height: setting(body.height), sliders }
}

export const hasBodyShape = (body: BodyShape | null | undefined) =>
  Boolean(body && (body.height !== 0 || Object.values(body.sliders).some((value) => value !== 0)))

/**
 * The bones a build reshapes round, told apart by the end of their names
 * (Rocketbox's "Bip01 L UpperArm" arrives as "Bip01_L_UpperArm"), and for
 * each limb the bone its own line runs to.
 */
const BONE_PARTS = {
  pelvis: { name: /pelvis$/, next: null },
  spine: { name: /spine$/, next: null },
  spine1: { name: /spine1$/, next: null },
  spine2: { name: /spine2$/, next: null },
  neck: { name: /neck$/, next: 'head' },
  head: { name: /head$/, next: null },
  clavicle: { name: /clavicle$/, next: 'upperArm' },
  upperArm: { name: /upperarm$/, next: 'forearm' },
  forearm: { name: /forearm$/, next: 'hand' },
  hand: { name: /hand$/, next: null },
  thigh: { name: /thigh$/, next: 'calf' },
  calf: { name: /calf$/, next: 'foot' },
  foot: { name: /foot$/, next: null },
} as const satisfies Record<string, { name: RegExp; next: string | null }>

type BonePart = keyof typeof BONE_PARTS

/** Which part a bone is, by its name (null for the head's, hands' and feet's many others). */
export function bonePart(name: string): BonePart | null {
  const plain = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [part, { name: pattern }] of Object.entries(BONE_PARTS)) {
    if (pattern.test(plain)) return part as BonePart
  }
  return null
}

/**
 * How much longer (as a share of their own length) the length sliders make
 * their stretch of the body at full setting, or shorter at −1: the legs'
 * thighs and shins, and the spine from the small of the back to the neck.
 */
export const LENGTH_GROWTH = { legLength: 0.1, torsoLength: 0.1 } as const

type LengthSliderId = keyof typeof LENGTH_GROWTH

/** How many times its own length a build makes a length slider's stretch of the body. */
export const lengthScale = (body: BodyShape, id: LengthSliderId) =>
  1 + LENGTH_GROWTH[id] * (body.sliders[id] ?? 0)

/**
 * The bones the length sliders stretch, each from its joint to its child's
 * (`next`), which moves out along it — and everything beyond, unstretched,
 * with it: the feet, the neck and the head, the shoulders and the arms.
 * The thighs hang from the spine's first bone beside the next, so the
 * torso's stretch starts above them and leaves the hips and the legs be.
 */
const STRETCHED: Partial<Record<BonePart, { slider: LengthSliderId; next: BonePart }>> = {
  thigh: { slider: 'legLength', next: 'calf' },
  calf: { slider: 'legLength', next: 'foot' },
  spine: { slider: 'torsoLength', next: 'spine1' },
  spine1: { slider: 'torsoLength', next: 'spine2' },
  spine2: { slider: 'torsoLength', next: 'neck' },
}

/** How a bone's stretch runs: its slider, if it has one, and the child its line runs to. */
const stretchOf = (bone: Object3D) => {
  const part = bonePart(bone.name)
  return part ? STRETCHED[part] : undefined
}

/**
 * How many times further from its parent's joint a build sets a bone: the
 * end of a stretched bone's line moves out along it.
 */
export function boneReach(body: BodyShape, bone: Object3D) {
  const stretch = bone.parent ? stretchOf(bone.parent) : undefined
  return stretch && stretch.next === bonePart(bone.name) ? lengthScale(body, stretch.slider) : 1
}

/**
 * The lines a body fills out round: a limb's own (its joint to its child's
 * joint), the spine's (the pelvis's joint to the neck's) or the neck's (the
 * neck's joint to the head's). The torso and neck share one line each
 * whichever of their bones carries a point, so their skin weights — which
 * differ between a shirt's layers — can't pull neighbouring points apart.
 */
type LineName = 'own' | 'spine' | 'neck'

/**
 * One way a slider fills out or slims a stretch of the body at full setting
 * (−1 does the opposite): the points its `bones` carry (by their skin
 * weight) move away from its line by a share of how far they are from it.
 * That share is `side` sideways (`inner` towards the body's middle, for a
 * limb's inside), `front` and `back` forwards and backwards, blended by
 * direction. `span` is where along the line it reaches (0 at the line's
 * start, 1 at its end): rising in from `span[0]`, whole from `span[1]` to
 * `span[2]`, gone at `span[3]`. `radius`, if set, is how far out from the
 * line (in the line's lengths) it reaches: whole within the first, gone
 * at the second.
 */
type Swell = {
  bones: readonly BonePart[]
  line: LineName
  span: readonly [number, number, number, number]
  radius: readonly [number, number] | null
  side: number
  inner: number
  front: number
  back: number
}

/**
 * How much of a limb's swell reaches its inside (towards the body's
 * middle): the thighs' insides and the arms' pits touch soon, so filled
 * out they would cut into each other or the chest.
 */
const THIGH_INSIDE = 0.4
const ARM_INSIDE = 0.6

/** A swell round a limb's own line, as much all round but for its inside. */
const limb = (
  bones: readonly BonePart[],
  share: number,
  span: Swell['span'],
  inside = 1,
): Swell => ({
  bones,
  line: 'own',
  span,
  radius: null,
  side: share,
  inner: share * inside,
  front: share,
  back: share,
})

/** A swell round the spine's line, by direction. */
const trunk = (
  bones: readonly BonePart[],
  span: Swell['span'],
  shares: { side: number; front: number; back: number },
): Swell => ({ bones, line: 'spine', span, radius: null, inner: shares.side, ...shares })

/**
 * Where along the neck's line the neck's swell reaches: from down on the
 * collar, and dying away before the head's joint, where the skin turns the
 * head's — which no swell carries, so a swell still whole there would pull
 * the nape away from the head's points beside it and fold it.
 */
const NECK_SPAN = [-1.6, -0.9, 0.35, 0.85] as const
/** How far out from the neck's line (in its lengths) its swell reaches: all the neck, but barely the shoulders. */
const NECK_RADIUS = [1, 2.6] as const

/** A swell round the neck's line, from the collar up to under the jaw. */
const neck = (share: number): Swell => ({
  bones: ['spine2', 'neck'],
  line: 'neck',
  span: NECK_SPAN,
  radius: NECK_RADIUS,
  side: share,
  inner: share,
  front: share,
  back: share,
})

/** The bones the trunk's swells follow: the torso's and, for the hips and the groin, the thighs'. */
const TRUNK: readonly BonePart[] = ['pelvis', 'spine', 'spine1', 'spine2', 'thigh']

/**
 * Each girth slider's swells. The spine's line runs from the pelvis (0,
 * about the hip joints) to the neck (1): the belly sits about a fifth of
 * the way up, the waist two fifths, the chest two thirds.
 */
const SWELLS: Partial<Record<BodySliderId, readonly Swell[]>> = {
  weight: [
    trunk(TRUNK, [-0.35, -0.1, 0.5, 0.85], { side: 0.2, front: 0.32, back: 0.14 }),
    // Taking over from the trunk's down the thigh rather than doubling it
    // at the hips, where a skirt's layers are carried by the thighs unevenly.
    limb(['thigh'], 0.24, [0.1, 0.5, 0.6, 1.1], THIGH_INSIDE),
    limb(['calf'], 0.1, [-0.3, 0.15, 0.45, 0.85]),
    limb(['upperArm'], 0.22, [-0.4, 0.05, 0.8, 1.2], ARM_INSIDE),
    limb(['forearm'], 0.08, [-0.3, 0.15, 0.45, 0.85]),
    neck(0.2),
  ],
  muscle: [
    // Rising from well down the chest, so what lies on it (a holster, a
    // pocket) leans out with it rather than being sheared open.
    trunk(TRUNK, [0.25, 0.62, 0.88, 1.05], { side: 0.14, front: 0.24, back: 0.12 }),
    limb(['clavicle'], 0.3, [-0.2, 0.3, 1, 1.4]),
    limb(['upperArm'], 0.3, [-0.4, 0.05, 0.8, 1.2], ARM_INSIDE),
    limb(['forearm'], 0.2, [-0.3, 0.15, 0.45, 0.85]),
    // From a little below the hip joint, like the weight's, where a tunic's layers part.
    limb(['thigh'], 0.45, [0.1, 0.45, 0.75, 1.1], THIGH_INSIDE),
    limb(['calf'], 0.28, [-0.3, 0.1, 0.45, 0.8]),
  ],
  chest: [trunk(TRUNK, [0.48, 0.62, 0.78, 0.92], { side: 0.08, front: 0.35, back: 0 })],
  waist: [trunk(TRUNK, [0.05, 0.28, 0.5, 0.72], { side: 0.24, front: 0.14, back: 0.12 })],
  belly: [trunk(TRUNK, [-0.45, 0.12, 0.3, 0.6], { side: 0.08, front: 0.4, back: 0 })],
  hips: [trunk(TRUNK, [-0.5, -0.2, 0, 0.25], { side: 0.28, front: 0.05, back: 0.25 })],
  neck: [neck(0.35)],
  arms: [
    limb(['upperArm'], 0.3, [-0.4, 0.05, 0.8, 1.2], ARM_INSIDE),
    limb(['forearm'], 0.25, [-0.3, 0.15, 0.5, 0.9]),
  ],
  legs: [
    limb(['thigh'], 0.3, [-0.4, 0, 0.8, 1.2], THIGH_INSIDE),
    limb(['calf'], 0.25, [-0.3, 0.15, 0.5, 0.9]),
  ],
}

/**
 * However the sliders add up, no point slims by more than this share of
 * its distance from the lines it follows (a thigh's top follows its own
 * and the spine's), so a body never thins to nothing or turns inside out.
 */
const MOST_SLIMMED = 0.6

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** How much of a swell reaches a point `t` along its line. */
function along(span: Swell['span'], t: number) {
  if (t <= span[0] || t >= span[3]) return 0
  if (t < span[1]) return smoothstep((t - span[0]) / (span[1] - span[0]))
  if (t > span[2]) return smoothstep((span[3] - t) / (span[3] - span[2]))
  return 1
}

/**
 * How much of a swell reaches a point `distance` (in the line's lengths)
 * out from its line. Past the swell's radius its push dies away as the
 * square of the distance — the surface round it then spreads as much as it
 * is pushed, rather than bunching up into a fold — and fades out entirely
 * by the radius's far end.
 */
function out(radius: Swell['radius'], distance: number) {
  if (!radius || distance <= radius[0]) return 1
  if (distance >= radius[1]) return 0
  const spread = (radius[0] / distance) ** 2
  return spread * smoothstep((radius[1] - distance) / (radius[1] - radius[0]))
}

/**
 * A line of the bind pose: from `start` along `axis` (a unit vector) for
 * `length`. `side` is which side of the body a limb's line is on (+1 its
 * left, −1 its right, 0 down the middle), so its inside is towards the middle.
 */
type Line = { start: Vector3; axis: Vector3; length: number; side: number }

/** Shorter than this (m), a line between two joints has no direction: they stand together. */
const SHORTEST_LINE = 1e-6

function lineBetween(start: Vector3, end: Vector3, middle: boolean): Line | null {
  const axis = end.clone().sub(start)
  const length = axis.length()
  if (length < SHORTEST_LINE) return null
  return { start, axis: axis.divideScalar(length), length, side: middle ? 0 : Math.sign(start.x) }
}

/** The swells (at their sliders' settings) one bone carries, by the line they follow. */
type Carried = { line: Line; swells: { swell: Swell; amount: number }[] }[]

/** Where each of a skeleton's bones stands in the bind pose. */
export function bindPositions(mesh: SkinnedMesh): Vector3[] {
  const matrix = new Matrix4()
  return mesh.skeleton.boneInverses.map((inverse) =>
    new Vector3().setFromMatrixPosition(matrix.copy(inverse).invert()),
  )
}

function carriedByBone(mesh: SkinnedMesh, active: [Swell, number][]): (Carried | null)[] {
  const bones = mesh.skeleton.bones
  const positions = bindPositions(mesh)
  const parts = bones.map((bone) => bonePart(bone.name))
  const indexOf = new Map<Bone, number>(bones.map((bone, index) => [bone, index]))
  const middle = (from: BonePart, to: BonePart) => {
    const start = parts.indexOf(from)
    const end = parts.indexOf(to)
    return start >= 0 && end >= 0 ? lineBetween(positions[start]!, positions[end]!, true) : null
  }
  const spine = middle('pelvis', 'neck')
  const neck = middle('neck', 'head')
  return bones.map((bone, index) => {
    const part = parts[index]
    if (!part) return null
    const next = BONE_PARTS[part].next
    const child = next ? bone.children.find((each) => bonePart(each.name) === next) : undefined
    const childIndex = child ? indexOf.get(child as Bone) : undefined
    const own =
      childIndex === undefined
        ? null
        : lineBetween(positions[index]!, positions[childIndex]!, false)
    const lines: Record<LineName, Line | null> = { own, spine, neck }
    const carried: Carried = []
    for (const [swell, amount] of active) {
      const line = lines[swell.line]
      if (!(line && swell.bones.includes(part))) continue
      const group = carried.find((each) => each.line === line)
      if (group) group.swells.push({ swell, amount })
      else carried.push({ line, swells: [{ swell, amount }] })
    }
    return carried.length > 0 ? carried : null
  })
}

const fromStart = new Vector3()
const outward = new Vector3()
const growing = new Vector3()
const slimming = new Vector3()

/**
 * Nearer its line than this (m, squared), a point has no direction out
 * from it to fill out or slim along.
 */
const ON_LINE = 1e-12

/**
 * How far (as a share of its distance from the line) a point `across` from
 * a line moves out by one swell. The direction blend is smooth: each share
 * is weighted by the square of that direction's part of `across`, so the
 * switch between front and back (or inside and out) happens where it
 * counts for nothing.
 */
function share(swell: Swell, line: Line, across: Vector3, distanceSq: number) {
  const x = (across.x * across.x) / distanceSq
  const y = (across.y * across.y) / distanceSq
  const z = (across.z * across.z) / distanceSq
  const sideways = line.side !== 0 && across.x * line.side < 0 ? swell.inner : swell.side
  return sideways * x + swell.side * y + (across.z > 0 ? swell.front : swell.back) * z
}

/** The girth sliders' moves for a mesh's points, round the lines their bones carry. */
function girthMove(mesh: SkinnedMesh, carried: (Carried | null)[]): PointMove {
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  return (point, index, move) => {
    move.set(0, 0, 0)
    slimming.set(0, 0, 0)
    let slimmed = 0
    for (let k = 0; k < skinIndex.itemSize; k++) {
      const weight = skinWeight.getComponent(index, k)
      const groups = carried[skinIndex.getComponent(index, k)]
      if (weight === 0 || !groups) continue
      for (const { line, swells } of groups) {
        fromStart.copy(point).sub(line.start)
        const lengthwise = fromStart.dot(line.axis)
        outward.copy(fromStart).addScaledVector(line.axis, -lengthwise)
        const distanceSq = outward.lengthSq()
        if (distanceSq < ON_LINE) continue
        const t = lengthwise / line.length
        const distance = Math.sqrt(distanceSq) / line.length
        let total = 0
        for (const { swell, amount } of swells) {
          const reach = along(swell.span, t) * out(swell.radius, distance)
          if (reach > 0) total += amount * reach * share(swell, line, outward, distanceSq)
        }
        if (total > 0) {
          growing.copy(outward).multiplyScalar(weight * total)
          // A filling-out limb's inside pushes towards the body's middle
          // the less the nearer it is to it, so it never crosses (and the
          // thighs never push into each other at the crotch).
          if (growing.x * line.side < 0) {
            growing.x *= Math.min(1, Math.max(0, point.x / line.start.x))
          }
          move.add(growing)
        } else {
          slimming.addScaledVector(outward, weight * total)
          slimmed -= weight * total
        }
      }
    }
    move.addScaledVector(slimming, slimmed > MOST_SLIMMED ? MOST_SLIMMED / slimmed : 1)
  }
}

/**
 * The character's own meshes — body, head, and hair and lashes — by their
 * material's name, or a body made all in one (whose material names only
 * the character, like Female_Adult_16's); any other is something worn or
 * carried over them.
 */
const OWN_MESH = /_(body|head|opacity)$|^[a-z]+\d+$/

/**
 * Points within this (m) of each other are one: a texture seam splits a
 * surface's points into copies at one spot, which must move together.
 */
const WELD = 1e-5

/**
 * A mesh's points in the bind pose (where its bones' lines stand), the
 * spot each is at (named by the first of the points there), its
 * triangles' corners, and the geometry they are from.
 */
type Surface = {
  geometry: BufferGeometry
  points: Vector3[]
  spots: number[]
  corners: ArrayLike<number>
}

/**
 * Each mesh's surface while its geometry lasts: a body is reshaped anew
 * for every nudge of a slider, but its surfaces stay as they are.
 */
const surfaces = new WeakMap<Mesh, Surface>()

function surfaceOf(mesh: SkinnedMesh): Surface {
  const geometry = originalGeometry(mesh)
  const kept = surfaces.get(mesh)
  if (kept?.geometry === geometry) return kept
  const position = geometry.getAttribute('position')
  const points = Array.from({ length: position.count }, (_, index) =>
    new Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.bindMatrix),
  )
  const firsts = new Map<string, number>()
  const spots = points.map((point, index) => {
    const key = `${Math.round(point.x / WELD)},${Math.round(point.y / WELD)},${Math.round(point.z / WELD)}`
    const first = firsts.get(key)
    if (first !== undefined) return first
    firsts.set(key, index)
    return index
  })
  const corners =
    geometry.index?.array ?? Array.from({ length: position.count }, (_, index) => index)
  const surface = { geometry, points, spots, corners }
  surfaces.set(mesh, surface)
  return surface
}

/** Sets of numbers joined together: `find` names the set a number is in. */
function unions(count: number) {
  const parent = Array.from({ length: count }, (_, index) => index)
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  const join = (a: number, b: number) => {
    parent[find(b)] = find(a)
  }
  return { find, join }
}

/** Which piece each of a surface's points belongs to: the points its triangles join, at one spot or another. */
function piecesOf({ points, spots, corners }: Surface): number[] {
  const { find, join } = unions(points.length)
  spots.forEach((spot, index) => {
    join(spot, index)
  })
  for (let i = 0; i < corners.length; i += 3) {
    join(corners[i]!, corners[i + 1]!)
    join(corners[i]!, corners[i + 2]!)
  }
  return points.map((_, index) => find(index))
}

/**
 * How near (m) two pieces of something worn come for one to hold the
 * other — a pistol in its holster, a hammer in its loop, a pouch on its
 * belt — so they keep together.
 */
const TOUCHING = 0.008

/**
 * How many cells (TOUCHING across) along each axis are told apart when
 * looking for touching points: past that the numbering wraps round, and
 * a far point in a cell of the same number is told apart by its distance.
 */
const CELLS = 1024

const cellOf = (value: number) => Math.floor(value / TOUCHING)
const cellKey = (x: number, y: number, z: number) =>
  ((x & (CELLS - 1)) * CELLS + (y & (CELLS - 1))) * CELLS + (z & (CELLS - 1))

const NONE: readonly number[] = []

/**
 * Calls `touch` for each two points of different pieces within TOUCHING
 * of each other, one of them among the first `seeking` points: the rest
 * (the body under what is worn) are only ever touched.
 */
function eachTouching(
  points: readonly Vector3[],
  pieceOf: readonly number[],
  touch: (a: number, b: number) => void,
  seeking: number,
) {
  type Cell = { x: number; y: number; z: number; seekers: number[]; members: number[] }
  const cells = new Map<number, Cell>()
  points.forEach((point, index) => {
    const [x, y, z] = [cellOf(point.x), cellOf(point.y), cellOf(point.z)]
    const key = cellKey(x, y, z)
    const cell = cells.get(key) ?? { x, y, z, seekers: [], members: [] }
    cells.set(key, cell)
    cell.members.push(index)
    if (index < seeking) cell.seekers.push(index)
  })
  for (const { x, y, z, seekers } of cells.values()) {
    if (seekers.length === 0) continue
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const near = cells.get(cellKey(x + dx, y + dy, z + dz))?.members ?? NONE
          for (const a of seekers) {
            for (const b of near) {
              if (
                (b > a || b >= seeking) &&
                pieceOf[a] !== pieceOf[b] &&
                points[a]!.distanceTo(points[b]!) < TOUCHING
              ) {
                touch(a, b)
              }
            }
          }
        }
      }
    }
  }
}

const mean = (vectors: readonly Vector3[]) =>
  vectors.reduce((sum, each) => sum.add(each), new Vector3()).divideScalar(vectors.length)

/** The lines a piece of something worn follows: its main bone's (by its points' skin weights). */
function linesOf(mesh: SkinnedMesh, indices: readonly number[], carried: (Carried | null)[]) {
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  const weights = new Map<number, number>()
  for (const index of indices) {
    for (let k = 0; k < skinIndex.itemSize; k++) {
      const bone = skinIndex.getComponent(index, k)
      weights.set(bone, (weights.get(bone) ?? 0) + skinWeight.getComponent(index, k))
    }
  }
  const main = [...weights].reduce((best, each) => (each[1] > best[1] ? each : best))[0]
  return (carried[main] ?? []).map(({ line }) => line)
}

/** The bones some swell follows: all but the head's, the hands' and the feet's. */
const SWOLLEN = new Set<BonePart>(
  Object.values(SWELLS).flatMap((swells) => swells.flatMap((swell) => swell.bones)),
)

/** Which of each skeleton's bones some swell follows, worked out once (a body's skeleton stays). */
const swollenBones = new WeakMap<Skeleton, boolean[]>()

function swollenOf(skeleton: Skeleton) {
  const kept = swollenBones.get(skeleton)
  if (kept) return kept
  const swollen = skeleton.bones.map((bone) => {
    const part = bonePart(bone.name)
    return part !== null && SWOLLEN.has(part)
  })
  swollenBones.set(skeleton, swollen)
  return swollen
}

/**
 * Whether a build can reach a point of a mesh (by its index): whether any
 * bone carrying it is one a swell follows. What none does — the head's
 * points, a helmet's — never moves.
 */
function reaching(mesh: SkinnedMesh) {
  const swollen = swollenOf(mesh.skeleton)
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  return (index: number) => {
    for (let k = 0; k < skinIndex.itemSize; k++) {
      if (skinWeight.getComponent(index, k) > 0 && swollen[skinIndex.getComponent(index, k)]) {
        return true
      }
    }
    return false
  }
}

const across = new Vector3()
const sideways = new Vector3()
const upwards = new Vector3()

/**
 * Whether points lie all round a line — a belt round the spine, a strap
 * round a thigh — rather than off to one side of it: seen along the line,
 * no half turn round it is empty of them.
 */
function surrounds(points: readonly Vector3[], line: Line) {
  // Across the line from the world's axis least along it, so never along it.
  const least = [0, 1, 2].reduce((a, b) =>
    Math.abs(line.axis.getComponent(b)) < Math.abs(line.axis.getComponent(a)) ? b : a,
  )
  sideways.set(0, 0, 0).setComponent(least, 1).cross(line.axis).normalize()
  upwards.crossVectors(line.axis, sideways)
  const angles = points
    .map((point) => {
      across.copy(point).sub(line.start)
      return Math.atan2(across.dot(upwards), across.dot(sideways))
    })
    .sort((a, b) => a - b)
  let widest = angles[0]! + 2 * Math.PI - angles[angles.length - 1]!
  for (let k = 1; k < angles.length; k++) widest = Math.max(widest, angles[k]! - angles[k - 1]!)
  return widest < Math.PI
}

/**
 * Whether something worn hangs off to one side of the lines it follows (a
 * holster on the hip, a hammer down a thigh) rather than round any of them
 * (a belt, a stethoscope's loop, a vest's plates together).
 */
const hangsClear = (points: readonly Vector3[], lines: Iterable<Line>) =>
  [...lines].every((line) => !surrounds(points, line))

/** Hanging pieces holding on to each other: their points, those where they are held, and the lines they follow. */
type Cluster = { points: number[]; held: number[]; lines: Set<Line> }

/**
 * How far (m) the points something riding is held at must spread for it to
 * turn by their moves: held at one spot it only shifts, rather than swing
 * its far end about on the least difference there.
 */
const TURN_REACH = 0.02
/** The most (in radians) something riding turns to keep to where it is held. */
const MOST_TURN = 0.3

/** A rigid move — a shift and a turn — of a point, written into `out`. */
type RigidMove = (point: Vector3, out: Vector3) => void

/**
 * The rigid move that best takes points where their moves would: a shift
 * by their average and the turn about their middle that their moves round
 * it make (their spin over how they spread round it), so what rides keeps
 * its shape and to where it is held on — a pouch hanging from a belt over
 * a filling-out hip swings out at the bottom.
 */
function rigidFit(points: readonly Vector3[], moves: readonly Vector3[]): RigidMove {
  const centre = mean(points)
  const shift = mean(moves)
  const spread = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0)
  const spin = new Vector3()
  const arm = new Vector3()
  const push = new Vector3()
  points.forEach((point, k) => {
    arm.subVectors(point, centre)
    push.subVectors(moves[k]!, shift)
    spin.add(new Vector3().crossVectors(arm, push))
    // How the points spread round their middle: Σ (|arm|² I − arm armᵀ), and a little more.
    const lengthSq = arm.lengthSq() + TURN_REACH ** 2
    const reach = arm.toArray()
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        spread.elements[i * 3 + j]! += (i === j ? lengthSq : 0) - reach[i]! * reach[j]!
      }
    }
  })
  const turn = spin.applyMatrix3(spread.invert())
  const angle = Math.min(turn.length(), MOST_TURN)
  const rotation =
    angle > 0 ? new Matrix4().makeRotationAxis(turn.normalize(), angle) : new Matrix4()
  return (point, out) => {
    out.subVectors(point, centre).applyMatrix4(rotation).add(centre).add(shift).sub(point)
  }
}

/**
 * What a body wears, laid out — the same whatever its build, so worked out
 * once: the worn meshes and their surfaces, all their points one mesh
 * after another (each from its `start`) and then the body's they rest on,
 * the piece each point is in (the body's all `worn`, one more than any
 * worn piece), each worn piece's mesh and points, and each two points of
 * different pieces that touch (the first of them worn).
 */
type Wardrobe = {
  from: readonly Surface[]
  meshes: SkinnedMesh[]
  starts: number[]
  worn: number
  points: Vector3[]
  pieceOf: number[]
  pieces: Map<number, { mesh: number; points: number[] }>
  touching: [number, number][]
}

/** Each body's wardrobe, while its meshes and their geometry stay. */
const wardrobes = new WeakMap<Object3D, Wardrobe>()

/** The wardrobe of a body whose skinned meshes are `meshes`. */
function wardrobeOf(body: Object3D, meshes: readonly SkinnedMesh[]): Wardrobe {
  const from = meshes.map(surfaceOf)
  const kept = wardrobes.get(body)
  if (kept?.from.length === from.length && kept.from.every((each, k) => each === from[k])) {
    return kept
  }
  const worn = meshes.filter((mesh) => !isOwn(mesh))
  const starts: number[] = []
  let count = 0
  for (const mesh of worn) {
    starts.push(count)
    count += surfaceOf(mesh).points.length
  }
  const resting = meshes.filter(isOwn).flatMap((mesh) => surfaceOf(mesh).points)
  const points = [...worn.flatMap((mesh) => surfaceOf(mesh).points), ...resting]
  const pieceOf = [
    ...worn.flatMap((mesh, k) => piecesOf(surfaceOf(mesh)).map((piece) => piece + starts[k]!)),
    ...resting.map(() => count),
  ]
  const pieces = new Map<number, { mesh: number; points: number[] }>()
  worn.forEach((mesh, k) => {
    surfaceOf(mesh).points.forEach((_, index) => {
      const piece = pieceOf[starts[k]! + index]!
      const members = pieces.get(piece) ?? { mesh: k, points: [] }
      pieces.set(piece, members)
      members.points.push(index)
    })
  })
  const touching: [number, number][] = []
  eachTouching(points, pieceOf, (a, b) => touching.push([a, b]), count)
  const wardrobe = { from, meshes: worn, starts, worn: count, points, pieceOf, pieces, touching }
  wardrobes.set(body, wardrobe)
  return wardrobe
}

/** No move at all, for what no slider reaches. */
const still: PointMove = (_point, _index, move) => {
  move.set(0, 0, 0)
}

/**
 * Moves for everything a body wears or carries, all its meshes together
 * (`carried` by each's bones). What wraps round the body (a belt) fills
 * out and slims with the body under it. What hangs off to one side rides
 * along whole, so it keeps its shape — together with everything hanging
 * that it touches, in whichever mesh (a holster, the pistol in it and the
 * clip on it are one) — shifted and turned as the body moves where it is
 * held (the belt it hangs from, the hip it lies on), else as its points
 * would on average.
 * Hanging things that together wrap round the body (a vest's plates, edge
 * to edge) fill out with it too.
 */
function wornMoves(
  wardrobe: Wardrobe,
  carried: readonly ((Carried | null)[] | null)[],
): PointMove[] {
  const { meshes, starts, worn, points, pieceOf, pieces, touching } = wardrobe
  const moves = meshes.map((mesh, k) => {
    const by = carried[k]
    return by ? girthMove(mesh, by) : still
  })
  const reach = meshes.map(reaching)
  const hanging = new Map<number, Line[]>()
  for (const [piece, { mesh, points: indices }] of pieces) {
    // A piece the build doesn't reach all of (a strap from a helmet) keeps to
    // the bones it doesn't, filling out as the body does rather than riding off.
    const by = carried[mesh]
    if (!(by && indices.every(reach[mesh]!))) continue
    const lines = linesOf(meshes[mesh]!, indices, by)
    const at = indices.map((index) => points[starts[mesh]! + index]!)
    if (hangsClear(at, lines)) hanging.set(piece, lines)
  }
  if (hanging.size === 0) return moves
  const { find, join } = unions(worn)
  const held = new Set<number>()
  for (const [a, b] of touching) {
    const [hangsA, hangsB] = [hanging.has(pieceOf[a]!), hanging.has(pieceOf[b]!)]
    if (hangsA && hangsB) join(pieceOf[a]!, pieceOf[b]!)
    else if (hangsA) held.add(a)
    else if (hangsB) held.add(b)
  }
  const clusters = new Map<number, Cluster>()
  for (const [piece, { mesh, points: indices }] of pieces) {
    const lines = hanging.get(piece)
    if (!lines) continue
    const id = find(piece)
    const cluster = clusters.get(id) ?? { points: [], held: [], lines: new Set() }
    clusters.set(id, cluster)
    for (const index of indices) {
      const at = starts[mesh]! + index
      cluster.points.push(at)
      if (held.has(at)) cluster.held.push(at)
    }
    for (const line of lines) cluster.lines.add(line)
  }
  const moveOf = (at: number) => {
    const { mesh } = pieces.get(pieceOf[at]!)!
    const moved = new Vector3()
    moves[mesh]!(points[at]!, at - starts[mesh]!, moved)
    return moved
  }
  const riding = new Map<number, RigidMove>()
  for (const [id, cluster] of clusters) {
    if (
      !hangsClear(
        cluster.points.map((at) => points[at]!),
        cluster.lines,
      )
    )
      continue
    const by = cluster.held.length > 0 ? cluster.held : cluster.points
    riding.set(
      id,
      rigidFit(
        by.map((at) => points[at]!),
        by.map(moveOf),
      ),
    )
  }
  return moves.map((move, k) => (point, index, out) => {
    const piece = pieceOf[starts[k]! + index]!
    const rigid = hanging.has(piece) ? riding.get(find(piece)) : undefined
    if (rigid) rigid(point, out)
    else move(point, index, out)
  })
}

/**
 * The share of its area (as seen from the way it faced) a triangle eased
 * out of a fold is brought back to: it turned over below none, and is
 * eased a little clear of that, so easing its neighbours after it doesn't
 * turn it straight back.
 */
const KEPT_AT = 0.1
/**
 * Steps in easing a folding triangle: the share it keeps is not straight
 * in its corners' moves, so each step's aim falls a little short.
 */
const EASING_STEPS = 4
/** The most rounds of easing folds, each round easing the triangles the last one folded. */
const EASING_ROUNDS = 60

const facing = new Vector3()
const sideA = new Vector3()
const sideB = new Vector3()
const turned = new Vector3()

/**
 * How much of its area (as seen from the way it faced) a triangle keeps
 * with its corners moved: below none, it has turned over.
 */
function kept(points: readonly Vector3[], corner: readonly number[], moves: readonly Vector3[]) {
  const [a, b, c] = corner.map((spot) => points[spot]!) as [Vector3, Vector3, Vector3]
  facing.crossVectors(sideA.subVectors(b, a), sideB.subVectors(c, a))
  const area = facing.lengthSq()
  if (area === 0) return 1
  sideA.add(moves[1]!).sub(moves[0]!)
  sideB.add(moves[2]!).sub(moves[0]!)
  return turned.crossVectors(sideA, sideB).dot(facing) / area
}

/**
 * A surface's triangles by the spots at their corners, and the spots on
 * its edge: a sleeve's hem, the neck's seam with the head.
 */
function trianglesOf({ points, spots, corners }: Surface) {
  const bySpot = new Map<number, number[]>()
  const edges = new Map<number, number>()
  for (let i = 0; i < corners.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const spot = spots[corners[i + k]!]!
      const next = spots[corners[i + ((k + 1) % 3)]!]!
      const list = bySpot.get(spot)
      if (list) list.push(i)
      else bySpot.set(spot, [i])
      const edge = Math.min(spot, next) * points.length + Math.max(spot, next)
      edges.set(edge, (edges.get(edge) ?? 0) + 1)
    }
  }
  const edge = new Set<number>()
  for (const [key, count] of edges) {
    if (count === 1) edge.add(Math.floor(key / points.length)).add(key % points.length)
  }
  return { bySpot, edge }
}

const pulls = [new Vector3(), new Vector3(), new Vector3()]

/**
 * Eases a folding triangle's corners' moves the least it takes for it to
 * keep KEPT_AT of its area: each the way that share grows fastest with it
 * (for a needle along a seam, a nudge across its short side rather than
 * its far ends pulled together). Its `fixed` corners stay. Returns the
 * spots it moved.
 */
function ease(
  points: readonly Vector3[],
  corner: readonly number[],
  moves: Vector3[],
  fixed: ReadonlySet<number>,
) {
  const free = corner.map((spot) => !fixed.has(spot))
  if (!free.some(Boolean)) return []
  for (let step = 0; step < EASING_STEPS; step++) {
    const share = kept(points, corner, [moves[corner[0]!]!, moves[corner[1]!]!, moves[corner[2]!]!])
    if (share >= KEPT_AT) break
    // `kept` left the triangle's facing, over its area, and its moved sides.
    facing.divideScalar(facing.lengthSq())
    pulls[1]!.crossVectors(sideB, facing)
    pulls[2]!.crossVectors(facing, sideA)
    pulls[0]!.copy(pulls[1]!).add(pulls[2]!).negate()
    let steepness = 0
    pulls.forEach((pull, k) => {
      if (free[k]) steepness += pull.lengthSq()
      else pull.set(0, 0, 0)
    })
    if (steepness === 0) break
    corner.forEach((spot, k) => {
      moves[spot]!.addScaledVector(pulls[k]!, (KEPT_AT - share) / steepness)
    })
  }
  return corner.filter((_, k) => free[k])
}

/**
 * The moves eased where they would fold the surface — where points pushed
 * different ways meet (the armpit, where the torso's side swells into the
 * arm's) or where one bone's swell stops beside another's. Each folding
 * triangle's corners are eased towards a move they can share, and then any
 * triangle round them that folds in turn, until the surface lies flat.
 * What the build doesn't `reach` (the head's points) stays, and so does
 * the surface's edge, so whatever meets it there (another layer, the
 * head's mesh) still does. And the copies of a point at one spot move alike, so
 * a texture seam never opens. Nothing else changes.
 */
function unfolded(
  surface: Surface,
  move: PointMove,
  reached: (index: number) => boolean,
): PointMove {
  const { points, spots, corners } = surface
  const own = points.map((point, index) => {
    const moved = new Vector3()
    move(point, index, moved)
    return moved
  })
  const moves = points.map(() => new Vector3())
  const copies = points.map(() => 0)
  own.forEach((moved, index) => {
    const spot = spots[index]!
    moves[spot]!.add(moved)
    copies[spot]!++
  })
  moves.forEach((moved, spot) => {
    if (copies[spot]! > 1) moved.divideScalar(copies[spot]!)
  })
  const cornersOf = (i: number) => [
    spots[corners[i]!]!,
    spots[corners[i + 1]!]!,
    spots[corners[i + 2]!]!,
  ]
  const corner = [0, 0, 0]
  const moved = [new Vector3(), new Vector3(), new Vector3()]
  const folding = (i: number) => {
    for (let k = 0; k < 3; k++) {
      corner[k] = spots[corners[i + k]!]!
      moved[k] = moves[corner[k]!]!
    }
    return kept(points, corner, moved) < 0
  }
  let folded: number[] = []
  for (let i = 0; i < corners.length; i += 3) if (folding(i)) folded.push(i)
  if (folded.length > 0) {
    const { bySpot, edge } = trianglesOf(surface)
    const fixed = new Set(edge)
    spots.forEach((spot, index) => {
      if (!reached(index)) fixed.add(spot)
    })
    for (let round = 0; round < EASING_ROUNDS && folded.length > 0; round++) {
      const nearby = new Set<number>()
      for (const i of folded) {
        if (!folding(i)) continue
        for (const spot of ease(points, cornersOf(i), moves, fixed)) {
          for (const each of bySpot.get(spot) ?? []) nearby.add(each)
        }
      }
      folded = [...nearby].filter(folding)
    }
  }
  const shift = new Map<number, Vector3>()
  own.forEach((alone, index) => {
    const together = moves[spots[index]!]!
    if (!together.equals(alone)) shift.set(index, together.clone().sub(alone))
  })
  if (shift.size === 0) return move
  return (point, index, out) => {
    move(point, index, out)
    const by = shift.get(index)
    if (by) out.add(by)
  }
}

/** A stretched bone's line in the bind pose — from its joint along `span` to its child's — and how much it grows. */
type Stretch = { start: Vector3; span: Vector3; lengthSq: number; growth: number }

/**
 * The length sliders' moves for a mesh's points: each stretches along the
 * lines of the bones carrying it (by their skin weights) as much as it lies
 * along them, so a thigh lengthens evenly from the hip to the knee rather
 * than all in the bend of the knee. What lies past a line's end moves as
 * far as its end. That end itself, and all beyond it, the bones carry
 * (applyBodyBones moves the joints out), so a point the shin carries only
 * stretches with the shin here, and the foot's points don't move at all.
 * Null when the build stretches nothing this mesh's bones carry.
 */
function stretchMove(mesh: SkinnedMesh, body: BodyShape): PointMove | null {
  const bones = mesh.skeleton.bones
  const positions = bindPositions(mesh)
  const indexOf = new Map<Object3D, number>(bones.map((bone, index) => [bone, index]))
  const stretches = bones.map((bone, index): Stretch | null => {
    const stretch = stretchOf(bone)
    const growth = stretch ? lengthScale(body, stretch.slider) - 1 : 0
    if (!stretch || growth === 0) return null
    const child = bone.children.find((each) => bonePart(each.name) === stretch.next)
    const end = child ? indexOf.get(child) : undefined
    if (end === undefined) return null
    const span = positions[end]!.clone().sub(positions[index]!)
    const lengthSq = span.lengthSq()
    return lengthSq < SHORTEST_LINE ** 2
      ? null
      : { start: positions[index]!, span, lengthSq, growth }
  })
  if (stretches.every((each) => each === null)) return null
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  return (point, index, move) => {
    move.set(0, 0, 0)
    for (let k = 0; k < skinIndex.itemSize; k++) {
      const weight = skinWeight.getComponent(index, k)
      const stretch = stretches[skinIndex.getComponent(index, k)]
      if (weight === 0 || !stretch) continue
      const t = fromStart.copy(point).sub(stretch.start).dot(stretch.span) / stretch.lengthSq
      move.addScaledVector(stretch.span, weight * stretch.growth * clamp(t, 0, 1))
    }
  }
}

const stretched = new Vector3()

/** Two moves of the same points together, either of them none. */
function together(a: PointMove | null, b: PointMove | null): PointMove | null {
  if (!(a && b)) return a ?? b
  return (point, index, move) => {
    a(point, index, move)
    b(point, index, stretched)
    move.add(stretched)
  }
}

/** Whether a mesh bends with a skeleton, by its bones' skin weights. */
const isSkinned = (mesh: Mesh): mesh is SkinnedMesh =>
  (mesh as SkinnedMesh).isSkinnedMesh === true &&
  mesh.geometry.hasAttribute('skinIndex') &&
  mesh.geometry.hasAttribute('skinWeight')

/** Whether a mesh is the character's own rather than something worn over it (see OWN_MESH). */
function isOwn(mesh: Mesh) {
  const material = (mesh.userData.lookOriginal ?? mesh.material) as Material | Material[]
  return Array.isArray(material) || OWN_MESH.test(material.name)
}

/**
 * The build's girth and length sliders as moves of a skinned body's
 * bind-pose points: each point fills out or slims round the bones that
 * carry it, as much as they carry it, so the reshaped body still bends
 * with its skeleton — and nowhere folds — and stretches along them (see
 * stretchMove). Null when neither is set (height, shoulders and head size
 * are the skeleton's alone; see avatar-body.ts).
 */
export function bodyShaper(body: BodyShape): Shaper | null {
  const girth = girthShaper(body)
  const lengthened = (Object.keys(LENGTH_GROWTH) as LengthSliderId[]).some(
    (id) => (body.sliders[id] ?? 0) !== 0,
  )
  if (!(girth || lengthened)) return null
  return (mesh) => {
    if (!isSkinned(mesh)) return null
    return together(girth?.(mesh) ?? null, lengthened ? stretchMove(mesh, body) : null)
  }
}

/**
 * The girth sliders' moves, or null when none is set. Everything worn by
 * one body (its meshes' siblings) is moved together, worked out when the
 * first of it is shaped.
 */
function girthShaper(body: BodyShape): Shaper | null {
  const active: [Swell, number][] = []
  for (const [id, swells] of Object.entries(SWELLS) as [BodySliderId, readonly Swell[]][]) {
    const amount = body.sliders[id] ?? 0
    if (amount !== 0) for (const swell of swells) active.push([swell, amount])
  }
  if (active.length === 0) return null
  const carriedOf = (mesh: SkinnedMesh) => {
    const carried = carriedByBone(mesh, active)
    return carried.some((each) => each !== null) ? carried : null
  }
  const planned = new WeakMap<Object3D, Map<Mesh, PointMove>>()
  const plan = (group: Object3D, meshes: readonly SkinnedMesh[]) => {
    const wardrobe = wardrobeOf(group, meshes)
    const carried = wardrobe.meshes.map(carriedOf)
    const moves = wornMoves(wardrobe, carried)
    const plan = new Map<Mesh, PointMove>(
      wardrobe.meshes.map((mesh, k) => [
        mesh,
        unfolded(surfaceOf(mesh), moves[k]!, reaching(mesh)),
      ]),
    )
    planned.set(group, plan)
    return plan
  }
  return (mesh) => {
    if (!isSkinned(mesh)) return null
    if (isOwn(mesh)) {
      const carried = carriedOf(mesh)
      return carried ? unfolded(surfaceOf(mesh), girthMove(mesh, carried), reaching(mesh)) : null
    }
    const group = mesh.parent ?? mesh
    const meshes = mesh.parent
      ? mesh.parent.children.filter((each): each is SkinnedMesh => isSkinned(each as Mesh))
      : [mesh]
    return (planned.get(group) ?? plan(group, meshes)).get(mesh) ?? null
  }
}
