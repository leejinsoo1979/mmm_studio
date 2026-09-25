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
  setCellSize,
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
    expect(csv.startsWith('﻿가구,부재,재질,두께,길이,폭,수량')).toBe(true)
    expect(csv).toContain('옷장,뒷판,MDF,9')
    const hardware = cabinetHardwareRows(node)
    expect(hardware.find((h) => h.name === '경첩')?.quantity).toBe(8)
  })
})
