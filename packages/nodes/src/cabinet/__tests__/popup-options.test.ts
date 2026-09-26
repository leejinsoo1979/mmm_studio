import { describe, expect, test } from 'bun:test'
import { cabinetBoringPanels } from '../engine/boring'
import { cabinetHingeBorings, cabinetPanelRows, cutlistCsv } from '../engine/cutlist'
import { hingeGapEdit, hingeGapEqualize, resolveDoorHinges } from '../engine/hinges'
import { buildCabinetParts, type CabinetPart } from '../engine/parts'
import {
  applyShelfGap,
  defaultRodShelfTopGapMm,
  gapsFromCentres,
  resetShelfGaps,
} from '../engine/shelf-gaps'
import { stoneHeightWarning, stoneThicknessPatch } from '../finish-updates'
import { backWallGapPatch, depthPatch, floatPatch, topMouldingPatch } from '../placement-updates'
import { applicableGroups, presetPatch, savePresetFrom } from '../preset-transfer'
import { CabinetNode } from '../schema'

const cabinet = (overrides: Record<string, unknown> = {}) => CabinetNode.parse(overrides)
const part = (parts: CabinetPart[], id: string) => {
  const p = parts.find((x) => x.id === id)
  if (!p) throw new Error(`missing ${id}`)
  return p
}
/** Rotation 0 faces +Z, so moving forward changes position[2] only. */
const z = (p: Partial<CabinetNode>) => Math.round((p.position?.[2] ?? 0) * 1e6) / 1e3

describe('걸레받이 옵셋 / 갭 / 폭확장', () => {
  test('옵셋 pushes back, 갭 is cut from the bottom, EPs narrow it', () => {
    const node = cabinet({
      family: 'base',
      widthMm: 600,
      heightMm: 850,
      depthMm: 560,
      toeKick: { enabled: true, heightMm: 105, setbackMm: 20, offsetMm: 10, gapMm: 5 },
      endPanels: { left: true, right: false },
    })
    const kick = part(buildCabinetParts(node).parts, 'toe-kick')
    expect(kick.box).toEqual({ x: 18, y: 5, z: 560 - 20 - 10 - 18, w: 582, h: 100, d: 18 })
    // Panel list shows the visible height.
    const row = cabinetPanelRows(node).find((r) => r.name === '걸레받이')
    expect([row?.lengthMm, row?.widthMm]).toEqual([582, 100])
  })

  test('폭확장 widens either end only while enabled', () => {
    const base = {
      family: 'base',
      widthMm: 600,
      toeKick: { widthAdjust: { enabled: true, leftMm: 30, rightMm: -10 } },
    }
    const kick = part(buildCabinetParts(cabinet(base)).parts, 'toe-kick')
    expect([kick.box.x, kick.box.w]).toEqual([-30, 620])
    const off = cabinet({ ...base, toeKick: { widthAdjust: { enabled: false, leftMm: 30 } } })
    expect(part(buildCabinetParts(off).parts, 'toe-kick').box.w).toBe(600)
  })
})

describe('상단몰딩', () => {
  test('sits on the carcass top flush with its front; 갭 comes off the top', () => {
    const node = cabinet({
      family: 'tall',
      widthMm: 900,
      heightMm: 2300,
      depthMm: 600,
      topMoulding: { enabled: true, heightMm: 40, offsetMm: 5, gapMm: 10 },
    })
    const m = part(buildCabinetParts(node).parts, 'top-moulding')
    expect(m.box).toEqual({ x: 0, y: 2300, z: 600 - 5 - 18, w: 900, h: 30, d: 18 })
    expect(m.material).toBe('PET')
  })

  test('off by default and never on base cabinets', () => {
    expect(buildCabinetParts(cabinet()).parts.some((p) => p.role === 'top-moulding')).toBe(false)
    const base = cabinet({ family: 'base', topMoulding: { enabled: true } })
    expect(buildCabinetParts(base).parts.some((p) => p.role === 'top-moulding')).toBe(false)
  })

  test('keeps the ceiling line: tall body shrinks, upper hangs lower', () => {
    const tall = cabinet({ family: 'tall', heightMm: 2300 })
    const on = { ...tall.topMoulding, enabled: true, heightMm: 30 }
    expect(topMouldingPatch(tall, on).heightMm).toBe(2270)
    const upper = cabinet({ family: 'upper', heightMm: 785, position: [0, 1.5, 0] })
    expect(topMouldingPatch(upper, { ...on })?.position?.[1]).toBeCloseTo(1.47, 9)
    // Offset-only edits move nothing.
    expect(topMouldingPatch(tall, { ...tall.topMoulding, offsetMm: 5 })).toEqual({
      topMoulding: { ...tall.topMoulding, offsetMm: 5 },
    })
  })
})

