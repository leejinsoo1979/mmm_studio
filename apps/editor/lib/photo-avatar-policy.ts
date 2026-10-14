/**
 * Whether players may make a photo avatar from a real person's photos (a
 * 3D 얼굴 촬영, uploaded photos or 내 사진 한 장). The photos never leave the
 * browser, but nothing proves the face is the player's own, consented, or an
 * adult's: the player says so every time (the dialog's notice and
 * checkbox), and the owner decides whether the feature is on at all.
 *
 * On in a development build (`bun dev`), where the owner tries it on their
 * own face; off in production unless the server's environment says
 * `PHOTO_AVATAR_FACE_ENABLED=true` (read per request). `false` turns it off
 * in development too.
 *
 * Unlike AI 실사 사진's face photos, this asks for no sign-in and no
 * server-side record of an 18+ attestation and consent: no photo, and
 * nothing made from one, reaches the server, so there is nothing there to
 * attach a record to. Adults-only rests on the player's word. An owner who
 * turns it on in production takes that on; if accounts must carry an 18+
 * attestation first, keep it off until they do.
 *
 * An avatar from an AI-made fictional face needs no switch here.
 */

export type PhotoAvatarStatus = {
  /** Real people's photos may be used (with the player's consent each time). */
  faceAllowed: boolean
}

type Env = Record<string, string | undefined>

export function photoAvatarStatus(env: Env = process.env): PhotoAvatarStatus {
  const setting = env.PHOTO_AVATAR_FACE_ENABLED?.trim()
  if (setting === 'true') return { faceAllowed: true }
  if (setting === 'false') return { faceAllowed: false }
  return { faceAllowed: env.NODE_ENV === 'development' }
}

/** A status answer as the browser reads it: anything unexpected is off. */
export function readPhotoAvatarStatus(value: unknown): PhotoAvatarStatus {
  return { faceAllowed: (value as Partial<PhotoAvatarStatus> | null)?.faceAllowed === true }
}
