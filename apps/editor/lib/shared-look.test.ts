import { describe, expect, test } from 'bun:test'
import { fromSharedLook, photoId, toSharedLook, wantedPhotoId } from './shared-look'

const photo = 'data:image/jpeg;base64,AAAA'
const look = {
  hair: '#A0522D',
  skin: null,
  face: { photo, x: 0.5, y: 0.55, scale: 0.6, rotation: 0.1, tone: 0.4 },
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