describe('뒷벽 이격 / 뒤고정 · 앞고정 / 띄움', () => {
  test('뒷벽 이격 moves the body by the positive part only', () => {
    const node = cabinet({ family: 'base' })
    expect(z(backWallGapPatch(node, 30))).toBe(30)
    expect(z(backWallGapPatch(node, -30))).toBe(0)
    expect(backWallGapPatch(node, -30).backWallGapMm).toBe(-30)
    // Upper cabinets keep their place.
    expect(z(backWallGapPatch(cabinet({ family: 'upper' }), 30))).toBe(0)
  })

  test('뒤고정 keeps the back face', () => {
    const node = cabinet({ family: 'base', depthMm: 600 })
    const p = depthPatch(node, 500)
    expect(z(p)).toBe(-50) // centre moves back half the change: back face unchanged
    expect(p.backWallGapMm).toBeUndefined()
  })

  test('앞고정 keeps the front face; the space behind becomes 뒷벽 이격', () => {
    const node = cabinet({ family: 'base', depthMm: 600, depthAnchor: 'front' })
    const shallower = depthPatch(node, 500)
    expect(z(shallower)).toBe(50)
    expect(shallower.backWallGapMm).toBe(100)
    // Deeper than the gap allows: the gap runs out and the front moves out.
    const deeper = depthPatch({ ...node, backWallGapMm: 20 }, 650)
    expect(deeper.backWallGapMm).toBe(0)
    expect(z(deeper)).toBe(5) // back −20, centre +25
  })

  test('띄움: base rises whole, tall keeps its top', () => {
    const base = cabinet({ family: 'base', heightMm: 850 })
    expect(floatPatch(base, 100)).toEqual({ position: [0, 0.1, 0] })
    const tall = cabinet({ family: 'tall', heightMm: 2300 })
    expect(floatPatch(tall, 100)).toEqual({ position: [0, 0.1, 0], heightMm: 2200 })
  })
})

