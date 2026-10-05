import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { FACE_POINT_MIRRORS } from './face-edit'
import {
  applyFaceDrag,
  EAR_DRAG_UNIT,
  FACE_HANDLE,
  FACE_HANDLES,
  type FaceDrag,
  type FaceHandleId,
  type FaceRegion,
  faceRegionOf,
  regionChanged,
  resetFaceRegion,
} from './face-handles'
import { type FacePin, sculpt } from './face-pins'
import { FACE_PARTS, FACE_POINT_INDICES, facePointOf, unpackPoints } from './face-points'
import {
  DEFAULT_FACE_SHAPE,
  FACE_SLIDERS,
  type FaceShape,
  faceShapeField,
  readFaceShape,
  type ShapeField,
} from './face-shape'

/** Real characters' landmarks, as the app downloads them. */
const REAL: Record<string, number[]> = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../../apps/editor/public/characters/rocketbox/face-points.json',
      import.meta.url,
    ),
    'utf8',
  ),
).avatars

/** Both sexes, children, and characters in work clothes. */
const CHARACTERS = [
  'Male_Adult_02',
  'Female_Adult_03',
  'Female_Child_01',
  'Male_Child_01',
  'Business_Male_03',
  'Medical_Female_01',
]

const TARGET = REAL.Male_Adult_02!

const IRISES = new Set(
  [...FACE_PARTS.rightIris, ...FACE_PARTS.leftIris].map((i) => FACE_POINT_INDICES[i]!),
)
const SKIN = FACE_POINT_INDICES.filter((landmark) => !IRISES.has(landmark))

const landmarkOf = (id: FaceHandleId) => {
  const handle = FACE_HANDLE[id]
  if (handle.kind !== 'landmark') throw new Error(`${id} is an ear`)
  return handle
}

const drag = (handle: FaceHandleId, delta: FacePin, more: Partial<FaceDrag> = {}): FaceDrag => ({
  handle,
  delta,
  symmetric: true,
  radiusScale: 1,
  ...more,
})

const mirrorOf = (landmark: number) =>
  FACE_POINT_INDICES[FACE_POINT_MIRRORS[facePointOf(landmark)]!]!

describe('the handles', () => {
  test('are the 32 of the catalogue, in its order, each found by its id', () => {
    expect(FACE_HANDLES.map((handle) => handle.id)).toEqual([
      'forehead',
      'brow-inner-r',
      'brow-inner-l',
      'brow-mid-r',
      'brow-mid-l',
      'brow-tail-r',
      'brow-tail-l',
      'eye-inner-r',
      'eye-inner-l',
      'eye-outer-r',
      'eye-outer-l',
      'eye-upper-r',
      'eye-upper-l',
      'eye-lower-r',
      'eye-lower-l',
      'nose-bridge',
      'nose-tip',
      'nose-wing-r',
      'nose-wing-l',
      'mouth-corner-r',
      'mouth-corner-l',
      'lip-upper',
      'lip-lower',
      'cheek-r',
      'cheek-l',
      'cheekbone-r',
      'cheekbone-l',
      'jaw-r',
      'jaw-l',
      'chin',
      'ear-r',
      'ear-l',
    ])
    for (const handle of FACE_HANDLES) {
      expect(FACE_HANDLE[handle.id]).toBe(handle)
      expect(handle.label.length).toBeGreaterThan(0)
    }
  })

  test('sit on face points, never an iris, and mirror as the points do', () => {
    for (const handle of FACE_HANDLES) {
      const mirror = FACE_HANDLE[handle.mirror ?? handle.id]
      expect(mirror.mirror ?? mirror.id).toBe(handle.id)
      expect(mirror.region).toBe(handle.region)
      expect(mirror.label).toBe(handle.label)
      if (handle.kind === 'ear') {
        expect(handle.side).toBe(handle.id === 'ear-r' ? -1 : 1)
        expect(handle.region).toBe('ears')
        continue
      }
      expect(FACE_POINT_INDICES).toContain(handle.landmark)
      expect(IRISES.has(handle.landmark)).toBe(false)
      expect(handle.radius).toBeGreaterThan(0)
      const partner = mirrorOf(handle.landmark)
      if (handle.mirror === null) {
        expect(partner).toBe(handle.landmark)
      } else {
        const other = landmarkOf(handle.mirror)
        expect(other.landmark).toBe(partner)
        expect(other.radius).toBe(handle.radius)
      }
    }
  })

  test('on the subject’s right are on the image’s left, on every character', () => {
    for (const [id, target] of Object.entries(REAL)) {
      const points = unpackPoints(target)
      for (const handle of FACE_HANDLES) {
        if (handle.kind !== 'landmark' || !handle.id.endsWith('-r')) continue
        const right = points[facePointOf(handle.landmark)]![0]
        const left = points[facePointOf(landmarkOf(handle.mirror!).landmark)]![0]
        if (!(right < left)) throw new Error(`${id}: ${handle.id} is on the image's right`)
      }
    }
  })
})

