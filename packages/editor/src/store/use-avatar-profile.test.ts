import { describe, expect, test } from 'bun:test'
import { BODY_SLIDERS } from '../components/editor/first-person/body-shape'
import { MAX_PIN } from '../components/editor/first-person/face-pins'
import { FACE_PARTS, FACE_POINT_INDICES } from '../components/editor/first-person/face-points'
import { FACE_SLIDERS } from '../components/editor/first-person/face-shape'
import type { HairCut } from '../components/editor/first-person/hair-cut'
import useAvatarProfile, {
  type AvatarLook,
  changesCharacter,
  DEFAULT_SHAVE,
  MAX_CHARACTER_NAME,
  NO_LOOK,
  paintOf,
  readAvatarLook,
  readCharacterName,
} from './use-avatar-profile'

const IRISES = new Set(
  [...FACE_PARTS.rightIris, ...FACE_PARTS.leftIris].map((i) => FACE_POINT_INDICES[i]!),
)

/** The longest hair cut as JSON: the longest style name, every slider at a two-place negative, a tip. */
const LARGEST_CUT: HairCut = {
  style: 'twoBlock',
  length: -0.37,
  volume: -0.37,
  curl: 0.37,
  part: -0.37,
  fringe: 0.37,
  tip: '#a0522d',
  shine: 0.37,
}

/**
 * The biggest look there is without a photo: every slider set (to a
 * value of as many digits as a slider gives), every point of skin pinned
 * as far as pins go, every colour and amount of the paint set, the longest
 * hair cut, and an old borrowed hairstyle kept beside it.
 */
const LARGEST: AvatarLook = readAvatarLook({
  hair: '#a0522d',
  skin: '#c68d63',
  face: null,
  shape: {
    fit: 0.37,
    sliders: Object.fromEntries(FACE_SLIDERS.map(({ id }) => [id, -0.37])),
    pins: Object.fromEntries(
      FACE_POINT_INDICES.filter((landmark) => !IRISES.has(landmark)).map((landmark) => [
        landmark,
        Array.from({ length: 3 }, () => -MAX_PIN / Math.sqrt(3) + 1e-4),
      ]),
    ),
  },
  body: {
    height: -0.37,
    sliders: Object.fromEntries(BODY_SLIDERS.map(({ id }) => [id, -0.37])),
  },
  hairCut: LARGEST_CUT,
  hairStyle: 'Female_Adult_04',
  shave: 0.37,
  paint: {
    eyes: '#3e6aa8',
    browColor: '#2b1d14',
    browDarkness: 0.37,
    browThickness: -0.37,
    lips: '#b3202e',
    lipAmount: 0.37,
    blush: '#e08080',
    blushAmount: 0.37,
    shadow: '#704060',
    shadowAmount: 0.37,
    liner: 0.37,
    beard: 'stubble',
    beardAmount: 0.37,
    freckles: 0.37,
  },
  feet: { wear: 'socks', color: '#223344' },
})

describe('the character’s name', () => {
  test('is kept as saved: trimmed, at most MAX_CHARACTER_NAME long, else none', () => {
    expect(MAX_CHARACTER_NAME).toBe(16)
    expect(readCharacterName('  지아  ')).toBe('지아')
    expect(readCharacterName('가나다라마바사아자차카타파하가나다라')).toBe(
      '가나다라마바사아자차카타파하가나',
    )
    // Cut between characters, never inside one.
    expect(readCharacterName('🙂'.repeat(20))).toBe('🙂'.repeat(MAX_CHARACTER_NAME))
    expect(readCharacterName(`${'a'.repeat(15)} b`)).toBe('a'.repeat(15))
    for (const junk of [undefined, null, 42, ['지아'], { name: '지아' }]) {
      expect(readCharacterName(junk)).toBe('')
    }
  })

  test('set by the studio, trimmed and kept short', () => {
    const { setName } = useAvatarProfile.getState()
    setName('  민준 ')
    expect(useAvatarProfile.getState().name).toBe('민준')
    setName('x'.repeat(40))
    expect(useAvatarProfile.getState().name).toBe('x'.repeat(MAX_CHARACTER_NAME))
    setName('')
    expect(useAvatarProfile.getState().name).toBe('')
  })
})

