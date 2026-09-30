import { describe, expect, test } from 'bun:test'
import { ALL_AVATARS, avatarGender } from '@pascal-app/editor'
import { counterpartAvatar, isChild } from './avatar-counterpart'

describe('the avatar in the other sex or age', () => {
  test('keeps the line and number where the library has them', () => {
    expect(counterpartAvatar('Male_Adult_07', 'female', false)).toBe('Female_Adult_07')
    expect(counterpartAvatar('Female_Adult_07', 'male', false)).toBe('Male_Adult_07')
    expect(counterpartAvatar('Business_Male_03', 'female', false)).toBe('Business_Female_03')
    expect(counterpartAvatar('Business_Female_03', 'male', false)).toBe('Business_Male_03')
  })

  test('keeps the last of a shorter line', () => {
    expect(counterpartAvatar('Male_Adult_21', 'female', false)).toBe('Female_Adult_17')
    expect(counterpartAvatar('Business_Male_07', 'female', false)).toBe('Business_Female_04')
  })

  test('falls back to the plain adults where a line has no one of that sex', () => {
    expect(counterpartAvatar('Gardener_Male_01', 'female', false)).toBe('Female_Adult_01')
    expect(counterpartAvatar('Female_Party_02', 'male', false)).toBe('Male_Adult_02')
  })

  test('moves between the adults and the children', () => {
    expect(counterpartAvatar('Male_Adult_07', 'male', true)).toBe('Male_Child_02')
    expect(counterpartAvatar('Fire_Female_01', 'female', true)).toBe('Female_Child_01')
    expect(counterpartAvatar('Male_Child_02', 'male', false)).toBe('Male_Adult_02')
    expect(counterpartAvatar('Male_Child_02', 'female', true)).toBe('Female_Child_02')
    expect(counterpartAvatar('Female_Child_01', 'male', false)).toBe('Male_Adult_01')
  })

  test('leaves an avatar that already is that sex and age', () => {
    expect(counterpartAvatar('Pilot_Female_02', 'female', false)).toBe('Pilot_Female_02')
  })

  test('always lands on an avatar of the wanted sex and age', () => {
    const ids = new Set(ALL_AVATARS.map((avatar) => avatar.id))
    for (const { id } of ALL_AVATARS) {
      for (const gender of ['male', 'female'] as const) {
        for (const child of [false, true]) {
          const found = counterpartAvatar(id, gender, child)
          expect(ids.has(found)).toBe(true)
          expect(avatarGender(found)).toBe(gender)
          expect(isChild(found)).toBe(child)
        }
      }
    }
  })
})
