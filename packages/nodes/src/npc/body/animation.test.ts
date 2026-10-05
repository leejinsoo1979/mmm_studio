import { describe, expect, test } from 'bun:test'
import {
  NPC_FREEZE_DISTANCE,
  NPC_HIDE_DISTANCE,
  NpcEmotePicker,
  nearestBodies,
  npcBodyDetail,
  overheadOpacity,
} from './animation'

describe('npcBodyDetail', () => {
  test('animates near, holds its pose further off, and hides far away', () => {
    expect(npcBodyDetail(0)).toBe('animated')
    expect(npcBodyDetail(NPC_FREEZE_DISTANCE)).toBe('animated')
    expect(npcBodyDetail(NPC_FREEZE_DISTANCE + 0.1)).toBe('frozen')
    expect(npcBodyDetail(NPC_HIDE_DISTANCE)).toBe('frozen')
    expect(npcBodyDetail(NPC_HIDE_DISTANCE + 0.1)).toBe('hidden')
  })
})

describe('nearestBodies', () => {
  test('keeps every body while within the budget', () => {
    const distances = new Map([
      ['a', 20],
      ['b', 3],
    ])
    expect(nearestBodies(distances, 2)).toEqual(new Set(['a', 'b']))
  })

  test('picks the nearest, ties by id', () => {
    const distances = new Map([
      ['d', 9],
      ['c', 1],
      ['b', 5],
      ['a', 5],
      ['e', 2],
    ])
    expect(nearestBodies(distances, 3)).toEqual(new Set(['c', 'e', 'a']))
  })
})

describe('overheadOpacity', () => {
  test('full near, fading out from 8 m to 14 m, hidden in your face', () => {
    expect(overheadOpacity(0.5)).toBe(0)
    expect(overheadOpacity(1.5)).toBe(1)
    expect(overheadOpacity(8)).toBe(1)
    expect(overheadOpacity(11)).toBeCloseTo(0.5)
    expect(overheadOpacity(14)).toBe(0)
    expect(overheadOpacity(40)).toBe(0)
  })
})

describe('NpcEmotePicker', () => {
  const wave = { id: 'wave', at: 1000 }

  test('plays the pose cue once it is due', () => {
    const picker = new NpcEmotePicker()
    const input = { cue: wave, speakingSince: null, presenter: false }
    expect(picker.pick({ ...input, now: 900 })).toBeNull()
    expect(picker.pick({ ...input, now: 1000 })).toBe(wave)
    expect(picker.pick({ ...input, now: 5000 })).toBe(wave)
  })

  test('talks while speaking; a guide presents', () => {
    const picker = new NpcEmotePicker()
    const talking = { cue: null, speakingSince: 2000, now: 2500 }
    expect(picker.pick({ ...talking, presenter: false })).toEqual({ id: 'talk', at: 2000 })
    expect(picker.pick({ ...talking, presenter: true })).toEqual({ id: 'present', at: 2000 })
  })

  test('the later of the pose cue and the talk wins', () => {
    const picker = new NpcEmotePicker()
    // Nodding, then starting to speak: the talk takes over…
    expect(picker.pick({ cue: wave, speakingSince: null, presenter: false, now: 1200 })).toBe(wave)
    expect(picker.pick({ cue: wave, speakingSince: 1500, presenter: false, now: 1600 })).toEqual({
      id: 'talk',
      at: 1500,
    })
    // …and the wave, still in the pose, doesn't come back when the talk ends.
    expect(picker.pick({ cue: wave, speakingSince: null, presenter: false, now: 4000 })).toBeNull()

    // A new cue during a talk plays over it.
    const shrug = { id: 'shrug', at: 5000 }
    expect(picker.pick({ cue: shrug, speakingSince: 4500, presenter: false, now: 5100 })).toBe(
      shrug,
    )
  })

  test('a cue that played out is not started again, and the talk resumes', () => {
    const picker = new NpcEmotePicker()
    const nod = { id: 'nod', at: 3000 }
    const speaking = { speakingSince: 2000, presenter: false }
    expect(picker.pick({ ...speaking, cue: nod, now: 3100 })).toBe(nod)
    picker.finish(nod)
    expect(picker.pick({ ...speaking, cue: nod, now: 6000 })).toEqual({ id: 'talk', at: 2000 })
    expect(
      picker.pick({ cue: { ...nod }, speakingSince: null, presenter: false, now: 7000 }),
    ).toBeNull()
  })
})
