import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  DEFAULT_EMOTE_KEYS,
  type EmoteCue,
  type EmoteId,
  isEmoteId,
} from '../components/editor/first-person/emotes'
import { isFacePoints } from '../components/editor/first-person/face-points'

/**
 * The player's face, swapped onto their character's: the face cropped from
 * their photo (a JPEG data URL) with its landmarks (FACE_POINT_INDICES, x/y
 * fractions of the crop, flattened). Any character's face is then warped
 * onto from them. `blend` (0–1) is how seamlessly its colours flow into the
 * skin around it, `light` (0–1) how much of the photo's own shading is
 * evened out, and `eyes` the iris colour taken from the photo (null keeps
 * the character's).
 */
export type AvatarFace = {
  photo: string
  points: number[]
  blend: number
  light: number
  eyes: string | null
}

const HEX = /^#[0-9a-f]{6}$/i
const unit = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback

/** A face as saved or received, or null when it isn't one (an older or broken save). */
export function readAvatarFace(value: unknown): AvatarFace | null {
  const face = value as Partial<AvatarFace> | null
  if (
    !face ||
    typeof face.photo !== 'string' ||
    !face.photo.startsWith('data:image/') ||
    !isFacePoints(face.points)
  ) {
    return null
  }
  return {
    photo: face.photo,
    points: face.points,
    blend: unit(face.blend, DEFAULT_FACE_BLEND),
    light: unit(face.light, DEFAULT_FACE_LIGHT),
    eyes: typeof face.eyes === 'string' && HEX.test(face.eyes) ? face.eyes : null,
  }
}

export const DEFAULT_FACE_BLEND = 1
export const DEFAULT_FACE_LIGHT = 0.5

/** The player's changes to their character: hair and skin dyes (hex) and a face photo. */
export type AvatarLook = {
  hair: string | null
  skin: string | null
  face: AvatarFace | null
}

export const NO_LOOK: AvatarLook = { hair: null, skin: null, face: null }

export const hasLook = (look: AvatarLook | null | undefined): look is AvatarLook =>
  Boolean(look && (look.hair || look.skin || look.face))

type AvatarProfileState = {
  look: AvatarLook
  /** Emote keys, by `KeyboardEvent.code`. */
  keys: Record<string, EmoteId>
  setLook: (look: AvatarLook) => void
  setKeys: (keys: Record<string, EmoteId>) => void
}

/** The player's own character setup, kept in this browser (the body itself is useWalkthroughView's). */
const useAvatarProfile = create<AvatarProfileState>()(
  persist(
    (set) => ({
      look: NO_LOOK,
      keys: DEFAULT_EMOTE_KEYS,
      setLook: (look) => set({ look }),
      setKeys: (keys) => set({ keys }),
    }),
    {
      name: 'mmm-avatar-profile',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AvatarProfileState>
        const keys = Object.fromEntries(
          Object.entries(saved.keys ?? current.keys).filter(([, emote]) => isEmoteId(emote)),
        ) as Record<string, EmoteId>
        const look = { ...NO_LOOK, ...saved.look }
        return { ...current, look: { ...look, face: readAvatarFace(look.face) }, keys }
      },
    },
  ),
)

/**
 * The emote the player's body is playing, and when it started (ms since the
 * epoch, so another player's machine can tell a replay from the same one).
 */
export const useAvatarEmote = create<{
  emote: EmoteCue | null
  play: (id: EmoteId) => void
  stop: () => void
}>((set) => ({
  emote: null,
  play: (id) => set({ emote: { id, at: Date.now() } }),
  stop: () => set({ emote: null }),
}))

export default useAvatarProfile
