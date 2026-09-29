import type { AvatarGender } from './avatar-catalog'

/**
 * What a player's body can do on a key: Microsoft Rocketbox motion capture
 * (MIT), played on the spot, baked onto both reference skeletons by
 * `scripts/characters/build-rocketbox-emotes.sh` (one clip per id).
 */
export const EMOTE_IDS = [
  'wave',
  'waveBig',
  'clap',
  'cheer',
  'hooray',
  'danceCool',
  'danceGroove',
  'danceSilly',
  'danceHard',
  'laugh',
  'shrug',
  'think',
  'present',
  'nod',
  'headShake',
  'talk',
  'angry',
  'sad',
  'stretch',
  'yawn',
  'lookAround',
  'scratchHead',
  'photo',
  'knock',
  'drink',
] as const
export type EmoteId = (typeof EMOTE_IDS)[number]

export type EmoteCategory = 'greet' | 'dance' | 'feel' | 'act'

export const EMOTE_CATEGORIES: { id: EmoteCategory; label: string }[] = [
  { id: 'greet', label: '인사' },
  { id: 'dance', label: '춤' },
  { id: 'feel', label: '감정' },
  { id: 'act', label: '행동' },
]

/**
 * `loop`: keeps going until the player moves (dances, a talk, a mood); else
 * plays once, cut to ONCE_MAX_SECONDS (some captures run on for half a minute).
 */
export type Emote = { id: EmoteId; label: string; category: EmoteCategory; loop: boolean }

export const EMOTES: Record<EmoteId, Emote> = {
  wave: { id: 'wave', label: '손 흔들기', category: 'greet', loop: false },
  waveBig: { id: 'waveBig', label: '크게 손 흔들기', category: 'greet', loop: false },
  clap: { id: 'clap', label: '박수', category: 'greet', loop: false },
  cheer: { id: 'cheer', label: '환호', category: 'greet', loop: false },
  hooray: { id: 'hooray', label: '만세', category: 'greet', loop: false },
  nod: { id: 'nod', label: '끄덕끄덕', category: 'greet', loop: false },
  headShake: { id: 'headShake', label: '절레절레', category: 'greet', loop: false },
  danceCool: { id: 'danceCool', label: '멋진 춤', category: 'dance', loop: true },
  danceGroove: { id: 'danceGroove', label: '리듬 타기', category: 'dance', loop: true },
  danceSilly: { id: 'danceSilly', label: '웃긴 춤', category: 'dance', loop: true },
  danceHard: { id: 'danceHard', label: '격한 춤', category: 'dance', loop: true },
  laugh: { id: 'laugh', label: '크게 웃기', category: 'feel', loop: false },
  shrug: { id: 'shrug', label: '으쓱', category: 'feel', loop: false },
  think: { id: 'think', label: '생각하기', category: 'feel', loop: true },
  angry: { id: 'angry', label: '화내기', category: 'feel', loop: true },
  sad: { id: 'sad', label: '슬퍼하기', category: 'feel', loop: true },
  yawn: { id: 'yawn', label: '하품', category: 'feel', loop: false },
  present: { id: 'present', label: '발표하기', category: 'act', loop: true },
  talk: { id: 'talk', label: '신나게 말하기', category: 'act', loop: true },
  stretch: { id: 'stretch', label: '기지개', category: 'act', loop: false },
  lookAround: { id: 'lookAround', label: '두리번', category: 'act', loop: false },
  scratchHead: { id: 'scratchHead', label: '머리 긁적', category: 'act', loop: false },
  photo: { id: 'photo', label: '사진 찍기', category: 'act', loop: false },
  knock: { id: 'knock', label: '노크', category: 'act', loop: false },
  drink: { id: 'drink', label: '마시기', category: 'act', loop: true },
}

export const ONCE_MAX_SECONDS = 8

/** An emote a body is asked to play: which, and when it was started (ms since the epoch). */
export type EmoteCue = { id: EmoteId; at: number }

export const isEmoteId = (id: unknown): id is EmoteId =>
  typeof id === 'string' && Object.hasOwn(EMOTES, id)

export const emoteClipsUrl = (gender: AvatarGender) => `/characters/rocketbox/emotes-${gender}.glb`

/** Keys the walkthrough (and its remote, projector and chat) already answer: no emote on them. */
const RESERVED_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyC',
  'KeyE',
  'KeyR',
  'KeyT',
  'KeyV',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'Escape',
  'Enter',
  'NumpadEnter',
  'Tab',
  'Backspace',
  'CapsLock',
  'Period',
  'Comma',
  'BracketLeft',
  'BracketRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
])

/**
 * Whether a key (`KeyboardEvent.code`) can hold an emote: a digit, a letter
 * the walkthrough leaves free, or a spare punctuation key — never a function
 * key (the browser's own) or one already in use.
 */
export function canBindKey(code: string): boolean {
  if (RESERVED_KEYS.has(code)) return false
  return /^(Digit\d|Numpad\d|Key[A-Z]|Minus|Equal|Semicolon|Quote|Backquote|Slash|Backslash)$/.test(
    code,
  )
}

const PUNCTUATION: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Slash: '/',
  Backslash: '\\',
}

/** How a key reads on a keycap: `Digit1` → 1, `KeyQ` → Q, `Numpad4` → 넘4. */
export function keyLabel(code: string): string {
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `넘${code.slice(6)}`
  if (code.startsWith('Key')) return code.slice(3)
  return PUNCTUATION[code] ?? code
}

/** The emote keys a new player starts with: the number row. */
export const DEFAULT_EMOTE_KEYS: Record<string, EmoteId> = {
  Digit1: 'wave',
  Digit2: 'clap',
  Digit3: 'cheer',
  Digit4: 'laugh',
  Digit5: 'nod',
  Digit6: 'headShake',
  Digit7: 'danceCool',
  Digit8: 'danceGroove',
  Digit9: 'present',
}
