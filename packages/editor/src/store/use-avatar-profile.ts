import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  DEFAULT_EMOTE_KEYS,
  type EmoteCue,
  type EmoteId,
  isEmoteId,
} from '../components/editor/first-person/emotes'

/**
 * A photo of the player's face laid over their character's face: the photo
 * (a JPEG data URL), where it sits on the character's front view — its
 * centre (`x`, `y`) and width (`scale`) as fractions of that view, turned by
 * `rotation` (rad) — and how far (0–1) its colours move to the character's
 * skin so the edges blend.
 */
export type AvatarFace = {
  photo: string
  x: number
  y: number
  scale: number
  rotation: number
  tone: number
}

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
        return { ...current, look: { ...NO_LOOK, ...saved.look }, keys }
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
