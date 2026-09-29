import { describe, expect, test } from 'bun:test'
import {
  ALL_AVATARS,
  AVATAR_TABS,
  avatarGender,
  avatarLabel,
  avatarTab,
  DEFAULT_AVATAR_ID,
  findAvatar,
} from './avatar-catalog'

describe('avatar catalog', () => {
  test('ids read as their gender, including jobs and children', () => {
    expect(avatarGender('Male_Adult_03')).toBe('male')
    expect(avatarGender('Female_Party_02')).toBe('female')
    expect(avatarGender('Business_Female_04')).toBe('female')
    expect(avatarGender('Fire_Male_05')).toBe('male')
    expect(avatarGender('Female_Child_01')).toBe('female')
  })

  test('labels are Korean', () => {
    expect(avatarLabel('Male_Adult_03')).toBe('남 3')
    expect(avatarLabel('Female_Party_02')).toBe('여 파티 2')
    expect(avatarLabel('Business_Female_04')).toBe('정장 여 4')
    expect(avatarLabel('Female_Child_01')).toBe('여아 1')
    expect(avatarLabel('Police_Male_07')).toBe('경찰 남 7')
  })

  test('an unknown or legacy id falls back to the default body', () => {
    expect(findAvatar('male').id).toBe(DEFAULT_AVATAR_ID)
    expect(findAvatar('Female_Adult_05').id).toBe('Female_Adult_05')
  })

  test('every avatar lands on a tab, and every tab has avatars', () => {
    const tabs = new Set(ALL_AVATARS.map(avatarTab))
    for (const tab of AVATAR_TABS) expect(tabs.has(tab.id)).toBe(true)
    expect(new Set(ALL_AVATARS.map((avatar) => avatar.id)).size).toBe(ALL_AVATARS.length)
  })
})
