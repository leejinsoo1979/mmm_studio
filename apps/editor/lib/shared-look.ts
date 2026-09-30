import { type AvatarFace, type AvatarLook, readAvatarFace } from '@pascal-app/editor'

/**
 * What a participant document carries of its player's look: the dyes and
 * the face's settings. The photo and its landmarks (tens of kB, and the
 * same for as long as the face is) live in their own document,
 * `faces/{uid}`, fetched once per `photoId` rather than with every pose
 * report.
 */
export type SharedLook = {
  hair: string | null
  skin: string | null
  face: (Omit<AvatarFace, 'photo' | 'points'> & { photoId: string }) | null
}

/** What `faces/{uid}` holds: the photo and its landmarks, under the version the looks name. */
export type SharedFace = Pick<AvatarFace, 'photo' | 'points'>

/** A short fingerprint of a face (FNV-1a over its photo and landmarks), naming its version in faces/{uid}. */
export function photoId({ photo, points }: SharedFace): string {
  const text = `${photo}|${points.join(',')}`
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(16)}-${text.length}`
}

export function toSharedLook(look: AvatarLook): SharedLook {
  if (!look.face) return { hair: look.hair, skin: look.skin, face: null }
  const { photo, points, ...settings } = look.face
  return {
    hair: look.hair,
    skin: look.skin,
    face: { ...settings, photoId: photoId({ photo, points }) },
  }
}

const HEX = /^#[0-9a-f]{6}$/i
const hex = (value: unknown) => (typeof value === 'string' && HEX.test(value) ? value : null)

/**
 * Another player's look from their participant document, with their face
 * (photo and landmarks) once it has been fetched (until then, the look
 * without the face).
 */
export function fromSharedLook(value: unknown, face: SharedFace | null): AvatarLook | null {
  if (!value || typeof value !== 'object') return null
  const shared = value as Partial<SharedLook>
  const look: AvatarLook = {
    hair: hex(shared.hair),
    skin: hex(shared.skin),
    face: shared.face && face ? readAvatarFace({ ...shared.face, ...face }) : null,
  }
  return look.hair || look.skin || look.face ? look : null
}

/** The photo version a shared look wants, if any. */
export const wantedPhotoId = (value: unknown): string | null => {
  const face = (value as Partial<SharedLook> | null)?.face
  return face && typeof face.photoId === 'string' ? face.photoId : null
}