describe('a landmark handle’s drag', () => {
  test('is a sculpt at the handle’s radius times the scale', () => {
    for (const id of ['nose-tip', 'jaw-r', 'eye-upper-l', 'forehead'] as const) {
      const handle = landmarkOf(id)
      for (const [radiusScale, symmetric] of [
        [1, true],
        [0.5, false],
        [2, true],
      ] as const) {
        const delta: FacePin = [0.006, -0.01, 0.008]
        const shape = applyFaceDrag(
          DEFAULT_FACE_SHAPE,
          drag(id, delta, { radiusScale, symmetric }),
          TARGET,
        )
        expect(shape.pins).toEqual(
          sculpt(
            {},
            handle.landmark,
            delta,
            { radius: handle.radius * radiusScale, falloff: 'smooth', symmetric },
            TARGET,
          ),
        )
        expect(shape.sliders).toEqual({})
        expect(shape.fit).toBe(DEFAULT_FACE_SHAPE.fit)
      }
    }
  })

  test('with symmetry pins the other side with the mirror image, on every character', () => {
    for (const id of CHARACTERS) {
      const target = REAL[id]!
      const shape = applyFaceDrag(
        DEFAULT_FACE_SHAPE,
        drag('cheekbone-r', [-0.012, -0.004, 0.015]),
        target,
      )
      expect(shape.pins[345]).toEqual([0.012, -0.004, 0.015])
      for (const landmark of SKIN) {
        const pin = shape.pins[landmark] ?? [0, 0, 0]
        const mirror = shape.pins[mirrorOf(landmark)] ?? [0, 0, 0]
        expect([pin[0] + 0, pin[1], pin[2]]).toEqual([-mirror[0] + 0, mirror[1], mirror[2]])
      }
      // On the middle a symmetric drag can't go sideways; without symmetry it can.
      const tip = applyFaceDrag(DEFAULT_FACE_SHAPE, drag('nose-tip', [0.01, 0, 0.01]), target)
      expect(tip.pins[4]).toEqual([0, 0, 0.01])
      const crooked = applyFaceDrag(
        DEFAULT_FACE_SHAPE,
        drag('nose-tip', [0.01, 0, 0.01], { symmetric: false }),
        target,
      )
      expect(crooked.pins[4]).toEqual([0.01, 0, 0.01])
    }
  })

  test('goes from the shape when grabbed, the whole way: never mutating it', () => {
    const start = applyFaceDrag(
      { fit: 0.7, sliders: { eyeSize: 0.3 }, pins: {} },
      drag('chin', [0, 0.01, 0]),
      TARGET,
    )
    const before = JSON.stringify(start)
    const once = applyFaceDrag(start, drag('mouth-corner-l', [0.004, -0.008, 0]), TARGET)
    const again = applyFaceDrag(start, drag('mouth-corner-l', [0.004, -0.008, 0]), TARGET)
    expect(again).toEqual(once)
    expect(JSON.stringify(start)).toBe(before)
    expect(once.sliders).toBe(start.sliders)
    expect(once.fit).toBe(0.7)
    // The chin's pins stay and the mouth's are added.
    expect(once.pins[152]).toEqual(start.pins[152])
    expect(once.pins[291]).toBeDefined()
  })

  test('that moves nothing gives the shape back', () => {
    const start = applyFaceDrag(DEFAULT_FACE_SHAPE, drag('lip-lower', [0, 0.01, 0.01]), TARGET)
    for (const handle of FACE_HANDLES) {
      expect(applyFaceDrag(start, drag(handle.id, [0, 0, 0]), TARGET)).toBe(start)
    }
  })

  test('is kept as saved, and loads back the same', () => {
    let shape: FaceShape = { fit: 0.5, sliders: { noseWidth: -0.3 }, pins: {} }
    shape = applyFaceDrag(shape, drag('nose-tip', [0, -0.01, 0.03]), TARGET)
    shape = applyFaceDrag(
      shape,
      drag('jaw-l', [-0.02, 0.003, 0], { symmetric: false, radiusScale: 1.5 }),
      TARGET,
    )
    shape = applyFaceDrag(shape, drag('ear-l', [0.01, -0.02, 0]), TARGET)
    expect(readFaceShape(JSON.parse(JSON.stringify(shape)))).toEqual(shape)
  })
})

