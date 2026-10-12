import { describe, expect, test } from 'bun:test'
import { type PortraitFace, portraitIssues } from './portrait-check'

describe('portraitIssues', () => {
  /** A frontal face 400 px tall in the middle of a 1024² image, eyes open, mouth closed. */
  function face(
    overrides: Partial<PortraitFace> = {},
    move: Record<number, [number, number]> = {},
  ) {
    const points: [number, number][] = Array.from({ length: 478 }, () => [512, 512])
    const set = (i: number, p: [number, number]) => {
      points[i] = p
    }
    set(10, [512, 300])
    set(152, [512, 700])
    set(234, [352, 500])
    set(454, [672, 500])
    // Right eye (image left) and left eye: 60 px wide, 18 px open.
    set(33, [400, 450])
    set(133, [460, 450])
    set(159, [430, 441])
    set(145, [430, 459])
    set(362, [564, 450])
    set(263, [624, 450])
    set(386, [594, 441])
    set(374, [594, 459])
    set(78, [472, 600])
    set(308, [552, 600])
    set(13, [512, 599])
    set(14, [512, 601])
    for (const [i, p] of Object.entries(move)) set(Number(i), p)
    return { points, yaw: 0, pitch: 0, roll: 0, ...overrides }
  }
  const square = { width: 1024, height: 1024 }

  test('a good portrait has no issues', () => {
    expect(portraitIssues(face(), 1, square)).toEqual([])
  })

  test('each problem is named', () => {
    expect(portraitIssues(null, 0, square)).toEqual(['no_face'])
    expect(portraitIssues(face(), 2, square)).toEqual(['several_faces'])
    expect(portraitIssues(face({ yaw: 20 }), 1, square)).toEqual(['turned'])
    expect(portraitIssues(face({ roll: -12 }), 1, square)).toEqual(['tilted'])
    expect(portraitIssues(face({}, { 159: [430, 448], 145: [430, 452] }), 1, square)).toEqual([
      'eyes_closed',
    ])
    expect(portraitIssues(face({}, { 13: [512, 590], 14: [512, 615] }), 1, square)).toEqual([
      'mouth_open',
    ])
    expect(portraitIssues(face(), 1, { width: 1024, height: 2048 })).toEqual(['too_small'])
  })
})