describe('a look with a sculpted face', () => {
  test('changes the character with pins alone', () => {
    const pinned = { ...NO_LOOK, shape: { ...NO_LOOK.shape, pins: { 4: [0, 0, 0.01] } } }
    expect(changesCharacter(readAvatarLook(pinned))).toBe(true)
    expect(changesCharacter(NO_LOOK)).toBe(false)
  })

  test('is saved and loaded back the same', () => {
    expect(readAvatarLook(JSON.parse(JSON.stringify(LARGEST)))).toEqual(LARGEST)
  })

  test('stays under 12 KB at its largest, within an NPC’s look limit', () => {
    expect(Object.keys(LARGEST.shape.pins).length).toBe(FACE_POINT_INDICES.length - IRISES.size)
    const text = JSON.stringify(LARGEST)
    expect(text.length).toBeLessThan(12 * 1024)
    expect(text).not.toContain('data:')
  })
})

describe('a look’s hair cut', () => {
  /** A look as it comes back from JSON: a save, another player’s document, a scene. */
  const sent = (look: object) => JSON.parse(JSON.stringify(look))

  test('alone changes the character, painting the skin where its own hair was', () => {
    const cutOnly = readAvatarLook(sent({ ...NO_LOOK, hairCut: LARGEST_CUT }))
    expect(cutOnly.hairCut).toEqual(LARGEST_CUT)
    expect(changesCharacter(cutOnly)).toBe(true)
    expect(paintOf(cutOnly).bald).toBe(true)
  })

  test('an older save, or one with no usable cut, keeps the character’s own hair', () => {
    const { hairCut: _, ...older } = LARGEST
    expect(readAvatarLook(sent(older))).toEqual({ ...LARGEST, hairCut: null })
    for (const junk of [null, 'bob', 42, { style: 'mohawk' }, { length: 1 }]) {
      const read = readAvatarLook({ ...LARGEST, hairCut: junk })
      expect(read).toEqual({ ...LARGEST, hairCut: null })
    }
    expect(readAvatarLook(undefined).hairCut).toBeNull()
    expect(NO_LOOK.hairCut).toBeNull()
  })

  test('leaves a borrowed hairstyle and its shave as saved, no longer painting the head bald', () => {
    for (const hairStyle of ['bald', 'Female_Adult_04']) {
      const legacy = readAvatarLook(sent({ ...NO_LOOK, hairStyle, shave: 0.8 }))
      expect(legacy.hairStyle).toBe(hairStyle)
      expect(legacy.shave).toBe(0.8)
      expect(legacy.hairCut).toBeNull()
      expect(paintOf(legacy).bald).toBe(false)
      // Still a change, kept for the closest cut to take over.
      expect(changesCharacter(legacy)).toBe(true)
      const both = readAvatarLook(sent({ ...legacy, hairCut: LARGEST_CUT }))
      expect(both).toEqual({ ...legacy, hairCut: LARGEST_CUT })
    }
  })

  test('is kept in this browser and comes back as the profile loads', async () => {
    // The store keeps the profile in localStorage, which bun lacks: each
    // fresh copy of the module (a query of its own) makes its store anew
    // over this one, the first saving the look, the next ones loading it.
    const kept = new Map<string, string>()
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    }
    const global = globalThis as { localStorage?: unknown }
    global.localStorage = storage
    try {
      const fresh = async (copy: string) =>
        (await import(`./use-avatar-profile.ts?${copy}`)).default as typeof useAvatarProfile
      ;(await fresh('saving')).getState().setLook(LARGEST)
      expect(kept.get('mmm-avatar-profile')).toContain('"hairCut"')
      expect((await fresh('loading')).getState().look).toEqual(LARGEST)
      const saved = JSON.parse(kept.get('mmm-avatar-profile')!)
      delete saved.state.look.hairCut
      kept.set('mmm-avatar-profile', JSON.stringify(saved))
      expect((await fresh('older')).getState().look).toEqual({ ...LARGEST, hairCut: null })
    } finally {
      delete global.localStorage
    }
  })
})

describe('a look’s shaved head', () => {
  test('keeps how much its stubble has grown back, in range; an older save gets the light default', () => {
    expect(readAvatarLook({ ...NO_LOOK, shave: 0.8 }).shave).toBe(0.8)
    expect(readAvatarLook({ ...NO_LOOK, shave: 3 }).shave).toBe(1)
    const { shave: _, ...older } = NO_LOOK
    expect(readAvatarLook(older).shave).toBe(DEFAULT_SHAVE)
    expect(DEFAULT_SHAVE).toBeGreaterThan(0)
    expect(DEFAULT_SHAVE).toBeLessThan(0.5)
  })
})