describe('an ear handle’s drag', () => {
  test('raises both ears up the screen and turns them out away from the face', () => {
    const up = applyFaceDrag(DEFAULT_FACE_SHAPE, drag('ear-r', [0, -0.02, 0.05]), TARGET)
    expect(up.sliders).toEqual({ earHeight: 0.4 })
    expect(up.pins).toBe(DEFAULT_FACE_SHAPE.pins)
    // Out is the image's left for the subject's right ear, the right for the left.
    const outRight = applyFaceDrag(DEFAULT_FACE_SHAPE, drag('ear-r', [-0.01, 0, 0]), TARGET)
    const outLeft = applyFaceDrag(DEFAULT_FACE_SHAPE, drag('ear-l', [0.01, 0, 0]), TARGET)
    expect(outRight.sliders).toEqual({ earAngle: 0.2 })
    expect(outLeft.sliders).toEqual(outRight.sliders)
    const inLeft = applyFaceDrag(DEFAULT_FACE_SHAPE, drag('ear-l', [-0.01, 0.01, 0]), TARGET)
    expect(inLeft.sliders).toEqual({ earAngle: -0.2, earHeight: -0.2 })
  })

  test('keeps the sliders within their range, from where they were, and drops one back at 0', () => {
    const start: FaceShape = {
      fit: 1,
      sliders: { earHeight: 0.9, earAngle: 0.25, earSize: 0.4, eyeSize: 0.2 },
      pins: { 4: [0, 0, 0.01] },
    }
    const shape = applyFaceDrag(start, drag('ear-l', [-EAR_DRAG_UNIT / 4, -0.5, 0]), TARGET)
    expect(shape.sliders).toEqual({ earHeight: 1, earSize: 0.4, eyeSize: 0.2 })
    expect(shape.pins).toBe(start.pins)
    expect(applyFaceDrag(start, drag('ear-r', [1, 1, 0]), TARGET).sliders).toEqual({
      earHeight: -1,
      earAngle: -1,
      earSize: 0.4,
      eyeSize: 0.2,
    })
    expect(applyFaceDrag(start, drag('ear-r', [0, 0, 0.04]), TARGET)).toBe(start)
  })
})

const REGIONS: FaceRegion[] = ['face', 'eyes', 'brows', 'nose', 'mouth', 'ears']

describe('the face’s regions', () => {
  test('every handle’s landmark is in its handle’s region, on every character', () => {
    for (const target of Object.values(REAL)) {
      for (const handle of FACE_HANDLES) {
        if (handle.kind === 'landmark') {
          expect(faceRegionOf(handle.landmark, target)).toBe(handle.region)
        }
      }
    }
  })

  test('every point of skin is in one region (no landmark is the ears’), the features in their own', () => {
    const own: [readonly number[], FaceRegion][] = [
      [FACE_PARTS.brows, 'brows'],
      [FACE_PARTS.rightEye, 'eyes'],
      [FACE_PARTS.leftEye, 'eyes'],
      [FACE_PARTS.nose, 'nose'],
      [FACE_PARTS.lips, 'mouth'],
    ]
    for (const id of CHARACTERS) {
      const target = REAL[id]!
      for (const landmark of SKIN) {
        const region = faceRegionOf(landmark, target)
        expect(REGIONS.slice(0, 5)).toContain(region)
      }
      for (const [part, region] of own) {
        for (const i of part) expect(faceRegionOf(FACE_POINT_INDICES[i]!, target)).toBe(region)
      }
      // Where the lips meet is the mouth's too.
      for (const landmark of [13, 14, 78, 308]) expect(faceRegionOf(landmark, target)).toBe('mouth')
    }
  })

  /** A face changed everywhere: a slider of every region set, and a drag on every handle. */
  function everywhere(target: readonly number[]): FaceShape {
    const sliders = Object.fromEntries(FACE_SLIDERS.map(({ id }, k) => [id, k % 2 ? 0.3 : -0.2]))
    let shape: FaceShape = { fit: 0.6, sliders, pins: {} }
    for (const handle of FACE_HANDLES) {
      if (handle.kind === 'landmark') {
        shape = applyFaceDrag(shape, drag(handle.id, [0.002, -0.003, 0.004]), target)
      }
    }
    return shape
  }

  test('a region put back loses its sliders and its pins, and nothing else', () => {
    for (const id of ['Male_Adult_02', 'Female_Child_01']) {
      const target = REAL[id]!
      const shape = everywhere(target)
      const before = JSON.stringify(shape)
      for (const region of REGIONS) {
        expect(regionChanged(shape, region, target)).toBe(true)
        const reset = resetFaceRegion(shape, region, target)
        expect(regionChanged(reset, region, target)).toBe(false)
        expect(reset.fit).toBe(shape.fit)
        for (const { id: slider, group } of FACE_SLIDERS) {
          expect(reset.sliders[slider]).toBe(group === region ? undefined : shape.sliders[slider])
        }
        for (const [landmark, pin] of Object.entries(shape.pins)) {
          const kept = region === 'ears' || faceRegionOf(Number(landmark), target) !== region
          expect(reset.pins[landmark]).toEqual(kept ? pin : undefined)
        }
        for (const other of REGIONS) {
          if (other !== region) expect(regionChanged(reset, other, target)).toBe(true)
        }
      }
      expect(JSON.stringify(shape)).toBe(before)
    }
  })

  test('a region is changed by a slider or a pin of its own, not by another’s', () => {
    const nose = applyFaceDrag(
      DEFAULT_FACE_SHAPE,
      drag('nose-tip', [0, 0, 0.01], { radiusScale: 0.5 }),
      TARGET,
    )
    expect(regionChanged(nose, 'nose', TARGET)).toBe(true)
    expect(regionChanged(nose, 'eyes', TARGET)).toBe(false)
    expect(regionChanged(DEFAULT_FACE_SHAPE, 'nose', TARGET)).toBe(false)
    expect(
      regionChanged({ ...DEFAULT_FACE_SHAPE, sliders: { earPoint: 0.5 } }, 'ears', TARGET),
    ).toBe(true)
  })
})

