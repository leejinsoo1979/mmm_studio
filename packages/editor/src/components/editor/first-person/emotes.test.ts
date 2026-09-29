import { describe, expect, test } from 'bun:test'
import { AnimationClip, AnimationMixer, NumberKeyframeTrack, Object3D } from 'three'
import { EmoteLayer } from './emote-player'
import {
  canBindKey,
  DEFAULT_EMOTE_KEYS,
  EMOTE_IDS,
  EMOTES,
  keyLabel,
  ONCE_MAX_SECONDS,
} from './emotes'

describe('emote keys', () => {
  test('digits and free letters take an emote; moving and game keys do not', () => {
    expect(canBindKey('Digit1')).toBe(true)
    expect(canBindKey('KeyQ')).toBe(true)
    expect(canBindKey('Numpad3')).toBe(true)
    for (const taken of [
      'KeyW',
      'KeyA',
      'KeyE',
      'KeyV',
      'Space',
      'ShiftLeft',
      'Escape',
      'Period',
    ]) {
      expect(canBindKey(taken)).toBe(false)
    }
    expect(canBindKey('F5')).toBe(false)
  })

  test('read as keycaps', () => {
    expect(keyLabel('Digit7')).toBe('7')
    expect(keyLabel('KeyQ')).toBe('Q')
    expect(keyLabel('Minus')).toBe('-')
  })

  test('the starting keys are all usable and name real emotes', () => {
    for (const [code, emote] of Object.entries(DEFAULT_EMOTE_KEYS)) {
      expect(canBindKey(code)).toBe(true)
      expect(EMOTE_IDS).toContain(emote)
    }
  })
})

/** A clip of `seconds` per emote id, animating a dummy property. */
function clips(seconds: number) {
  return EMOTE_IDS.map(
    (id) =>
      new AnimationClip(id, seconds, [
        new NumberKeyframeTrack('.position[x]', [0, seconds], [0, 1]),
      ]),
  )
}

function run(
  layer: EmoteLayer,
  seconds: number,
  cue: Parameters<EmoteLayer['update']>[0],
  moving = false,
) {
  let weight = 0
  for (let t = 0; t < seconds; t += 1 / 30) weight = layer.update(cue, moving, 1 / 30)
  return weight
}

describe('the emote layer', () => {
  test('fades a one-off in, then out when it is played through', () => {
    const layer = new EmoteLayer(new AnimationMixer(new Object3D()))
    layer.setClips(clips(2))
    const cue = { id: 'wave' as const, at: 1 }
    expect(EMOTES.wave.loop).toBe(false)
    expect(run(layer, 1, cue)).toBeGreaterThan(0.95)
    expect(layer.finished(cue)).toBe(false)
    expect(run(layer, 2, cue)).toBeLessThan(0.05)
    expect(layer.finished(cue)).toBe(true)
  })

  test('cuts a long one-off short', () => {
    const layer = new EmoteLayer(new AnimationMixer(new Object3D()))
    layer.setClips(clips(30))
    const cue = { id: 'clap' as const, at: 1 }
    run(layer, ONCE_MAX_SECONDS + 1, cue)
    expect(layer.finished(cue)).toBe(true)
  })

  test('keeps a dance going until the body moves off', () => {
    const layer = new EmoteLayer(new AnimationMixer(new Object3D()))
    layer.setClips(clips(2))
    const cue = { id: 'danceCool' as const, at: 1 }
    expect(run(layer, 6, cue)).toBeGreaterThan(0.95)
    expect(run(layer, 1.5, cue, true)).toBeLessThan(0.05)
    expect(layer.finished(cue)).toBe(true)
  })

  test('waits for its clips, then plays the cue', () => {
    const layer = new EmoteLayer(new AnimationMixer(new Object3D()))
    const cue = { id: 'nod' as const, at: 1 }
    expect(run(layer, 0.5, cue)).toBe(0)
    layer.setClips(clips(2))
    expect(run(layer, 0.8, cue)).toBeGreaterThan(0.9)
  })
})
