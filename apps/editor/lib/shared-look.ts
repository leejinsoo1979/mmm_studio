import type { AvatarFace, AvatarLook } from '@pascal-app/editor'

/**
 * What a participant document carries of its player's look: the dyes and
 * where the face photo sits. The photo itself (tens of kB) lives in its own
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
  const { photo, ...placement } = look.face
  return { hair: look.hair, skin: look.skin, face: { ...placement, photoId: photoId(photo) } }
}

const HEX = /^#[0-9a-f]{6}$/i
const hex = (value: unknown) => (typeof value === 'string' && HEX.test(value) ? value : null)
const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * Another player's look from their participant document, with their face
 * photo once it has been fetched (until then, the look without the face).
 */
export function fromSharedLook(value: unknown, photo: string | null): AvatarLook | null {
  if (!value || typeof value !== 'object') return null
  const shared = value as Partial<SharedLook>
  const face = shared.face
  const look: AvatarLook = {
    hair: hex(shared.hair),
    skin: hex(shared.skin),
    face:
      face && photo && typeof photo === 'string' && photo.startsWith('data:image/')
        ? {
            photo,
            x: finite(face.x, 0.5),
            y: finite(face.y, 0.5),
            scale: Math.min(4, Math.max(0.05, finite(face.scale, 1))),
            rotation: finite(face.rotation, 0),
            tone: Math.min(1, Math.max(0, finite(face.tone, 0.5))),
          }
        : null,
  }
  return look.hair || look.skin || look.face ? look : null
}

/** The photo version a shared look wants, if any. */
export const wantedPhotoId = (value: unknown): string | null => {
  const face = (value as Partial<SharedLook> | null)?.face
  return face && typeof face.photoId === 'string' ? face.photoId : null
}
