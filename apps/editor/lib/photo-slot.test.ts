import { describe, expect, test } from 'bun:test'
import { type SlotReading, slotFromReading } from './photo-slot'

const unseen: SlotReading = {
  yaw: null,
  faceSkinX: null,
  hairX: null,
  headX: null,
  neckX: null,
  headWidth: 200,
}

describe('photo slot', () => {
  test('a face MediaPipe reads is filed by its turn', () => {
    expect(slotFromReading({ ...unseen, yaw: 4 })).toBe('front')
    expect(slotFromReading({ ...unseen, yaw: -15 })).toBe('front')
    // Turned to the subject's left: the nose toward the picture's right.
    expect(slotFromReading({ ...unseen, yaw: 44 })).toBe('left45')
    expect(slotFromReading({ ...unseen, yaw: -38 })).toBe('right45')
    // Past 60° MediaPipe guesses: only which way is believed.
    expect(slotFromReading({ ...unseen, yaw: 72 })).toBe('left90')
    expect(slotFromReading({ ...unseen, yaw: -65 })).toBe('right90')
  })

  test('a side view MediaPipe lost is filed by where the face lies against the hair', () => {
    expect(slotFromReading({ ...unseen, faceSkinX: 520, hairX: 440 })).toBe('left90')
    expect(slotFromReading({ ...unseen, faceSkinX: 400, hairX: 470 })).toBe('right90')
  })

  test('a head without hair to tell by is filed by how it reaches out over the neck', () => {
    const bald = { ...unseen, faceSkinX: 500, hairX: null }
    expect(slotFromReading({ ...bald, headX: 515, neckX: 480 })).toBe('left90')
    expect(slotFromReading({ ...bald, headX: 460, neckX: 490 })).toBe('right90')
  })

  test('a photo that can’t tell is not filed', () => {
    expect(slotFromReading(unseen)).toBeNull()
    // Face and hair, head and neck too close together to tell a side by.
    expect(
      slotFromReading({ ...unseen, faceSkinX: 500, hairX: 495, headX: 500, neckX: 498 }),
    ).toBeNull()
  })
})
