import { describe, expect, test } from 'bun:test'
import { WallNode } from '../../schema'
import {
  constructionBuildUpMm,
  finishDepthToOffsetMm,
  timberStudCentresMm,
  wallConstructionError,
  wallConstructionLayers,
  wallCoreThicknessMm,
  withWallConstruction,
} from './wall-construction'

const wall = (thickness: number, construction?: WallNode['construction']) =>
  WallNode.parse({ start: [0, 0], end: [3, 0], thickness, construction })

describe('mmmcraft wall construction', () => {
  test('build-up: 목상 58.0077, 떡가베 29 on each face, 일반 0', () => {
    expect(constructionBuildUpMm({ kind: 'timber', side: 'left' })).toBeCloseTo(
      58.00773151634348,
      9,
    )
    expect(constructionBuildUpMm({ kind: 'bonded', side: 'left' })).toBe(58)
    expect(constructionBuildUpMm(undefined)).toBe(0)
  })

  test('switching type keeps the core: 200 → 258.0077 → 258 → 200 (mmmcraft test)', () => {
    let w = wall(0.2)
    const timber = withWallConstruction(w, { kind: 'timber', side: 'left' })
    expect(timber.thickness * 1000).toBeCloseTo(258.00773151634348, 6)
    w = { ...w, ...timber }
    const bonded = withWallConstruction(w, { kind: 'bonded', side: 'left' })
    expect(bonded.thickness * 1000).toBeCloseTo(258, 6)
    expect(bonded.construction?.bothFaces).toBe(true)
    w = { ...w, ...bonded }
    const plain = withWallConstruction(w, undefined)
    expect(plain.thickness * 1000).toBeCloseTo(200, 6)
    expect(wallCoreThicknessMm({ ...w, ...plain })).toBeCloseTo(200, 6)
  })

  test('bonded left T=258: finish-2p z∈[120,129], core ±100, back-2p [−129,−120]', () => {
    const layers = wallConstructionLayers(258, { kind: 'bonded', side: 'left' })
    const z = (id: string) => {
      const l = layers.find((x) => x.id === id)!
      return [
        finishDepthToOffsetMm(258, 'left', l.toMm),
        finishDepthToOffsetMm(258, 'left', l.fromMm),
      ]
    }
    expect(z('finish-2p')).toEqual([120, 129])
    expect(z('core')).toEqual([-100, 100])
    expect(z('back-finish-2p')).toEqual([-129, -120])
  })

  test('validation messages', () => {
    expect(wallConstructionError(wall(0.05, { kind: 'timber', side: 'left' }))).toBe(
      '마감 두께를 제외한 벽체 두께는 0보다 커야 합니다.',
    )
    expect(wallConstructionError(wall(0.2, { kind: 'timber', side: 'left' }))).toBeNull()
  })

  test('studs every spacing from 15, skipping hidden doors', () => {
    const c = { kind: 'timber' as const, side: 'left' as const, studSpacing: 400 }
    expect(timberStudCentresMm(1300, c)).toEqual([15, 415, 815, 1215])
    expect(timberStudCentresMm(1300, c, [{ centreMm: 800, widthMm: 900 }])).toEqual([15])
    expect(timberStudCentresMm(1300, { kind: 'timber', side: 'left' })).toEqual([])
  })
})
