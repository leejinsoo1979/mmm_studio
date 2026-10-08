import { describe, expect, test } from 'bun:test'
import { NO_LOOK, readAvatarLook } from '../../../store/use-avatar-profile'
import { BALD, wornHairStyle } from './hair-styles'

describe('a look’s hairstyle, until generated hair replaces the borrowed ones', () => {
  test('a borrowed style or a bald head is worn as the character’s own hair', () => {
    expect(wornHairStyle(null)).toBeNull()
    expect(wornHairStyle(BALD)).toBeNull()
    expect(wornHairStyle('Female_Adult_04')).toBeNull()
  })

  test('a saved one, and how far its stubble grew, stay saved for that hair to take over', () => {
    for (const hairStyle of [BALD, 'Male_Adult_09']) {
      const saved = readAvatarLook({ ...NO_LOOK, hairStyle, shave: 0.8 })
      expect(saved.hairStyle).toBe(hairStyle)
      expect(saved.shave).toBe(0.8)
      expect(wornHairStyle(saved.hairStyle)).toBeNull()
    }
  })
})