describe('도어 · 경첩', () => {
  test('hinges move clear of a shelf by 50 mm', () => {
    expect(
      resolveDoorHinges({
        doorHeightMm: 700,
        doorBottomOnSideMm: 0,
        firstSideMm: 120,
        lastSideMm: 580,
        shelves: [{ bottomMm: 560, topMm: 578 }],
      }),
    ).toEqual([120, 510])
  })

  test('경첩 위치 변경 positions are side heights, clamped and re-avoided', () => {
    expect(
      resolveDoorHinges({
        doorHeightMm: 700,
        doorBottomOnSideMm: -5,
        firstSideMm: 120,
        lastSideMm: 580,
        shelves: [],
        customSideMm: [100, 400, 2000],
      }),
    ).toEqual([105, 405, 699])
  })

  test('gap edit: the nearest unlocked middle gap below absorbs; 등분 keeps locks', () => {
    // Door 1000 with hinges 100 / 500 / 900 from the top.
    const b = [0, 100, 500, 900, 1000]
    expect(hingeGapEdit(b, 1, 300)).toEqual([100, 400, 900])
    expect(hingeGapEdit(b, 1, 300, [2])).toEqual([100, 400, 800])
    expect(hingeGapEqualize(b)).toEqual([250, 500, 750])
    expect(hingeGapEqualize(b, [0])).toEqual([100, 400, 700])
  })

  test('도어 확장/축소 moves the edge away from the hinge', () => {
    const single = (mm: number) =>
      buildCabinetParts(
        cabinet({
          family: 'base',
          widthMm: 500,
          interior: {
            id: 'r',
            kind: 'leaf',
            content: { type: 'empty' },
            front: { type: 'door', leaves: '1', hinge: 'left' },
          },
          doorWidthAdjust: { enabled: true, mm },
        }),
      ).parts.find((p) => p.role === 'door')?.box
    // −1.5 is the unadjusted width (1.5 reveal each side).
    expect(single(-1.5)).toMatchObject({ x: 1.5, w: 497 })
    expect(single(20)).toMatchObject({ x: 1.5, w: 518.5 })
    const pair = buildCabinetParts(
      cabinet({ widthMm: 900, doorWidthAdjust: { enabled: true, mm: 0 } }),
    ).parts.filter((p) => p.role === 'door')
    // (897 − 3) / 2 = 447 each; the right leaf gains v + 3.
    expect(pair.map((p) => p.box.w)).toEqual([447, 450])
  })
})

describe('엔드패널 · 상판', () => {
  test('EP runs from body bottom − 하단 갭 to top + 상단 갭, offsets lengthen it', () => {
    const node = cabinet({
      family: 'tall',
      widthMm: 900,
      heightMm: 2300,
      depthMm: 600,
      endPanels: { left: true, right: false },
      topMoulding: { enabled: true, heightMm: 40 },
      endPanelOptions: { leftFrontMm: 10, leftBackMm: 5 },
    })
    const ep = part(buildCabinetParts(node).parts, 'end-panel-left')
    // Auto gaps: 65 toe kick below, 40 moulding above.
    expect(ep.box).toEqual({ x: 0, y: 0, z: -5, w: 18, h: 2340, d: 600 + 19 + 15 })
    expect(ep.name).toBe('엔드패널(좌)')
    // The moulding stops at the EP it runs alongside.
    expect(part(buildCabinetParts(node).parts, 'top-moulding').box.x).toBe(18)
  })

  test('over 18 mm the EP is a ㄷ frame; 외치 adds it outside the width', () => {
    const node = cabinet({
      widthMm: 900,
      endPanels: { left: false, right: true },
      endPanelOptions: { thicknessMm: 40, mode: 'outside' },
    })
    const parts = buildCabinetParts(node).parts
    const eps = parts.filter((p) => p.role === 'end-panel')
    expect(eps.map((p) => p.name)).toEqual(['EP(우)측판', 'EP(우)전면연결판', 'EP(우)후면연결판'])
    expect(eps.map((p) => [p.box.x, p.box.w])).toEqual([
      [922, 18],
      [900, 22],
      [900, 22],
    ])
    // 외치: the carcass keeps the full width.
    expect(part(parts, 'side-right').box.x).toBe(900 - 18)
  })

  test('하부 EP under an upper, 상부 EP on a base', () => {
    const upper = cabinet({
      family: 'upper',
      widthMm: 600,
      depthMm: 300,
      bottomEndPanel: { enabled: true },
    })
    expect(part(buildCabinetParts(upper).parts, 'bottom-end-panel').box).toEqual({
      x: 0,
      y: -18,
      z: 35,
      w: 600,
      h: 18,
      d: 265,
    })
    const base = cabinet({
      family: 'base',
      widthMm: 600,
      depthMm: 560,
      heightMm: 850,
      topEndPanel: { enabled: true, backLip: { heightMm: 100, thicknessMm: 18 } },
    })
    const parts = buildCabinetParts(base).parts
    expect(part(parts, 'top-end-panel').box).toEqual({ x: 0, y: 850, z: 0, w: 600, h: 18, d: 580 })
    expect(part(parts, 'top-end-panel-lip').box).toMatchObject({ y: 868, h: 100, d: 18 })
  })

  test('인조대리석: body keeps the total, first install overhangs 23, not in the CSV', () => {
    const base = cabinet({ family: 'base', heightMm: 850 })
    const p20 = stoneThicknessPatch(base, 20)
    expect([p20.heightMm, p20.stoneTop?.frontMm]).toEqual([850, 23])
    const on = { ...base, ...p20 } as CabinetNode
    expect(stoneThicknessPatch(on, 30).heightMm).toBe(840)
    expect(stoneThicknessPatch(on, 0).stoneTop).toEqual({
      thicknessMm: 0,
      frontMm: 0,
      backMm: 0,
      leftMm: 0,
      rightMm: 0,
      backLip: null,
    })
    expect(stoneHeightWarning(on)).toBe('⚠ 총 높이 805mm (본체 785 + 상판 20) — 800mm 초과')
    expect(part(buildCabinetParts(on).parts, 'stone-top').box).toMatchObject({ y: 850, h: 20 })
    expect(cabinetPanelRows(on).some((r) => r.name === '인조대리석 상판')).toBe(true)
    expect(cutlistCsv([{ node: on, label: 'x' }])).not.toContain('인조대리석')
  })

  test('상판 따내기 marks the upper top panel', () => {
    const upper = cabinet({
      family: 'upper',
      widthMm: 900,
      depthMm: 300,
      topNotch: { widthMm: 680, side: 'left' },
    })
    expect(part(buildCabinetParts(upper).parts, 'top').cornerNotch).toEqual({
      width: 680,
      depth: 140,
      side: 'left',
    })
    expect(cabinetPanelRows(upper).find((r) => r.name === '상판')?.notes).toBe('따내기 680×140(좌)')
  })
})

