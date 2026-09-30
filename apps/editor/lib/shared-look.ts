import { type AvatarFace, type AvatarLook, readAvatarFace } from '@pascal-app/editor'

/**
 * What a participant document carries of its player's look: the dyes and
 * the face's landmarks and settings. The photo itself (tens of kB) lives in its own
 * document, `faces/{uid}`, fetched once per `photoId` rather than with every
 * pose report.
 */
export type SharedLook = {
  hair: string | null
  skin: string | null
  face: (Omit<AvatarFace, 'photo'> & { photoId: string }) | null
}

/** A short fingerprint of a photo (FNV-1a), naming the version in faces/{uid}. */
export function photoId(photo: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < photo.length; i++) {
    hash ^= photo.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(16)}-${photo.length}`
}

export function toSharedLook(look: AvatarLook): SharedLook {
  if (!look.face) return { hair: look.hair, skin: look.skin, face: null }
  const { photo, ...settings } = look.face
  return { hair: look.hair, skin: look.skin, face: { ...settings, photoId: photoId(photo) } }
}

const HEX = /^#[0-9a-f]{6}$/i
const hex = (value: unknown) => (typeof value === 'string' && HEX.test(value) ? value : null)

/**
 * Another player's look from their participant document, with their face
 * photo once it has been fetched (until then, the look without the face).
 */
export function fromSharedLook(value: unknown, photo: string | null): AvatarLook | null {
  if (!value || typeof value !== 'object') return null
  const shared = value as Partial<SharedLook>
  const look: AvatarLook = {
    hair: hex(shared.hair),
    skin: hex(shared.skin),
    face: shared.face && photo ? readAvatarFace({ ...shared.face, photo }) : null,
  }
  return look.hair || look.skin || look.face ? look : null
}

/** The photo version a shared look wants, if any. */
export const wantedPhotoId = (value: unknown): string | null => {
  const face = (value as Partial<SharedLook> | null)?.face
  return face && typeof face.photoId === 'string' ? face.photoId : null
}
