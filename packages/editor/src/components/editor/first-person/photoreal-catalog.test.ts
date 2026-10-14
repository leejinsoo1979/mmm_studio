import { describe, expect, test } from 'bun:test'
import {
  aiAvatarIdOf,
  aiCharacters,
  aiPhotorealId,
  findPhotoreal,
  guessGender,
  localCharacters,
  localPhotorealId,
  PHOTO_AVATAR_AI_CREDIT,
  PHOTO_AVATAR_CREDIT,
  PHOTO_AVATAR_SCHEME,
  PHOTOREAL_AI_CREDIT,
  PHOTOREAL_CHARACTERS,
  PHOTOREAL_LOCAL_URL,
  PROFILE_ESTIMATED,
  photoAvatarIdOf,
  photoPhotorealId,
  readPhotorealId,
  registerPhotoAvatars,
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

  test('names an AI 인물 by its gender and avatar id, served by the app', () => {
    const avatarId = `${'a'.repeat(16)}-${'0'.repeat(24)}`
    const id = aiPhotorealId('female', avatarId)
    expect(id).toBe(`ai:female:${avatarId}`)
    expect(findPhotoreal(id)).toEqual({
      id,
      label: 'AI 인물',
      gender: 'female',
      url: `/api/photoreal-ai/avatars/${avatarId}/model.glb`,
      thumbnail: `/api/photoreal-ai/avatars/${avatarId}/portrait`,
      credit: PHOTOREAL_AI_CREDIT,
      local: false,
      ai: true,
    })
    expect(readPhotorealId(id)).toBe(id)
    expect(aiAvatarIdOf(id)).toBe(avatarId)
    expect(aiAvatarIdOf(localPhotorealId('male', 'a.glb'))).toBeNull()
    for (const bad of [
      `ai:other:${avatarId}`,
      'ai:male:../model.glb',
      `ai:male:${avatarId}/x`,
      'ai:male:ABCDEF',
    ]) {
      expect(findPhotoreal(bad)).toBeNull()
    }
  })

  test('lists the AI 인물 under their given names, always credited as AI-made', () => {
    const one = `${'1'.repeat(16)}-${'2'.repeat(24)}`
    const two = `${'3'.repeat(16)}-${'4'.repeat(24)}`
    const listed = aiCharacters([
      { id: one, name: 'AI 인물 1', gender: 'male', credit: 'AI 생성 인물 · 목업' },
      { id: two, name: '  ', gender: 'female', credit: '누군가의 사진' },
      { id: 'nope', name: 'x', gender: 'female' },
      { id: one, name: 'y' },
    ])
    expect(listed.map(({ label, credit, ai }) => [label, credit, ai])).toEqual([
      ['AI 인물 1', 'AI 생성 인물 · 목업', true],
      ['AI 인물', PHOTOREAL_AI_CREDIT, true],
    ])
  })

  test('finds a photo avatar made in this browser, by its stored id, before and after the store is read', () => {
    const stored = '0b8a3f52-6d4e-4c1a-9e2f-7a5b1c3d9e10'
    const id = photoPhotorealId('female', stored)
    expect(id).toBe(`photo:female:${stored}`)
    expect(photoAvatarIdOf(id)).toBe(stored)
    expect(readPhotorealId(id)).toBe(id)
    // Not read yet: a placeholder file the body waits on, no name.
    expect(findPhotoreal(id)).toEqual({
      id,
      label: '사진 아바타',
      gender: 'female',
      url: `${PHOTO_AVATAR_SCHEME}${stored}`,
      thumbnail: null,
      credit: PHOTO_AVATAR_CREDIT,
      local: true,
      photo: true,
    })
    registerPhotoAvatars([
      { id: stored, name: '내 얼굴', url: 'blob:glb', thumbnail: 'blob:thumb' },
    ])
    expect(findPhotoreal(id)).toMatchObject({
      label: '내 얼굴',
      url: 'blob:glb',
      thumbnail: 'blob:thumb',
    })
    expect(findPhotoreal(id)?.ai).toBeUndefined()
    // One made from an AI 인물's portrait is credited as AI-made.
    registerPhotoAvatars([
      { id: stored, name: 'AI 인물', url: 'blob:glb', thumbnail: 'blob:thumb', ai: true },
    ])
    expect(findPhotoreal(id)).toMatchObject({ ai: true, credit: PHOTO_AVATAR_AI_CREDIT })
    // One made from a single photo says its profile is a guess.
    registerPhotoAvatars([
      { id: stored, name: '한 장', url: 'blob:glb', thumbnail: 'blob:thumb', estimated: true },
    ])
    expect(findPhotoreal(id)).toMatchObject({
      estimated: true,
      credit: `${PROFILE_ESTIMATED} · ${PHOTO_AVATAR_CREDIT}`,
    })
    expect(PROFILE_ESTIMATED).toBe('옆모습 추정')
    registerPhotoAvatars([])
    expect(findPhotoreal(id)?.url).toBe(`${PHOTO_AVATAR_SCHEME}${stored}`)
    for (const bad of [
      `photo:other:${stored}`,
      'photo:male:../x.glb',
      `photo:male:${stored}/x`,
      'photo:male:1234',
    ]) {
      expect(findPhotoreal(bad)).toBeNull()
      expect(photoAvatarIdOf(bad)).toBeNull()
    }
  })
})
