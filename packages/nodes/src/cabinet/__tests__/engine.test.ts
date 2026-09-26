import { describe, expect, test } from 'bun:test'
import {
  cabinetHardwareRows,
  cabinetHingeBorings,
  cabinetPanelRows,
  cutlistCsv,
} from '../engine/cutlist'
import { buildCabinetParts, type CabinetPart } from '../engine/parts'
import { CABINET_PRESETS, instantiateSpec } from '../engine/presets'
import { hingePositionsMm } from '../engine/rules'
import { equalSlotWidths, planKitchenRun } from '../engine/run'
import {
  findCell,
  mergeCell,
  removeCell,
  setCellContent,
  setCellFront,
  setCellHasBack,
  setCellSize,
  setSplitJoint,
  splitCell,
} from '../engine/tree'
import { type CabinetCell, CabinetNode } from '../schema'

function cabinet(overrides: Partial<CabinetNode> = {}): CabinetNode {
  return CabinetNode.parse({ ...overrides })
}

function byId(parts: CabinetPart[], id: string): CabinetPart {
  const part = parts.find((p) => p.id === id)
  if (!part) throw new Error(`missing part ${id}`)
  return part
}

describe('carcass', () => {
  // Same numbers as the mmmcraft planning worked example (W1000 D600 H2400,
  // toe kick 65): sides 18×600×2335, top/bottom 963×574×18, back 977×9×2334.
  test('matches the mmmcraft factory example', () => {
    const { parts, issues } = buildCabinetParts(
      cabinet({
        widthMm: 1000,
        depthMm: 600,
        heightMm: 2400,
        toeKick: { enabled: true, heightMm: 65, setbackMm: 20 },
      }),
    )
    expect(issues).toEqual([])
    const left = byId(parts, 'side-left')
    expect([left.box.w, left.box.h, left.box.d]).toEqual([18, 2335, 600])
    expect(left.box.y).toBe(65)
    for (const id of ['bottom', 'top']) {
      const p = byId(parts, id)
      expect([p.box.w, p.box.d, p.box.h]).toEqual([963, 574, 18])
      expect(p.box.x).toBe(18.5)
    }
    const back = byId(parts, 'back')
    expect([back.box.w, back.box.d, back.box.h]).toEqual([977, 9, 2334])
    expect(back.material).toBe('MDF')
    // 7 mm into each side groove (6.5 + 0.5 clearance on the left).
    expect(back.box.x).toBe(11.5)
    expect(back.box.x + back.box.w).toBe(988.5)
  })

  test('end panels keep the overall width', () => {
    const { parts } = buildCabinetParts(
      cabinet({ widthMm: 900, endPanels: { left: true, right: true } }),
    )
    expect(byId(parts, 'side-left').box.x).toBe(18)
    const right = byId(parts, 'side-right')
    expect(right.box.x + right.box.w).toBe(882)
    expect(byId(parts, 'end-panel-right').box.x).toBe(882)
  })

  test('toe kick and four feet', () => {
    const { parts } = buildCabinetParts(cabinet({ depthMm: 600 }))
    const toe = byId(parts, 'toe-kick')
    expect(toe.material).toBe('PET')
    expect(toe.box.z + toe.box.d).toBe(580)
    expect(parts.filter((p) => p.role === 'foot')).toHaveLength(4)
  })
})