describe('선반 설정', () => {
  test('칸 내경 follows mmmcraft PlacedModulePropertiesPanel.shelfGap.test', () => {
    // 상부장 inner 749, two 18 mm shelves at 247 / 502 → 238 / 237 / 238.
    expect(gapsFromCentres([247, 502], 749, 18)).toEqual([238, 237, 238])
    // 칸 1 is the top compartment.
    expect(gapsFromCentres([200, 550], 749, 18).at(-1)).toBe(190)
    // Typing 200 into 칸 1 (the top gap).
    expect(applyShelfGap(749, 2, 18, 2, 200)).toEqual([266, 540])
    const reset = resetShelfGaps(749, 2, 18)
    expect(gapsFromCentres(reset, 749, 18)).toEqual([239, 237, 237])
  })

  test('shelf centres drive the parts; extra dowels add ±32 rows on the sides', () => {
    const node = cabinet({
      family: 'upper',
      widthMm: 600,
      heightMm: 785,
      depthMm: 300,
      interior: {
        id: 'r',
        kind: 'leaf',
        content: {
          type: 'shelves',
          count: 2,
          kind: 'dowel',
          positionsMm: [266, 540],
          extraDowels: 1,
        },
      },
    })
    const build = buildCabinetParts(node)
    const rect = build.leaves[0]?.rect
    const shelves = build.parts.filter((p) => p.role === 'shelf')
    expect(shelves.map((p) => p.box.y - (rect?.y0 ?? 0) + 9)).toEqual([266, 540])
    const side = cabinetBoringPanels(node, 'u').find((p) => p.panelType === 'side-left')
    const pins = side?.borings.filter((b) => b.note === 'movable-shelf-pin') ?? []
    // Two shelves × (1 + 2 extra rows) × 2 depth rows.
    expect(pins).toHaveLength(12)
  })

  test('옷봉선반: a fixed shelf under the top, the rod 55 below it', () => {
    const node = cabinet({
      widthMm: 900,
      heightMm: 2300,
      interior: {
        id: 'r',
        kind: 'leaf',
        content: { type: 'hanging', rod: 'rod', shelfTopGapMm: 100 },
      },
    })
    const build = buildCabinetParts(node)
    const top = build.leaves[0]?.rect.y1 ?? 0
    const shelf = part(build.parts, 'rod-shelf-r')
    expect([shelf.name, shelf.box.y]).toEqual(['옷봉선반', top - 100 - 18])
    const rod = part(build.parts, 'rod-r')
    expect(rod.box.y + rod.box.h / 2).toBe(shelf.box.y - 55)
    expect(defaultRodShelfTopGapMm(2134, 18)).toBe(191)
  })
})

