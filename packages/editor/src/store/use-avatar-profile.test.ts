import { describe, expect, test } from 'bun:test'
import { BODY_SLIDERS } from '../components/editor/first-person/body-shape'
import { MAX_PIN } from '../components/editor/first-person/face-pins'
import { FACE_PARTS, FACE_POINT_INDICES } from '../components/editor/first-person/face-points'
import { FACE_SLIDERS } from '../components/editor/first-person/face-shape'
import useAvatarProfile, {
  type AvatarLook,
  changesCharacter,
  DEFAULT_SHAVE,
  MAX_CHARACTER_NAME,
  NO_LOOK,
  readAvatarLook,
  readCharacterName,
} from './use-avatar-profile'

const IRISES = new Set(
  [...FACE_PARTS.rightIris, ...FACE_PARTS.leftIris].map((i) => FACE_POINT_INDICES[i]!),
)

/**
 * The biggest look there is without a photo: every slider set (to a
 * value of as many digits as a slider gives), every point of skin pinned
 * as far as pins go, every colour and amount of the paint set.
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
  hairStyle: 'Female_Adult_04',
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