describe('fronts', () => {
  test('single door is the carcass minus the 1.5 mm reveals', () => {
    const { parts } = buildCabinetParts(cabinet({ widthMm: 600 }))
    const doors = parts.filter((p) => p.role === 'door')
    expect(doors).toHaveLength(1)
    expect(doors[0]?.box.w).toBe(597)
    expect(doors[0]?.box.h).toBe(2300 - 65 - 3)
  })

  test('wider than 600 gets two leaves of W/2 − 3', () => {
    const { parts } = buildCabinetParts(cabinet({ widthMm: 900 }))
    const doors = parts.filter((p) => p.role === 'door')
    expect(doors.map((d) => d.box.w)).toEqual([447, 447])
    expect(doors.map((d) => d.hinge)).toEqual(['left', 'right'])
    const gap = (doors[1]?.box.x ?? 0) - ((doors[0]?.box.x ?? 0) + (doors[0]?.box.w ?? 0))
    expect(gap).toBe(3)
  })

  test('hinge rule: count by leaf length, 120 mm from the ends', () => {
    expect(hingePositionsMm(700)).toEqual([120, 580])
    expect(hingePositionsMm(1200)).toHaveLength(3)
    expect(hingePositionsMm(2237)).toEqual([120, 785.7, 1451.3, 2117])
    expect(hingePositionsMm(2400)).toHaveLength(5)
    const borings = cabinetHingeBorings(cabinet({ widthMm: 600 }))
    expect(borings[0]?.cups[0]).toEqual({ x: 22.5, y: 120 })
  })

  test('side-by-side doors meet on the divider centre with a 3 mm gap', () => {
    const interior: CabinetCell = {
      id: 'root',
      kind: 'split',
      axis: 'x',
      sizesMm: [null, null],
      children: [
        {
          id: 'a',
          kind: 'leaf',
          content: { type: 'empty' },
          front: { type: 'door', leaves: 'auto', hinge: 'auto' },
        },
        {
          id: 'b',
          kind: 'leaf',
          content: { type: 'empty' },
          front: { type: 'door', leaves: 'auto', hinge: 'auto' },
        },
      ],
    }
    const { parts } = buildCabinetParts(cabinet({ widthMm: 1200, interior }))
    const divider = parts.find((p) => p.role === 'divider')
    expect(divider).toBeDefined()
    const doors = parts.filter((p) => p.role === 'door')
    expect(doors).toHaveLength(2)
    const centre = (divider?.box.x ?? 0) + 9
    expect((doors[0]?.box.x ?? 0) + (doors[0]?.box.w ?? 0)).toBe(centre - 1.5)
    expect(doors[1]?.box.x).toBe(centre + 1.5)
    // Hinges on the outer edges.
    expect(doors.map((d) => d.hinge)).toEqual(['left', 'right'])
  })

  test('a door over external drawers is dropped with an issue', () => {
    const interior: CabinetCell = {
      id: 'root',
      kind: 'leaf',
      content: { type: 'drawers', count: 3, style: 'external', stepMm: 250 },
      front: { type: 'door', leaves: 'auto', hinge: 'auto' },
    }
    const { parts, issues } = buildCabinetParts(
      cabinet({ family: 'base', heightMm: 845, interior }),
    )
    expect(parts.filter((p) => p.role === 'door')).toHaveLength(0)
    expect(parts.filter((p) => p.role === 'drawer-front')).toHaveLength(3)
    expect(issues.some((i) => i.includes('겉서랍'))).toBe(true)
  })
})

describe('interior', () => {
  test('y-split puts a fixed shelf between compartments', () => {
    const interior: CabinetCell = {
      id: 'root',
      kind: 'split',
      axis: 'y',
      sizesMm: [null, 300],
      children: [
        { id: 'low', kind: 'leaf', content: { type: 'hanging', rod: 'rod' } },
        { id: 'top', kind: 'leaf', content: { type: 'empty' } },
      ],
      front: { type: 'door', leaves: 'auto', hinge: 'auto' },
    }
    const build = buildCabinetParts(cabinet({ interior }))
    const fixed = build.parts.filter((p) => p.role === 'fixed-shelf')
    expect(fixed).toHaveLength(1)
    expect(build.cellRects.get('top')?.y1).toBe(2300 - 18)
    const top = build.cellRects.get('top')
    expect((top?.y1 ?? 0) - (top?.y0 ?? 0)).toBe(300)
    const rod = build.parts.find((p) => p.role === 'rod')
    expect(rod?.cellId).toBe('low')
  })

  test('dowel shelves are evenly spaced and inset from the front', () => {
    const { parts, interior } = buildCabinetParts(
      cabinet({
        interior: {
          id: 'root',
          kind: 'leaf',
          content: { type: 'shelves', count: 3, kind: 'dowel' },
        },
      }),
    )
    const shelves = parts.filter((p) => p.role === 'shelf')
    expect(shelves).toHaveLength(3)
    const gaps = [
      (shelves[0]?.box.y ?? 0) - interior.y0,
      (shelves[1]?.box.y ?? 0) - ((shelves[0]?.box.y ?? 0) + 18),
      interior.y1 - ((shelves[2]?.box.y ?? 0) + 18),
    ]
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.2)
    expect(shelves[0]?.box.d).toBe(600 - 26 - 20)
  })

  test('inner drawers are clamped to what fits and pick a runner', () => {
    const interior: CabinetCell = {
      id: 'root',
      kind: 'split',
      axis: 'y',
      sizesMm: [500, null],
      children: [
        {
          id: 'd',
          kind: 'leaf',
          content: { type: 'drawers', count: 4, style: 'inner', stepMm: 200 },
        },
        { id: 'h', kind: 'leaf', content: { type: 'hanging', rod: 'rod' } },
      ],
    }
    const { parts, issues } = buildCabinetParts(cabinet({ interior }))
    const fronts = parts.filter((p) => p.role === 'drawer-front')
    // (500 − 24) / (200 + 24) → 2 drawers.
    expect(fronts).toHaveLength(2)
    expect(issues.some((i) => i.includes('2개만'))).toBe(true)
    // D − 26 − 17 − 9 − 85 = 463 → 450 runner, sides 476 deep.
    const side = parts.find((p) => p.role === 'drawer-side')
    expect(side?.box.d).toBe(476)
  })
})

