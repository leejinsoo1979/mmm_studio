import { isChildAvatar } from '../schema'

/** A speech-synthesis voice as the browser lists it. */
export type NpcVoiceOption = { name: string; lang: string }

/** Korean voice names by the gender they speak with (Windows/Edge, macOS/iOS, Chrome). */
const FEMALE_VOICES = ['heami', 'sunhi', 'yuna', 'jimin', 'seohyeon', 'google 한국의']
const MALE_VOICES = ['injoon', 'hyunsu', 'bongjin', 'gookmin']
/** Neural and downloadable voices sound far better than the old desktop ones. */
const NATURAL = /natural|online|neural|enhanced|premium/i

/** Adult male, adult female and child speaking pitch, before the NPC's own `voice.pitch`. */
const PITCH = { male: 0.9, female: 1.05, child: 1.35 }
/** The top of `SpeechSynthesisUtterance.pitch`. */
const PITCH_MAX = 2

/** Chrome's online voices stop a long utterance after about 15 s, so lines go sentence by
 *  sentence, and a sentence longer than this is cut at a space. */
const CHUNK_MAX = 90

type Gender = 'female' | 'male'

const genderOf = (avatarId: string): Gender | null =>
  avatarId.includes('Female') ? 'female' : avatarId.includes('Male') ? 'male' : null

function voiceGender(voice: NpcVoiceOption): Gender | null {
  const name = voice.name.toLowerCase()
  if (FEMALE_VOICES.some((known) => name.includes(known))) return 'female'
  if (MALE_VOICES.some((known) => name.includes(known))) return 'male'
  return null
}

/** Speaks Korean (`ko-KR`, Android's `ko_KR`, or plain `ko`). */
export const isKoreanVoice = (voice: NpcVoiceOption) => /^ko(?:[-_]|$)/i.test(voice.lang)

/**
 * The voice an avatar speaks with. `preferred` is the NPC's `voice.voice`: a
 * voice name wins when this browser has it; otherwise ('auto', or a voice from
 * another browser) the best Korean voice is chosen: the avatar's gender first,
 * then a natural-sounding one, then the list order. Null when no voice speaks
 * Korean: the browser then picks one by `lang`.
 */
export function pickNpcVoice<V extends NpcVoiceOption>(
  voices: readonly V[],
  avatarId: string,
  preferred: string,
): V | null {
  if (preferred !== 'auto') {
    const named = voices.find((voice) => voice.name === preferred)
    if (named) return named
  }
  const gender = genderOf(avatarId)
  let best: V | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const voice of voices) {
    if (!isKoreanVoice(voice)) continue
    const spoken = voiceGender(voice)
    const score =
      (gender && spoken ? (spoken === gender ? 4 : -4) : 0) + (NATURAL.test(voice.name) ? 2 : 0)
    if (score > bestScore) {
      best = voice
      bestScore = score
    }
  }
  return best
}

/** The avatar's speaking pitch (adult male, adult female, child) times the NPC's `voice.pitch`. */
export function npcVoicePitch(avatarId: string, pitch: number): number {
  const gender = genderOf(avatarId)
  const base = isChildAvatar(avatarId) ? PITCH.child : gender ? PITCH[gender] : 1
  return Math.min(PITCH_MAX, base * pitch)
}

/** A line as the browser voice says it: sentence by sentence, none longer than `max`. */
export function speechChunks(text: string, max = CHUNK_MAX): string[] {
  const chunks: string[] = []
  // A sentence ends at . ! ? … ~ before a space, so "32.1㎡" stays whole.
  for (const sentence of text.replace(/([.!?…~])\s+/g, '$1\n').split('\n')) {
    let rest = sentence.trim()
    while (rest.length > max) {
      const space = rest.lastIndexOf(' ', max)
      const cut = space > max / 2 ? space : max
      chunks.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) chunks.push(rest)
  }
  return chunks
}