/**
 * Over the face's front view, the least det(I + ∇d) of a field's move
 * across it: 0 or less where the skin folds over.
 */
function leastStretch(field: ShapeField): number {
  const out = [0, 0, 0]
  const right = [0, 0, 0]
  const below = [0, 0, 0]
  const h = 0.001
  let least = Number.POSITIVE_INFINITY
  for (let y = 0.2; y <= 0.95; y += 0.008) {
    for (let x = 0.15; x <= 0.85; x += 0.008) {
      field(x, y, out)
      field(x + h, y, right)
      field(x, y + h, below)
      const det =
        (1 + (right[0]! - out[0]!) / h) * (1 + (below[1]! - out[1]!) / h) -
        ((below[0]! - out[0]!) / h) * ((right[1]! - out[1]!) / h)
      least = Math.min(least, det)
    }
  }
  return least
}

describe('a sculpted face, on real characters', () => {
  /** Drags all over the face, and ones pulled as far as pins go. */
  const SCULPTS: [FaceHandleId, FacePin, Partial<FaceDrag>][][] = [
    [
      ['nose-tip', [0, 0, 0.03], {}],
      ['jaw-r', [0.02, -0.005, 0], {}],
      ['cheekbone-l', [0.015, 0, 0.01], {}],
      ['mouth-corner-r', [-0.006, -0.012, 0], {}],
      ['eye-outer-r', [-0.008, -0.006, 0], {}],
      ['brow-mid-l', [0, -0.02, 0], {}],
      ['chin', [0, 0.02, 0.01], {}],
      ['eye-upper-l', [0, -0.01, 0], {}],
      ['lip-lower', [0, 0.008, 0.01], {}],
      ['forehead', [0, 0, 0.02], {}],
    ],
    [
      ['nose-tip', [0, -0.05, 0.2], { radiusScale: 2 }],
      ['jaw-l', [-0.2, 0, 0], { radiusScale: 2 }],
      ['mouth-corner-l', [0.05, -0.05, 0], { symmetric: false, radiusScale: 0.5 }],
      ['brow-inner-r', [0.05, -0.08, 0], { radiusScale: 2 }],
      ['cheek-r', [0.08, 0, -0.05], {}],
    ],
  ]
  /** Sliders set across the face, both ways. */
  const SLIDERS: FaceShape['sliders'][] = [
    {},
    { faceWidth: 0.5, jawWidth: -0.5, eyeSize: 0.5, noseLength: 0.4, mouthWidth: -0.5 },
    { faceLength: -0.5, chinLength: 0.5, eyeOpen: -0.5, browHeight: 0.5, lipFullness: 0.5 },
  ]

  test('never folds the skin over, sliders set or not', () => {
    for (const id of CHARACTERS) {
      const target = REAL[id]!
      for (const sculpted of SCULPTS) {
        const pins = sculpted.reduce(
          (shape, [handle, delta, more]) => applyFaceDrag(shape, drag(handle, delta, more), target),
          DEFAULT_FACE_SHAPE,
        ).pins
        for (const sliders of SLIDERS) {
          const least = leastStretch(faceShapeField(target, { fit: 1, sliders, pins }, null)!)
          if (!(least > 0.1)) throw new Error(`${id}: folds (${least.toFixed(3)})`)
        }
      }
    }
  }, 30_000)
})