describe('kitchen variants', () => {
  test('base cabinets use top bands and only the upper rear rail', () => {
    const { parts } = buildCabinetParts(cabinet({ family: 'base', heightMm: 845 }))
    expect(parts.some((p) => p.role === 'top')).toBe(false)
    expect(parts.filter((p) => p.role === 'top-band')).toHaveLength(2)
    expect(parts.filter((p) => p.role === 'rear-rail').map((p) => p.id)).toEqual(['rear-rail-top'])
  })

  test('sink cabinet: no back, front stretcher instead of the front band', () => {
    const { parts } = buildCabinetParts(cabinet({ family: 'base', variant: 'sink', heightMm: 845 }))
    expect(parts.some((p) => p.role === 'back')).toBe(false)
    const rail = byId(parts, 'front-rail')
    expect(rail.box.h).toBe(150)
    expect(parts.filter((p) => p.role === 'top-band')).toHaveLength(1)
  })

  test('dishwasher housing has no bottom, back or toe kick', () => {
    const { parts } = buildCabinetParts(
      cabinet({
        family: 'base',
        variant: 'dishwasher',
        heightMm: 845,
        interior: {
          id: 'root',
          kind: 'leaf',
          content: { type: 'empty' },
          front: { type: 'panel', leaves: '1', hinge: 'auto' },
        },
      }),
    )
    for (const role of ['bottom', 'back', 'toe-kick', 'foot'] as const) {
      expect(parts.some((p) => p.role === role)).toBe(false)
    }
    expect(byId(parts, 'side-left').box.y).toBe(0)
    expect(parts.some((p) => p.role === 'appliance')).toBe(true)
  })

  test('upper cabinets: no toe kick, doors are H + 5 + 28', () => {
    const preset = CABINET_PRESETS.find((p) => p.id === 'upper-cabinet-shelf')
    const node = cabinet(instantiateSpec(preset?.spec() as never))
    const { parts } = buildCabinetParts(node)
    expect(parts.some((p) => p.role === 'toe-kick')).toBe(false)
    const upperDoor = parts.find((p) => p.role === 'door')
    expect(upperDoor?.box.y).toBe(-28)
    expect(upperDoor?.box.h).toBe(785 + 5 + 28)
  })
})

