import { type Bone, type Material, Matrix4, type Mesh, type SkinnedMesh, Vector3 } from 'three'
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
  { id: 'shoulders', group: 'torso' },
  { id: 'chest', group: 'torso' },
  { id: 'waist', group: 'torso' },
  { id: 'belly', group: 'torso' },
  { id: 'hips', group: 'torso' },
  { id: 'neck', group: 'limbs' },
  { id: 'arms', group: 'limbs' },
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
 * A swell round the neck's line: from the collar up to under the jaw, dying
 * away past the neck itself so the shoulders barely move (the chin and face
 * are the head's and jaw's, which no swell carries).
 */
const neck = (share: number): Swell => ({
  bones: ['spine2', 'neck'],
  line: 'neck',
  span: [-1.6, -0.9, 0.6, 1.1],
  radius: [1, 2.6],
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
    trunk(TRUNK, [0.55, 0.7, 0.88, 1.05], { side: 0.1, front: 0.14, back: 0.08 }),
    limb(['clavicle'], 0.22, [-0.2, 0.3, 1, 1.4]),
    limb(['upperArm'], 0.3, [-0.4, 0.05, 0.8, 1.2], ARM_INSIDE),
    limb(['forearm'], 0.2, [-0.3, 0.15, 0.45, 0.85]),
    limb(['thigh'], 0.18, [-0.4, 0, 0.7, 1.1], THIGH_INSIDE),
    limb(['calf'], 0.22, [-0.3, 0.1, 0.45, 0.8]),
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

function lineBetween(start: Vector3, end: Vector3, middle: boolean): Line | null {
  const axis = end.clone().sub(start)
  const length = axis.length()
  if (length < 1e-6) return null
  return { start, axis: axis.divideScalar(length), length, side: middle ? 0 : Math.sign(start.x) }
}

/** The swells (at their sliders' settings) one bone carries, by the line they follow. */
type Carried = { line: Line; swells: { swell: Swell; amount: number }[] }[]

/** Where each of a skeleton's bones stands in the bind pose. */
function bindPositions(mesh: SkinnedMesh): Vector3[] {
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
        if (distanceSq < 1e-12) continue
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
 * material's name; any other is something worn or carried over them.
 */
const OWN_MESH = /_(body|head|opacity)$/

/**
 * Which piece each of a mesh's points belongs to: the points its triangles
 * join, and those at one spot (texture seams split a surface's points).
 */
function piecesOf(mesh: Mesh, points: readonly Vector3[]): number[] {
  const parent = points.map((_, index) => index)
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
  const spots = new Map<string, number>()
  points.forEach((point, index) => {
    const spot = `${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`
    const first = spots.get(spot)
    if (first === undefined) spots.set(spot, index)
    else join(first, index)
  })
  const corners = originalGeometry(mesh).index
  for (let i = 0; corners && i < corners.count; i += 3) {
    join(corners.getX(i), corners.getX(i + 1))
    join(corners.getX(i), corners.getX(i + 2))
  }
  return points.map((_, index) => find(index))
}

const distanceFrom = (line: Line, point: Vector3) => {
  fromStart.copy(point).sub(line.start)
  return fromStart.addScaledVector(line.axis, -fromStart.dot(line.axis)).length()
}

/**
 * Moves for something the body wears or carries. A piece of it that sits
 * off to one side of the lines its main bone follows (a holster on the hip,
 * a radio on the shoulder) rides along whole, as far as its points would
 * on average, so it keeps its shape; a piece those lines run through (a
 * belt, a stethoscope's loop) fills out and slims with the body under it.
 */
function carriedMove(mesh: SkinnedMesh, carried: (Carried | null)[], move: PointMove): PointMove {
  const position = originalGeometry(mesh).getAttribute('position')
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  const points = Array.from({ length: position.count }, (_, index) =>
    new Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.bindMatrix),
  )
  const pieceOf = piecesOf(mesh, points)
  const members = new Map<number, number[]>()
  pieceOf.forEach((piece, index) => {
    const list = members.get(piece)
    if (list) list.push(index)
    else members.set(piece, [index])
  })
  const riding = new Map<number, Vector3>()
  const moved = new Vector3()
  for (const [piece, indices] of members) {
    const centre = new Vector3()
    const weights = new Map<number, number>()
    for (const index of indices) {
      centre.add(points[index]!)
      for (let k = 0; k < skinIndex.itemSize; k++) {
        const bone = skinIndex.getComponent(index, k)
        weights.set(bone, (weights.get(bone) ?? 0) + skinWeight.getComponent(index, k))
      }
    }
    centre.divideScalar(indices.length)
    const radius = Math.max(...indices.map((index) => points[index]!.distanceTo(centre)))
    const main = [...weights].reduce((best, each) => (each[1] > best[1] ? each : best))[0]
    const groups = carried[main]
    if (!groups?.every(({ line }) => distanceFrom(line, centre) > radius)) continue
    const whole = new Vector3()
    for (const index of indices) {
      move(points[index]!, index, moved)
      whole.add(moved)
    }
    riding.set(piece, whole.divideScalar(indices.length))
  }
  return (point, index, out) => {
    const whole = riding.get(pieceOf[index]!)
    if (whole) out.copy(whole)
    else move(point, index, out)
  }
}

/** Whether a mesh bends with a skeleton, by its bones' skin weights. */
const isSkinned = (mesh: Mesh): mesh is SkinnedMesh =>
  (mesh as SkinnedMesh).isSkinnedMesh === true &&
  mesh.geometry.hasAttribute('skinIndex') &&
  mesh.geometry.hasAttribute('skinWeight')

/**
 * The build's girth sliders as moves of a skinned body's bind-pose points:
 * each point fills out or slims round the bones that carry it, as much as
 * they carry it, so the reshaped body still bends with its skeleton. Null
 * when no girth slider is set (height, shoulders and head size are the
 * skeleton's; see avatar-body.ts).
 */
export function bodyShaper(body: BodyShape): Shaper | null {
  const active: [Swell, number][] = []
  for (const [id, swells] of Object.entries(SWELLS) as [BodySliderId, readonly Swell[]][]) {
    const amount = body.sliders[id] ?? 0
    if (amount !== 0) for (const swell of swells) active.push([swell, amount])
  }
  if (active.length === 0) return null
  return (mesh) => {
    if (!isSkinned(mesh)) return null
    const carried = carriedByBone(mesh, active)
    if (carried.every((each) => each === null)) return null
    const move = girthMove(mesh, carried)
    const material = (mesh.userData.lookOriginal ?? mesh.material) as Material | Material[]
    const own = Array.isArray(material) || OWN_MESH.test(material.name)
    return own ? move : carriedMove(mesh, carried, move)
  }
}
