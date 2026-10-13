/**
 * Whether players may make a photo avatar from a real person's photos (a
 * 3D 얼굴 촬영 or 내 사진 한 장). The photos never leave the browser, but
 * nothing proves the face is the player's own, consented, or an adult's, so
 * like AI 실사 사진's face photos it is off unless the owner turns it on:
 * `PHOTO_AVATAR_FACE_ENABLED=true` (the server's environment, read per
 * request). An avatar from an AI-made fictional face needs no switch.
 */

export type PhotoAvatarStatus = {
  /** Real people's photos may be used (with the player's consent each time). */
  faceAllowed: boolean
}

type Env = Record<string, string | undefined>

export function photoAvatarStatus(env: Env = process.env): PhotoAvatarStatus {
  return { faceAllowed: env.PHOTO_AVATAR_FACE_ENABLED?.trim() === 'true' }
}

/** A status answer as the browser reads it: anything unexpected is off. */
export function readPhotoAvatarStatus(value: unknown): PhotoAvatarStatus {
  return { faceAllowed: (value as Partial<PhotoAvatarStatus> | null)?.faceAllowed === true }
}