describe('presets', () => {
  test.each(CABINET_PRESETS.map((p) => [p.id, p] as const))('%s builds cleanly', (_id, preset) => {
    const node = cabinet({ ...instantiateSpec(preset.spec()) })
    const { parts, issues } = buildCabinetParts(node)
    expect(issues).toEqual([])
    expect(parts.length).toBeGreaterThan(4)
    for (const part of parts) {
      expect(part.box.w).toBeGreaterThan(0)
      expect(part.box.h).toBeGreaterThan(0)
      expect(part.box.d).toBeGreaterThan(0)
    }
  })

  test.each(
    CABINET_PRESETS.map((p) => [p.id, p] as const),
  )('%s spec has unique cell ids before instantiation (thumbnails use it raw)', (_id, preset) => {
    const ids: string[] = []
    const walk = (c: CabinetCell) => {
      ids.push(c.id)
      if (c.kind === 'split') c.children.forEach(walk)
    }
    walk(preset.spec().interior)
    expect(new Set(ids).size).toBe(ids.length)
    const partIds = buildCabinetParts(cabinet(preset.spec())).parts.map((p) => p.id)
    expect(new Set(partIds).size).toBe(partIds.length)
  })

  test('instantiated presets get fresh unique cell ids', () => {
    const preset = CABINET_PRESETS.find((p) => p.id === 'dual-2drawer-styler')
    const spec = instantiateSpec(preset?.spec() as never)
    const ids: string[] = []
    const walk = (c: CabinetCell) => {
      ids.push(c.id)
      if (c.kind === 'split') c.children.forEach(walk)
    }
    walk(spec.interior)
    expect(ids[0]).toBe('root')
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('tree edits', () => {
  const base: CabinetCell = {
    id: 'root',
    kind: 'leaf',
    content: { type: 'shelves', count: 2, kind: 'dowel' },
    front: { type: 'door', leaves: 'auto', hinge: 'auto' },
  }

  test('split keeps the front on the new split and content in the parts', () => {
    const split = splitCell(base, 'root', 'x', 2)
    expect(split.kind).toBe('split')
    expect(split.front?.type).toBe('door')
    if (split.kind !== 'split') throw new Error('expected split')
    expect(split.children.every((c) => c.kind === 'leaf' && c.content.type === 'shelves')).toBe(
      true,
    )
    expect(split.children.every((c) => !c.front)).toBe(true)
  })

  test('splitting a child along the parent axis adds siblings', () => {
    const split = splitCell(base, 'root', 'y', 2)
    if (split.kind !== 'split') throw new Error('expected split')
    const again = splitCell(split, split.children[0]?.id ?? '', 'y', 2)
    if (again.kind !== 'split') throw new Error('expected split')
    expect(again.children).toHaveLength(3)
    expect(again.sizesMm).toHaveLength(3)
  })

  test('merge and remove collapse back to a leaf', () => {
    const split = splitCell(base, 'root', 'x', 3)
    expect(mergeCell(split, 'root').kind).toBe('leaf')
    if (split.kind !== 'split') throw new Error('expected split')
    const one = removeCell(
      removeCell(split, split.children[0]?.id ?? ''),
      split.children[1]?.id ?? '',
    )
    expect(one.kind).toBe('leaf')
    expect(one.id).toBe('root')
    expect(one.front?.type).toBe('door')
  })

  test('content, size and front edits', () => {
    const split = splitCell(base, 'root', 'y', 2)
    if (split.kind !== 'split') throw new Error('expected split')
    const childId = split.children[1]?.id ?? ''
    const withContent = setCellContent(split, childId, { type: 'hanging', rod: 'rod' })
    const child = findCell(withContent, childId)
    expect(child?.kind === 'leaf' && child.content.type).toBe('hanging')
    const sized = setCellSize(withContent, childId, 400)
    expect(sized.kind === 'split' && sized.sizesMm).toEqual([null, 400])
    const perChild = setCellFront(setCellFront(sized, 'root', null), childId, {
      type: 'flap',
      leaves: '1',
      hinge: 'auto',
    })
    expect(perChild.front).toBeUndefined()
    expect(findCell(perChild, childId)?.front?.type).toBe('flap')
    // Setting a front on the root clears fronts below it.
    const cleared = setCellFront(perChild, 'root', { type: 'door', leaves: 'auto', hinge: 'auto' })
    expect(findCell(cleared, childId)?.front).toBeUndefined()
  })

  test('fixed sizes that do not fit are scaled with an issue', () => {
    const interior: CabinetCell = {
      id: 'root',
      kind: 'split',
      axis: 'x',
      sizesMm: [500, 500],
      children: [
        { id: 'a', kind: 'leaf', content: { type: 'empty' } },
        { id: 'b', kind: 'leaf', content: { type: 'empty' } },
      ],
    }
    const { issues, cellRects } = buildCabinetParts(cabinet({ widthMm: 600, interior }))
    expect(issues.length).toBeGreaterThan(0)
    const a = cellRects.get('a')
    const b = cellRects.get('b')
    expect(Math.abs((a?.x1 ?? 0) - (a?.x0 ?? 0) - ((b?.x1 ?? 0) - (b?.x0 ?? 0)))).toBeLessThan(0.01)
  })
})

describe('runs', () => {
  test('equal division matches the Configurator (3516 → 6 × 586)', () => {
    expect(equalSlotWidths(3516)).toEqual([586, 586, 586, 586, 586, 586])
    expect(equalSlotWidths(350)).toEqual([])
    const odd = equalSlotWidths(1001)
    expect(odd.reduce((a, b) => a + b, 0)).toBe(1001)
    expect(odd.every((w) => w >= 400 && w <= 600)).toBe(true)
  })

  test('kitchen run fills the length exactly and skips the hood gap', () => {
    const plan = planKitchenRun({ lengthMm: 3000, dishwasher: true })
    const total = plan.base.reduce((a, m) => a + m.widthMm, 0)
    expect(total + plan.leftoverMm).toBe(3000)
    expect(plan.base.map((m) => m.presetId)).toContain('lower-sink-cabinet')
    const cooktop = plan.base.find((m) => m.presetId === 'lower-induction-cabinet')
    expect(cooktop).toBeDefined()
    for (const u of plan.upper) {
      const overlaps =
        u.offsetMm < (cooktop?.offsetMm ?? 0) + (cooktop?.widthMm ?? 0) &&
        u.offsetMm + u.widthMm > (cooktop?.offsetMm ?? 0)
      expect(overlaps).toBe(false)
    }
    expect(plan.countertop.sink?.centerMm).toBe(450)
  })
})

describe('panel list', () => {
  test('merges identical panels and exports CSV', () => {
    const node = cabinet({ widthMm: 900, name: '옷장' })
    const rows = cabinetPanelRows(node)
    const sides = rows.find((r) => r.name === '좌측판')
    expect(sides).toMatchObject({ thicknessMm: 18, lengthMm: 2235, widthMm: 600, quantity: 1 })
    const doors = rows.find((r) => r.name.startsWith('양문'))
    expect(doors?.material).toBe('PET')
    const csv = cutlistCsv([{ node, label: '옷장' }])
    expect(csv.startsWith('﻿가구,부재,재질,두께,길이,폭,수량,비고')).toBe(true)
    expect(csv).toContain('옷장,뒷판,MDF,9')
    const hardware = cabinetHardwareRows(node)
    expect(hardware.find((h) => h.name === '경첩')?.quantity).toBe(8)
  })
})

describe('stacked bodies (mmmcraft 하부장 / 상부장)', () => {
  const coat = () => {
    const preset = CABINET_PRESETS.find((p) => p.id === 'single-2drawer-hanging')
    return cabinet(instantiateSpec(preset?.spec() as never))
  }

  test('each section is its own carcass with split sides and two joint panels', () => {
    const node = coat()
    const { parts, issues } = buildCabinetParts(node)
    expect(issues).toEqual([])
    const names = parts.filter((p) => p.isPanel).map((p) => p.name)
    for (const name of [
      '(하)좌측',
      '(하)우측',
      '(상)좌측',
      '(상)우측',
      '(하)바닥',
      '(하)상판',
      '(상)바닥',
      '(상)상판',
      '(하)뒷판',
      '(상)뒷판',
    ]) {
      expect(names).toContain(name)
    }
    expect(names).not.toContain('좌측판')
    const lowerSide = parts.find((p) => p.name === '(하)좌측')
    const upperSide = parts.find((p) => p.name === '(상)좌측')
    // mmmcraft section height 600 is the whole lower body.
    expect(lowerSide?.box.y).toBe(65)
    expect(lowerSide?.box.h).toBe(600)
    expect(upperSide?.box.y).toBe(665)
    expect(upperSide?.box.h).toBe(2300 - 65 - 600)
    const lowerTop = parts.find((p) => p.name === '(하)상판')
    const upperBottom = parts.find((p) => p.name === '(상)바닥')
    expect(lowerTop?.box.y).toBe(665 - 18)
    expect(upperBottom?.box.y).toBe(665)
    // One full-height door over both bodies.
    const doors = parts.filter((p) => p.role === 'door')
    expect(doors).toHaveLength(1)
    expect(doors[0]?.box.h).toBe(2300 - 65 - 3)
  })

  test('drawer fronts follow mmmcraft heights, gap below each', () => {
    const preset = CABINET_PRESETS.find((p) => p.id === 'single-4drawer-hanging')
    const { parts, issues } = buildCabinetParts(cabinet(instantiateSpec(preset?.spec() as never)))
    expect(issues).toEqual([])
    const fronts = parts.filter((p) => p.role === 'drawer-front').sort((a, b) => a.box.y - b.box.y)
    expect(fronts.map((f) => f.box.h)).toEqual([255, 255, 176, 176])
    // Lower body clear starts at 65 + 18; first gap 24.
    expect(fronts[0]?.box.y).toBe(65 + 18 + 24)
    expect((fronts[1]?.box.y ?? 0) - ((fronts[0]?.box.y ?? 0) + 255)).toBe(24)
  })

  test('a section can drop its back (냉장고장 fridge space)', () => {
    const preset = CABINET_PRESETS.find((p) => p.id === 'single-fridge-cabinet')
    const { parts } = buildCabinetParts(cabinet(instantiateSpec(preset?.spec() as never)))
    const backs = parts.filter((p) => p.role === 'back').map((p) => p.name)
    expect(backs).toEqual(['(상)뒷판'])
  })

  test('18.5 mm board has no side clearance on horizontal panels', () => {
    const { parts } = buildCabinetParts(cabinet({ widthMm: 600, panelThicknessMm: 18.5 }))
    const bottom = parts.find((p) => p.role === 'bottom')
    expect(bottom?.box.w).toBe(600 - 37)
    expect(bottom?.box.x).toBe(18.5)
  })

  test('joint and back toggles', () => {
    const node = coat()
    const unstacked = setSplitJoint(node.interior, 'root', 'shelf')
    const flat = buildCabinetParts({ ...node, interior: unstacked })
    expect(flat.parts.some((p) => p.name === '좌측판')).toBe(true)
    expect(flat.parts.some((p) => p.name === '(하)좌측')).toBe(false)
    if (node.interior.kind !== 'split') throw new Error('expected split')
    const lowerId = node.interior.children[0]?.id ?? ''
    const noBack = setCellHasBack(node.interior, lowerId, false)
    const built = buildCabinetParts({ ...node, interior: noBack })
    expect(built.parts.filter((p) => p.role === 'back').map((p) => p.name)).toEqual(['(상)뒷판'])
  })
})

test('바지걸이장 is two bodies: drawers | pants below, hanging above', () => {
  const preset = CABINET_PRESETS.find((p) => p.id === 'dual-4drawer-pantshanger')
  const node = cabinet(instantiateSpec(preset?.spec() as never))
  const { parts, issues, leaves } = buildCabinetParts(node)
  expect(issues).toEqual([])
  expect(parts.find((p) => p.name === '(하)좌측')?.box.h).toBe(1000)
  const pants = leaves.find((l) => l.content.type === 'hanging' && l.content.rod === 'pants')
  expect((pants?.rect.x1 ?? 0) - (pants?.rect.x0 ?? 0)).toBe(586)
  expect(parts.filter((p) => p.role === 'drawer-front').map((p) => p.box.h)).toEqual([
    255, 255, 176, 176,
  ])
  expect(parts.filter((p) => p.role === 'door')).toHaveLength(2)
})

test('no preset has handles (mmmcraft fronts are handleless)', () => {
  for (const preset of CABINET_PRESETS) {
    const { parts } = buildCabinetParts(cabinet(instantiateSpec(preset.spec())))
    expect(parts.filter((p) => p.name === '손잡이').map((p) => preset.id)).toEqual([])
  }
})

describe('목찬넬 kitchen bases (mmmcraft numbers, body 785 on 65)', () => {
  const build = (id: string) => {
    const preset = CABINET_PRESETS.find((p) => p.id === id)
    if (!preset) throw new Error(`missing preset ${id}`)
    return buildCabinetParts(cabinet(instantiateSpec(preset.spec())))
  }
  const byName = (parts: CabinetPart[], name: string) => parts.find((p) => p.name === name)

  test('기본하부장: open top, 60×40 top channel, door 785 − 20 + 5', () => {
    const { parts, issues } = build('lower-half-cabinet')
    expect(issues).toEqual([])
    expect(parts.some((p) => p.role === 'top' || p.role === 'top-band')).toBe(false)
    expect(byName(parts, '좌측판')?.notches).toEqual([{ fromBottom: 725, height: 60, depth: 40 }])
    expect(byName(parts, '가로전대1')?.box.h).toBe(60)
    expect(byName(parts, '목찬넬프레임수직1')?.box.h).toBe(42)
    const door = parts.find((p) => p.role === 'door')
    expect(door?.box.h).toBe(770)
    expect(door?.box.y).toBe(60)
  })

  test('싱크장: the rail behind the top channel is 150', () => {
    const { parts } = build('lower-sink-cabinet')
    expect(byName(parts, '가로전대1')?.box.h).toBe(150)
    expect(parts.some((p) => p.role === 'back')).toBe(false)
  })

  test('도어올림 2단: 355 channel, fronts 400 / 400 rising 30 above the carcass', () => {
    const { parts, issues } = build('lower-door-lift-2tier')
    expect(issues).toEqual([])
    expect(byName(parts, '상판')).toBeDefined()
    expect(byName(parts, '좌측판')?.notches).toEqual([{ fromBottom: 355, height: 65, depth: 40 }])
    const frame = byName(parts, '목찬넬프레임수평1')
    expect([frame?.box.w, frame?.box.d, frame?.box.h, frame?.material]).toEqual([
      600,
      40,
      18,
      'PET',
    ])
    expect(frame?.box.y).toBe(65 + 355)
    expect(byName(parts, '목찬넬프레임수직1')?.box.h).toBe(47)
    const fronts = parts.filter((p) => p.role === 'drawer-front').sort((a, b) => a.box.y - b.box.y)
    expect(fronts.map((f) => [f.box.y - 65, f.box.y - 65 + f.box.h])).toEqual([
      [-5, 395],
      [415, 815],
    ])
  })

  test.each([
    [
      'lower-drawer-3tier',
      [295, 510, 725],
      [
        [-5, 335],
        [355, 550],
        [570, 765],
      ],
      [
        [33, 240],
        [375, 130],
        [590, 130],
      ],
    ],
    [
      'lower-drawer-2tier',
      [330, 725],
      [
        [-5, 370],
        [390, 765],
      ],
      [
        [33, 240],
        [410, 240],
      ],
    ],
  ])('%s: mmmcraft channels, fronts and boxes', (id, notches, fronts, boxes) => {
    const { parts, issues } = build(id)
    expect(issues).toEqual([])
    expect(byName(parts, '좌측판')?.notches?.map((n) => n.fromBottom)).toEqual(notches)
    const fromBody = (p: CabinetPart) => [p.box.y - 65, p.box.y - 65 + p.box.h]
    const drawerFronts = parts
      .filter((p) => p.role === 'drawer-front')
      .sort((a, b) => a.box.y - b.box.y)
    expect(drawerFronts.map(fromBody)).toEqual(fronts)
    const sides = parts
      .filter((p) => p.role === 'drawer-side' && p.id.startsWith('drawer-side-l-'))
      .sort((a, b) => a.box.y - b.box.y)
    expect(sides.map((p) => [p.box.y - 65, p.box.h])).toEqual(boxes)
  })

  test('도어올림 3단: channels 315 / 545, fronts 360 / 210 / 210', () => {
    const { parts } = build('lower-door-lift-3tier')
    expect(byName(parts, '좌측판')?.notches?.map((n) => n.fromBottom)).toEqual([315, 545])
    const fronts = parts.filter((p) => p.role === 'drawer-front').sort((a, b) => a.box.y - b.box.y)
    expect(fronts.map((f) => f.box.h)).toEqual([360, 210, 210])
  })

  test('상판내림: top set back 18.5 behind a 55 stretcher, 665 channel without rail, door 710', () => {
    const { parts, issues } = build('lower-top-down-half')
    expect(issues).toEqual([])
    const top = byName(parts, '상판')
    expect(top?.box.d).toBe(600 - 26 - 18.5)
    expect(byName(parts, '가로전대(상)')?.box.h).toBe(55)
    expect(byName(parts, '좌측판')?.notches).toEqual([{ fromBottom: 665, height: 65, depth: 40 }])
    expect(parts.some((p) => p.name.startsWith('가로전대') && p.name !== '가로전대(상)')).toBe(
      false,
    )
    const door = parts.find((p) => p.role === 'door')
    expect([door?.box.y, (door?.box.y ?? 0) + (door?.box.h ?? 0)]).toEqual([60, 65 + 705])
  })

  test('side-panel notches reach the panel list and the 3D mesh', () => {
    const preset = CABINET_PRESETS.find((p) => p.id === 'lower-door-lift-2tier')
    const node = cabinet(instantiateSpec(preset?.spec() as never))
    const rows = cabinetPanelRows(node)
    expect(rows.find((r) => r.name === '좌측판')?.notes).toBe('따내기 65×40 @355')
  })
})