describe('속성 저장 / 이식 · 패널 목록', () => {
  test('copies the chosen groups; never width or position; interior only between the same preset', () => {
    const source = cabinet({
      family: 'base',
      presetId: 'lower-half-cabinet',
      widthMm: 800,
      depthMm: 520,
      bodyColor: '#123456',
      toeKick: { heightMm: 105, offsetMm: 12 },
      backWallGapMm: 40,
    })
    const preset = savePresetFrom(source)
    const other = cabinet({ family: 'base', presetId: 'lower-sink-cabinet', widthMm: 600 })
    expect(applicableGroups(other, preset)).not.toContain('shelfRod')
    const patch = presetPatch(other, preset, [
      'depth',
      'topBottom',
      'backPanel',
      'materialColor',
      'shelfRod',
    ])
    expect(patch.widthMm).toBeUndefined()
    expect(patch.interior).toBeUndefined()
    expect([patch.depthMm, patch.toeKick?.offsetMm, patch.bodyColor]).toEqual([520, 12, '#123456'])
    // 뒷벽 이격 arrives as a move of the body.
    expect(z(patch)).toBe(40)
    const same = cabinet({ family: 'base', presetId: 'lower-half-cabinet' })
    const withInterior = presetPatch(same, preset, ['shelfRod'])
    expect(withInterior.interior?.kind).toBe(source.interior.kind)
    expect(withInterior.interior?.id).not.toBe(source.interior.id)
  })

  test('unticked panels leave the cut list and MPR; 보링숨김 drops door cups', () => {
    const node = cabinet({
      widthMm: 500,
      panelExclusions: ['뒷판'],
      hingeBoringExclusions: ['도어'],
    })
    expect(cutlistCsv([{ node, label: 'x' }])).not.toContain('뒷판')
    const panels = cabinetBoringPanels(node, 'x')
    expect(panels.some((p) => p.panelName === '뒷판')).toBe(false)
    const door = panels.find((p) => p.panelName === '도어')
    expect(door?.borings.filter((b) => b.type === 'hinge-cup')).toEqual([])
    expect(cabinetHingeBorings(node)).toEqual([])
  })

  test('grain follows mmmcraft names unless overridden', () => {
    const node = cabinet({ widthMm: 500, panelGrain: { 좌측판: 'horizontal' } })
    const rows = cabinetPanelRows(node)
    expect(rows.find((r) => r.name === '좌측판')?.grain).toBe('horizontal')
    expect(rows.find((r) => r.name === '우측판')?.grain).toBe('vertical')
    expect(rows.find((r) => r.name === '도어')?.grain).toBe('vertical')
    expect(rows.find((r) => r.name === '바닥판')?.grain).toBe('horizontal')
  })
})

test('a cabinet saved before these options builds with their defaults', () => {
  const saved = cabinet({ family: 'base', widthMm: 600 }) as Record<string, unknown>
  for (const k of [
    'endPanelOptions',
    'topMoulding',
    'stoneTop',
    'doorWidthAdjust',
    'panelExclusions',
  ])
    delete saved[k]
  delete (saved.toeKick as Record<string, unknown>).offsetMm
  const parts = buildCabinetParts(saved as unknown as CabinetNode).parts
  expect(part(parts, 'toe-kick').box.w).toBe(600)
})
