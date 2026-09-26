import { describe, expect, test } from 'bun:test'
import { WindowNode } from '../../schema'
import {
  DEFAULT_LX_WINDOW_SELECTION,
  isPublishedVentSize,
  LX_PHI_GLAZING_TRACE,
  LX_PHI_HEAD_TRACES,
  LX_PHI_JAMB_TRACES,
  LX_PHI_SILL_TRACES,
  lxEdgeSection,
  lxWindowError,
  lxWindowGlass,
  lxWindowJambPlan,
  lxWindowSelectionUpdates,
  validateLxSectionTrace,
} from './lx-window'

const lx = (extra: Record<string, unknown> = {}) =>
  WindowNode.parse({
    width: 0.9,
    height: 1.2,
    ...lxWindowSelectionUpdates(DEFAULT_LX_WINDOW_SELECTION),
    ...extra,
  })

describe('LX Z:IN E9-PTT85 PHI', () => {
  test('every traced section is a valid ring set', () => {
    for (const traces of [LX_PHI_HEAD_TRACES, LX_PHI_SILL_TRACES, LX_PHI_JAMB_TRACES]) {
      expect(validateLxSectionTrace(traces['fixed-frame'])).toEqual([])
      expect(validateLxSectionTrace(traces['sash-frame'])).toEqual([])
    }
    const sash = LX_PHI_HEAD_TRACES['sash-frame']
    expect(
      validateLxSectionTrace({
        ...sash,
        cavities: [
          [
            [217, 381],
            [327, 381],
            [327, 458],
            [217, 458],
          ],
          sash.cavities[1]!,
        ],
      }),
    ).toContain('cavity-0-outside-outer')
  })

  test('head fixed frame spans the 85 mm frame depth', () => {
    const us = lxEdgeSection('head', 'fixed-frame').outline.map(([u]) => u)
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(85, 6)
  })

  test('glazing: ~107.4 mm sightline inset, depicted glass ~47 mm, slab keeps the choice', () => {
    expect(LX_PHI_GLAZING_TRACE.insetFromFrameFaceMm).toBeGreaterThan(107)
    expect(LX_PHI_GLAZING_TRACE.insetFromFrameFaceMm).toBeLessThan(108)
    expect(LX_PHI_GLAZING_TRACE.depictedGlassThicknessMm).toBeGreaterThan(46)
    expect(LX_PHI_GLAZING_TRACE.depictedGlassThicknessMm).toBeLessThan(48)
    const glass = lxWindowGlass(900, 1200, { model: 'E9-PTT85-PHI', glassThicknessMm: 51 })
    expect(glass.thickness).toBe(51)
    expect(glass.width).toBeCloseTo(900 - 2 * LX_PHI_GLAZING_TRACE.insetFromFrameFaceMm, 9)
  })

  test('mmmcraft messages; valid when closed casement', () => {
    expect(lxWindowError(lx())).toBeNull()
    expect(lxWindowError(WindowNode.parse({}))).toBeNull()
    expect(lxWindowError(lx({ width: 0.2 }))).toBe(
      '창틀 단면이 겹칩니다. 창호 표시 폭과 높이를 늘려 주세요.',
    )
    expect(lxWindowError(lx({ operationState: 0.5 }))).toBe(
      '이 시스템창호는 닫힌 상태만 지원합니다. 창호 모델을 다시 선택해 주세요.',
    )
    expect(lxWindowError(lx({ windowType: 'sliding' }))).toBe(
      '이 시스템창호는 닫힌 상태만 지원합니다. 창호 모델을 다시 선택해 주세요.',
    )
    expect(lxWindowError(lx({ openingKind: 'opening' }))).toBe(
      '창호 모델과 유리 두께를 다시 선택해 주세요.',
    )
  })

  test('the schema only restores catalogued models and glass', () => {
    expect(
      WindowNode.safeParse({ windowSystem: { model: 'E9-PTT85', glassThicknessMm: 51 } }).success,
    ).toBe(false)
    expect(
      WindowNode.safeParse({ windowSystem: { model: 'E9-PTT85-PHI', glassThicknessMm: 43 } })
        .success,
    ).toBe(false)
    expect(lxWindowSelectionUpdates(null)).toEqual({
      windowSystem: undefined,
      windowType: 'fixed',
      operationState: 0,
    })
  })

  test('vent size table is separate from the opening size', () => {
    expect(isPublishedVentSize(490, 490)).toBe(true)
    expect(isPublishedVentSize(1300, 1600)).toBe(true)
    expect(isPublishedVentSize(489, 490)).toBe(false)
    expect(isPublishedVentSize(1301, 1600)).toBe(false)
  })

  test('plan jambs sit inside the width and the 85 mm depth band', () => {
    const parts = lxWindowJambPlan(900)
    expect(parts.filter((p) => p.kind === 'fixed-frame')).toHaveLength(2)
    const fixed = parts.filter((p) => p.kind === 'fixed-frame').flatMap((p) => p.rings[0]!)
    expect(Math.max(...fixed.map(([x]) => Math.abs(x)))).toBeCloseTo(450, 6)
    expect(Math.min(...fixed.map(([, z]) => z))).toBeCloseTo(-42.5, 6)
    expect(Math.max(...fixed.map(([, z]) => z))).toBeCloseTo(42.5, 6)
  })
})
