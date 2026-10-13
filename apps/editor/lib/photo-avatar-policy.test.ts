import { describe, expect, test } from 'bun:test'
import { photoAvatarStatus, readPhotoAvatarStatus } from './photo-avatar-policy'

describe('photo avatar policy', () => {
  test('in production, real people’s photos are off unless the owner turns them on', () => {
    const production = { NODE_ENV: 'production' }
    expect(photoAvatarStatus(production)).toEqual({ faceAllowed: false })
    expect(photoAvatarStatus({ ...production, PHOTO_AVATAR_FACE_ENABLED: 'false' })).toEqual({
      faceAllowed: false,
    })
    expect(photoAvatarStatus({ ...production, PHOTO_AVATAR_FACE_ENABLED: '1' })).toEqual({
      faceAllowed: false,
    })
    expect(photoAvatarStatus({ ...production, PHOTO_AVATAR_FACE_ENABLED: ' true ' })).toEqual({
      faceAllowed: true,
    })
  })

  test('a development build has them on, unless the owner says false', () => {
    const development = { NODE_ENV: 'development' }
    expect(photoAvatarStatus(development)).toEqual({ faceAllowed: true })
    expect(photoAvatarStatus({ ...development, PHOTO_AVATAR_FACE_ENABLED: 'false' })).toEqual({
      faceAllowed: false,
    })
  })

  test('anything else (a test run, no NODE_ENV) is off', () => {
    expect(photoAvatarStatus({})).toEqual({ faceAllowed: false })
    expect(photoAvatarStatus({ NODE_ENV: 'test' })).toEqual({ faceAllowed: false })
  })

  test('the browser reads anything unexpected as off', () => {
    expect(readPhotoAvatarStatus({ faceAllowed: true })).toEqual({ faceAllowed: true })
    for (const odd of [null, undefined, 'true', { faceAllowed: 'true' }, { faceAllowed: 1 }]) {
      expect(readPhotoAvatarStatus(odd)).toEqual({ faceAllowed: false })
    }
  })
})
