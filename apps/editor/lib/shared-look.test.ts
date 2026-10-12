import { describe, expect, test } from 'bun:test'
import {
  FACE_PARTS,
  FACE_POINT_COUNT,
  FACE_POINT_INDICES,
  type FacePin,
  MAX_PIN,
  NO_LOOK,
  NO_PAINT,
} from '@pascal-app/editor'
import {
  fromSharedLook,
  MAX_SHARED_LOOK,
  photoId,
  toSharedLook,
  wantedPhotoId,
} from './shared-look'

const photo = 'data:image/jpeg;base64,AAAA'
const points = Array.from({ length: FACE_POINT_COUNT * 2 }, (_, i) => (i % 97) / 100)
const look = {
  ...NO_LOOK,
  hair: '#A0522D',
  skin: null,
  face: { photo, points, blend: 0.9, light: 0.4, eyes: '#5A3B22' },
  shape: {
    fit: 0.6,
    sliders: { eyeSize: 0.4, jawWidth: -0.25 },
    pins: { 4: [0, -0.004, 0.012], 61: [-0.003, -0.006, 0], 291: [0.003, -0.006, 0] } as Record<
      string,
      FacePin
    >,
  },
  body: { height: 0.3, sliders: { shoulders: 0.5 } },
  hairStyle: 'Female_Adult_04',
  paint: { ...NO_PAINT, lips: '#c0404a', beard: 'stubble' as const },
}

describe('a look shared through the participant document', () => {
  test('leaves the photo and its landmarks out, naming them instead', () => {
    const shared = toSharedLook(look)
    const text = JSON.stringify(shared)
    expect(text).not.toContain(photo)
    expect(text).not.toContain('points')
    expect(shared.face?.photoId).toBe(photoId({ photo, points }))
    expect(wantedPhotoId(shared)).toBe(photoId({ photo, points }))
  })

  test('comes back whole once the face is fetched, and without the face before', () => {
    const shared = JSON.parse(JSON.stringify(toSharedLook(look)))
    expect(fromSharedLook(shared, { photo, points })).toEqual(look)
    expect(fromSharedLook(shared, null)).toEqual({ ...look, face: null })
  })

  test('another photo, or the same photo placed again, gets another id', () => {
    expect(photoId({ photo, points })).not.toBe(photoId({ photo: `${photo}B`, points }))
    const moved = points.map((value, i) => (i === 0 ? value + 0.01 : value))
    expect(photoId({ photo, points })).not.toBe(photoId({ photo, points: moved }))
  })

  test('a face shaped by sliders alone is a look; a broken shape is none', () => {
    const shaped = {
      ...NO_LOOK,
      shape: { fit: 1, sliders: { noseWidth: 0.5 }, pins: {} },
    }
    expect(fromSharedLook(JSON.parse(JSON.stringify(toSharedLook(shaped))), null)).toEqual(shaped)
    expect(
      fromSharedLook(
        { hair: null, skin: null, face: null, shape: { sliders: { noseWidth: 'x' } } },
        null,
      ),
    ).toBeNull()
  })

  test('carries the sculpted face’s pins, and pins alone are a look', () => {
    const shared = JSON.parse(JSON.stringify(toSharedLook(look)))
    expect(shared.shape.pins).toEqual(look.shape.pins)
    const pinned = {
      ...NO_LOOK,
      shape: { ...NO_LOOK.shape, pins: { 152: [0, 0.01, 0.004] as FacePin } },
    }
    expect(fromSharedLook(JSON.parse(JSON.stringify(toSharedLook(pinned))), null)).toEqual(pinned)
    // An iris or a landmark that isn't a face point pins nothing.
    expect(
      fromSharedLook(
        { ...NO_LOOK, shape: { fit: 1, sliders: {}, pins: { 468: [0, 0, 0.01] } } },
        null,
      ),
    ).toBeNull()
  })

  test('at its largest, every point of skin pinned, still travels; anything bigger is no look', () => {
    const irises = new Set(
      [...FACE_PARTS.rightIris, ...FACE_PARTS.leftIris].map((i) => FACE_POINT_INDICES[i]!),
    )
    // As far as a pin goes, every way, to the 1/10000 pins are kept to.
    const far = -0.0692
    expect(Math.hypot(far, far, far)).toBeLessThanOrEqual(MAX_PIN)
    const pins = Object.fromEntries(
      FACE_POINT_INDICES.filter((landmark) => !irises.has(landmark)).map((landmark) => [
        landmark,
        [far, far, far] as FacePin,
      ]),
    )
    const largest = { ...look, shape: { ...look.shape, pins } }
    const shared = JSON.parse(JSON.stringify(toSharedLook(largest)))
    expect(JSON.stringify(shared).length).toBeLessThan(12 * 1024)
    expect(fromSharedLook(shared, { photo, points })).toEqual(largest)
    const stuffed = { ...shared, padding: 'x'.repeat(MAX_SHARED_LOOK) }
    expect(fromSharedLook(stuffed, { photo, points })).toBeNull()
  })

  test('a build, a hairstyle or face paint alone is a look', () => {
    for (const change of [
      { body: { height: -0.4, sliders: {} } },
      { hairStyle: 'bald' },
      { paint: { ...NO_PAINT, freckles: 0.5 } },
    ]) {
      const changed = { ...NO_LOOK, ...change }
      expect(fromSharedLook(JSON.parse(JSON.stringify(toSharedLook(changed))), null)).toEqual(
        changed,
      )
    }
    // Someone else's idea of a hairstyle: none.
    expect(fromSharedLook({ ...NO_LOOK, hairStyle: '../evil' }, null)).toBeNull()
  })

  test('nothing usable in it: no look', () => {
    expect(fromSharedLook({ hair: 'red', skin: 42, face: null }, null)).toBeNull()
    expect(fromSharedLook(null, null)).toBeNull()
    expect(
      fromSharedLook(
        { hair: null, skin: null, face: { photoId: 'x' } },
        { photo: 'https://x', points },
      ),
    ).toBeNull()
  })
})
