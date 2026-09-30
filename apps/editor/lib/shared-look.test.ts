import { describe, expect, test } from 'bun:test'
import { FACE_POINT_COUNT } from '@pascal-app/editor'
import { fromSharedLook, photoId, toSharedLook, wantedPhotoId } from './shared-look'

const photo = 'data:image/jpeg;base64,AAAA'
const points = Array.from({ length: FACE_POINT_COUNT * 2 }, (_, i) => (i % 97) / 100)
const look = {
  hair: '#A0522D',
  skin: null,
  face: { photo, points, blend: 0.9, light: 0.4, eyes: '#5A3B22' },
}

describe('a look shared through the participant document', () => {
  test('leaves the photo out, naming it instead', () => {
    const shared = toSharedLook(look)
    expect(JSON.stringify(shared)).not.toContain(photo)
    expect(shared.face?.photoId).toBe(photoId(photo))
    expect(wantedPhotoId(shared)).toBe(photoId(photo))
  })

  test('comes back whole once the photo is fetched, and without the face before', () => {
    const shared = JSON.parse(JSON.stringify(toSharedLook(look)))
    expect(fromSharedLook(shared, photo)).toEqual(look)
    expect(fromSharedLook(shared, null)).toEqual({ ...look, face: null })
  })

  test('another version of the photo gets another id', () => {
    expect(photoId(photo)).not.toBe(photoId(`${photo}B`))
  })

  test('nothing usable in it: no look', () => {
    expect(fromSharedLook({ hair: 'red', skin: 42, face: null }, null)).toBeNull()
    expect(fromSharedLook(null, null)).toBeNull()
    expect(
      fromSharedLook({ hair: null, skin: null, face: { photoId: 'x' } }, 'https://x'),
    ).toBeNull()
  })
})
