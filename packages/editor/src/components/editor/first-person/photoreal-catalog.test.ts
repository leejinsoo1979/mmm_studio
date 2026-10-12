import { describe, expect, test } from 'bun:test'
import {
  findPhotoreal,
  guessGender,
  localCharacters,
  localPhotorealId,
  PHOTOREAL_CHARACTERS,
  PHOTOREAL_LOCAL_URL,
  readPhotorealId,
} from './photoreal-catalog'

describe('the 실사 set', () => {
  test('ships its characters with a file, a card and a licence each', () => {
    expect(PHOTOREAL_CHARACTERS.length).toBeGreaterThan(0)
    for (const character of PHOTOREAL_CHARACTERS) {
      expect(character.url).toMatch(/^\/characters\/photoreal\/[\w-]+\.glb$/)
      expect(character.thumbnail).toMatch(/^\/characters\/photoreal\/thumbs\/[\w-]+\.webp$/)
      expect(character.credit).toMatch(/CC0|CC BY|MIT/)
      expect(character.local).toBe(false)
      expect(findPhotoreal(character.id)).toBe(character)
    }
  })

  test('names a local file by its gender and file, served from the local folder', () => {
    const id = localPhotorealId('female', 'My Head 01.glb')
    expect(id).toBe('local:female:My Head 01.glb')
    expect(findPhotoreal(id)).toEqual({
      id,
      label: 'My Head 01',
      gender: 'female',
      url: `${PHOTOREAL_LOCAL_URL}/My%20Head%2001.glb`,
      thumbnail: null,
      credit: '내 PC의 파일',
      local: true,
    })
  })

  test('reads nothing else as one: Rocketbox ids, paths out of the folder, other files', () => {
    for (const id of [
      'Male_Adult_01',
      'local:female:../secret.glb',
      'local:male:a/b.glb',
      'local:male:face.fbx',
      'local:other:a.glb',
      '',
    ]) {
      expect(findPhotoreal(id)).toBeNull()
      expect(readPhotorealId(id)).toBeNull()
    }
    expect(readPhotorealId(42)).toBeNull()
    expect(readPhotorealId(PHOTOREAL_CHARACTERS[0]!.id)).toBe(PHOTOREAL_CHARACTERS[0]!.id)
  })

  test('lists the local folder with characters.json’s names (kept for its saved picks) and genders, guessing a gender from the file', () => {
    const listed = localCharacters([
      { file: 'metahuman_ada.glb', name: '에이다', gender: 'female' },
      { file: 'woman-scan.glb' },
      { file: 'kim.glb' },
      { file: 'notes.txt' },
      { file: '../escape.glb' },
    ])
    expect(listed.map(({ label, gender }) => [label, gender])).toEqual([
      ['에이다', 'female'],
      ['woman-scan', 'female'],
      ['kim', 'male'],
    ])
    expect(findPhotoreal(localPhotorealId('female', 'metahuman_ada.glb'))?.label).toBe('에이다')
    expect(guessGender('여자캐릭터.glb')).toBe('female')
    expect(guessGender('f_01.glb')).toBe('female')
    expect(guessGender('hero.glb')).toBe('male')
  })
})
