import { describe, expect, test } from 'bun:test'
import { photoAvatarStatus, readPhotoAvatarStatus } from './photo-avatar-policy'

describe('photo avatar policy', () => {
  test('real people’s photos are off unless the owner turns them on', () => {
    expect(photoAvatarStatus({})).toEqual({ faceAllowed: false })
    expect(photoAvatarStatus({ PHOTO_AVATAR_FACE_ENABLED: 'false' })).toEqual({
      faceAllowed: false,
    })
    expect(photoAvatarStatus({ PHOTO_AVATAR_FACE_ENABLED: '1' })).toEqual({ faceAllowed: false })
    expect(photoAvatarStatus({ PHOTO_AVATAR_FACE_ENABLED: ' true ' })).toEqual({
      faceAllowed: true,
    })
  })

  test('the browser reads anything unexpected as off', () => {
    expect(readPhotoAvatarStatus({ faceAllowed: true })).toEqual({ faceAllowed: true })
    for (const odd of [null, undefined, 'true', { faceAllowed: 'true' }, { faceAllowed: 1 }]) {
      expect(readPhotoAvatarStatus(odd)).toEqual({ faceAllowed: false })
    }
  })
})
