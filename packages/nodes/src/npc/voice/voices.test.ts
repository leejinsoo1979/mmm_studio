import { describe, expect, test } from 'bun:test'
import { isKoreanVoice, npcVoicePitch, pickNpcVoice, speechChunks } from './voices'

const HEAMI = { name: 'Microsoft Heami - Korean (Korean)', lang: 'ko-KR' }
const SUNHI = { name: 'Microsoft SunHi Online (Natural) - Korean (Korea)', lang: 'ko-KR' }
const INJOON = { name: 'Microsoft InJoon Online (Natural) - Korean (Korea)', lang: 'ko-KR' }
const GOOGLE = { name: 'Google 한국의', lang: 'ko-KR' }
const ANDROID = { name: 'Korean Korea', lang: 'ko_KR' }
const ENGLISH = { name: 'Samantha', lang: 'en-US' }

describe('pickNpcVoice', () => {
  test('a named voice wins when this browser has it, in any language', () => {
    expect(pickNpcVoice([SUNHI, ENGLISH], 'Male_Adult_01', 'Samantha')).toBe(ENGLISH)
    expect(pickNpcVoice([HEAMI, INJOON], 'Male_Adult_01', 'Microsoft Yuna')).toBe(INJOON)
  })

  test('the avatar gender comes first, then a natural voice', () => {
    const voices = [ENGLISH, HEAMI, INJOON, SUNHI]
    expect(pickNpcVoice(voices, 'Female_Adult_03', 'auto')).toBe(SUNHI)
    expect(pickNpcVoice(voices, 'Business_Male_02', 'auto')).toBe(INJOON)
    expect(pickNpcVoice([HEAMI, INJOON], 'Female_Child_01', 'auto')).toBe(HEAMI)
    expect(pickNpcVoice([GOOGLE, INJOON], 'Police_Female_01', 'auto')).toBe(GOOGLE)
  })

  test('a voice of unknown gender beats one of the other gender', () => {
    expect(pickNpcVoice([INJOON, ANDROID], 'Female_Adult_01', 'auto')).toBe(ANDROID)
  })

  test('any Korean voice, in list order, when none is known', () => {
    const other = { name: 'Korean 2', lang: 'ko' }
    expect(pickNpcVoice([ENGLISH, ANDROID, other], 'Male_Adult_01', 'auto')).toBe(ANDROID)
  })

  test('null without a Korean voice, so the browser picks by language', () => {
    expect(pickNpcVoice([ENGLISH], 'Male_Adult_01', 'auto')).toBeNull()
    expect(pickNpcVoice([], 'Male_Adult_01', 'auto')).toBeNull()
  })
})

test('isKoreanVoice', () => {
  expect(isKoreanVoice(SUNHI)).toBe(true)
  expect(isKoreanVoice(ANDROID)).toBe(true)
  expect(isKoreanVoice({ name: 'x', lang: 'KO' })).toBe(true)
  expect(isKoreanVoice({ name: 'x', lang: 'kok-IN' })).toBe(false)
  expect(isKoreanVoice(ENGLISH)).toBe(false)
})

describe('npcVoicePitch', () => {
  test('adult male, adult female and child defaults', () => {
    expect(npcVoicePitch('Male_Adult_01', 1)).toBeCloseTo(0.9)
    expect(npcVoicePitch('Business_Female_01', 1)).toBeCloseTo(1.05)
    expect(npcVoicePitch('Male_Child_01', 1)).toBeCloseTo(1.35)
    expect(npcVoicePitch('Female_Child_02', 1)).toBeCloseTo(1.35)
  })

  test("times the NPC's own pitch, capped at the speech maximum", () => {
    expect(npcVoicePitch('Male_Adult_01', 0.5)).toBeCloseTo(0.45)
    expect(npcVoicePitch('Female_Adult_01', 1.5)).toBeCloseTo(1.575)
    expect(npcVoicePitch('Female_Child_01', 2)).toBe(2)
  })
})

describe('speechChunks', () => {
  test('sentence by sentence', () => {
    expect(
      speechChunks('안녕하세요! 여기는 거실이에요. 천천히 둘러보세요~ 궁금한 게 있나요?'),
    ).toEqual(['안녕하세요!', '여기는 거실이에요.', '천천히 둘러보세요~', '궁금한 게 있나요?'])
  })

  test('decimals and line breaks', () => {
    expect(speechChunks('면적은 약 32.1㎡예요.\n창이 2개 있어요')).toEqual([
      '면적은 약 32.1㎡예요.',
      '창이 2개 있어요',
    ])
  })

  test('a long sentence is cut at a space, never longer than the maximum', () => {
    expect(speechChunks('가나다 라마바 사아자 차카타 파하', 8)).toEqual([
      '가나다 라마바',
      '사아자 차카타',
      '파하',
    ])
    expect(speechChunks('가'.repeat(25), 10)).toEqual([
      '가'.repeat(10),
      '가'.repeat(10),
      '가'.repeat(5),
    ])
  })

  test('nothing to say', () => {
    expect(speechChunks('  ')).toEqual([])
  })
})
