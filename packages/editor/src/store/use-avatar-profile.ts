import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  type BodyShape,
  DEFAULT_BODY_SHAPE,
  hasBodyShape,
  readBodyShape,
} from '../components/editor/first-person/body-shape'
import {
  DEFAULT_EMOTE_KEYS,
  type EmoteCue,
  type EmoteId,
  isEmoteId,
} from '../components/editor/first-person/emotes'
import {
  type FacePaint,
  hasFacePaint,
  NO_PAINT,
  readFacePaint,
} from '../components/editor/first-person/face-paint'
import { isFacePoints } from '../components/editor/first-person/face-points'
import {
  DEFAULT_FACE_SHAPE,
  type FaceShape,
  hasFaceShape,
  readFaceShape,
} from '../components/editor/first-person/face-shape'
import { type AvatarFeet, readAvatarFeet, SHOD } from '../components/editor/first-person/footwear'
import { type HairStyle, readHairStyle } from '../components/editor/first-person/hair-styles'

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
/** The pictures a face photo may be (what the studio makes, and nothing a browser might choke on, like SVG). */
const PHOTO = /^data:image\/(jpeg|png|webp);base64,/
const unit = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback

/** A face as saved or received, or null when it isn't one (an older or broken save). */
export function readAvatarFace(value: unknown): AvatarFace | null {
  const face = value as Partial<AvatarFace> | null
  if (
    !face ||
    typeof face.photo !== 'string' ||
    !PHOTO.test(face.photo) ||
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

/** How much a shaved head's stubble has grown back unless the player says (see scalp-paint.ts's `shavedShade`): a light shadow. */
export const DEFAULT_SHAVE = 0.35

/**
 * The player's changes to their character: hair and skin dyes (hex), a face
 * photo, the face's shape (the photo's proportions, the sliders, the
 * sculpted pins), the build, the hairstyle and how much a shaved head's
 * stubble has grown back (0–1), and what is painted on the face.
 */
export type AvatarLook = {
  hair: string | null
  skin: string | null
  face: AvatarFace | null
  shape: FaceShape
  body: BodyShape
  hairStyle: HairStyle
  shave: number
  paint: FacePaint
  feet: AvatarFeet
}

export const NO_LOOK: AvatarLook = {
  hair: null,
  skin: null,
  face: null,
  shape: DEFAULT_FACE_SHAPE,
  body: DEFAULT_BODY_SHAPE,
  hairStyle: null,
  shave: DEFAULT_SHAVE,
  paint: NO_PAINT,
  feet: SHOD,
}

/** A look as saved or received, every part of it checked (an older save gets defaults). */
export function readAvatarLook(value: unknown): AvatarLook {
  const look = (value ?? {}) as Partial<AvatarLook>
  const hex = (color: unknown) => (typeof color === 'string' && HEX.test(color) ? color : null)
  return {
    hair: hex(look.hair),
    skin: hex(look.skin),
    face: readAvatarFace(look.face),
    shape: readFaceShape(look.shape),
    body: readBodyShape(look.body),
    hairStyle: readHairStyle(look.hairStyle),
    shave: unit(look.shave, DEFAULT_SHAVE),
    paint: readFacePaint(look.paint),
    feet: readAvatarFeet(look.feet),
  }
}

/**
 * What of a look is painted on the character's textures (the shapes are the
 * geometry's, a borrowed hairstyle its own mesh): the dyes, the face photo,
 * the face paint, and a shaved head and its stubble.
 */
export type AvatarPaint = Pick<
  AvatarLook,
  'hair' | 'skin' | 'face' | 'paint' | 'feet' | 'shave'
> & {
  bald: boolean
}

export const paintOf = (look: AvatarLook): AvatarPaint => ({
  hair: look.hair,
  skin: look.skin,
  face: look.face,
  paint: look.paint,
  feet: look.feet,
  shave: look.shave,
  // Any hairstyle but the character's own makes the head bald, its skin
  // painted round where its own hair was taken out.
  bald: look.hairStyle !== null,
})

/** Whether a look changes the character's textures. */
export const hasLook = (look: AvatarPaint | null | undefined): look is AvatarPaint =>
  Boolean(
    look &&
      (look.hair ||
        look.skin ||
        look.face ||
        look.bald ||
        hasFacePaint(look.paint) ||
        look.feet.wear !== 'shoes'),
  )

/** Whether a look changes the character at all. */
export const changesCharacter = (look: AvatarLook) =>
  hasLook(paintOf(look)) ||
  hasFaceShape(look.shape) ||
  hasBodyShape(look.body) ||
  look.hairStyle !== null

/** The longest name a player gives their character (in characters). */
export const MAX_CHARACTER_NAME = 16

/** A character's name as kept: trimmed, at most MAX_CHARACTER_NAME long ('' when it isn't one). */
export const readCharacterName = (value: unknown): string =>
  typeof value === 'string'
    ? Array.from(value.trim()).slice(0, MAX_CHARACTER_NAME).join('').trim()
    : ''

type AvatarProfileState = {
  look: AvatarLook
  /** Emote keys, by `KeyboardEvent.code`. */
  keys: Record<string, EmoteId>
  /** What the player calls their character ('' for none). */
  name: string
  setLook: (look: AvatarLook) => void
  setKeys: (keys: Record<string, EmoteId>) => void
  setName: (name: string) => void
}

/** The player's own character setup, kept in this browser (the body itself is useWalkthroughView's). */
const useAvatarProfile = create<AvatarProfileState>()(
  persist(
    (set) => ({
      look: NO_LOOK,
      keys: DEFAULT_EMOTE_KEYS,
      name: '',
      setLook: (look) => set({ look }),
      setKeys: (keys) => set({ keys }),
      setName: (name) => set({ name: readCharacterName(name) }),
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
        return {
          ...current,
          look: readAvatarLook(saved.look),
          keys,
          name: readCharacterName(saved.name),
        }
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
