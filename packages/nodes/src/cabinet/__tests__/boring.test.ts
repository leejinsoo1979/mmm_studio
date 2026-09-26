import { describe, expect, test } from 'bun:test'
import { cabinetBoringPanels, type PanelBoringData } from '../engine/boring'
import { encodeCp949 } from '../engine/cp949'
import { panelsDxf } from '../engine/dxf'
import { cabinetsMprZip, encodeMpr } from '../engine/export'
import { panelMpr } from '../engine/mpr'
import { CABINET_PRESETS, instantiateSpec } from '../engine/presets'
import { CabinetNode } from '../schema'

function preset(id: string): CabinetNode {
  const found = CABINET_PRESETS.find((p) => p.id === id)
  if (!found) throw new Error(`missing preset ${id}`)
  return CabinetNode.parse(instantiateSpec(found.spec()))
}

function panel(panels: PanelBoringData[], name: string): PanelBoringData {
  const found = panels.find((p) => p.panelName === name)
  if (!found) throw new Error(`missing panel ${name}`)
  return found
}

const xy = (p: PanelBoringData, note: string) =>
  p.borings.filter((b) => b.note === note).map((b) => [b.x, b.y])

// Fixture shared with mmmcraft's mprExporter tests.
const side = (right = false): PanelBoringData => ({
  panelId: 'p',
  furnitureName: 'fixture',
  panelName: right ? '우측판' : '좌측판',
  panelType: right ? 'side-right' : 'side-left',
  width: 780,
  height: 600,
  thickness: 18,
  material: 'PB',
  borings: [],
  sideNotches: [{ y: 65, z: 40, fromBottom: 400 }],
  backPanelGroove: { offset: 16, width: 10, depth: 7.5 },
})

const macros = (s: string, name: string) =>
  s
    .split(/(?=^<)/m)
    .filter((b) => b.startsWith(`<${name} `))
    .map((b) => Object.fromEntries([...b.matchAll(/^(\w+)="([^"]*)"/gm)].map((m) => [m[1], m[2]])))

const contour = (s: string, id: number) => {
  const block = s.split(`]${id}\n`)[1]?.split(/\n\]|\n</)[0] ?? ''
  return [...block.matchAll(/X=([-\d.]+)\nY=([-\d.]+)/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }))
}

describe('MPR (mmmcraft preview output)', () => {
  test('keeps every operation disabled', () => {
    const mpr = panelMpr(side())
    expect(mpr).toContain('PREVIEW ONLY')
    expect((mpr.match(/\?\?="0"/g) ?? []).length).toBe(1)
    expect(mpr).not.toContain('<105 ')
    expect(mpr).toContain('PREVIEW MILLING EA=3:0 EE=3:3 RK=WRKR')
    expect(mpr.endsWith('!\n')).toBe(true)
  })

  test.each([false, true])('draws the notch on the front edge (right=%p)', (right) => {
    expect(contour(panelMpr(side(right)), 3)).toEqual(
      right
        ? [
            { x: 315, y: 600 },
            { x: 315, y: 560 },
            { x: 380, y: 560 },
            { x: 380, y: 600 },
          ]
        : [
            { x: 315, y: 0 },
            { x: 315, y: 40 },
            { x: 380, y: 40 },
            { x: 380, y: 0 },
          ],
    )
  })

  test.each([
    false,
    true,
  ])('cuts only material edges for top and bottom notches (right=%p)', (right) => {
    const p = { ...side(right), backPanelGroove: undefined }
    const y = right ? 560 : 40
    const edge = right ? 600 : 0
    p.sideNotches = [{ fromBottom: 715, y: 65, z: 40 }]
    expect(contour(panelMpr(p), 2)).toEqual([
      { x: 0, y },
      { x: 65, y },
      { x: 65, y: edge },
    ])
    p.sideNotches = [{ fromBottom: 0, y: 65, z: 40 }]
    expect(contour(panelMpr(p), 2)).toEqual([
      { x: 715, y: edge },
      { x: 715, y },
      { x: 780, y },
    ])
  })

  test.each([false, true])('grooves the back panel slot near the rear edge (right=%p)', (right) => {
    const mpr = panelMpr({ ...side(right), sideNotches: undefined })
    expect(macros(mpr, '109')).toEqual([
      expect.objectContaining({
        XA: '-1.0000',
        XE: '781.0000',
        YA: right ? '21.0000' : '579.0000',
        YE: right ? '21.0000' : '579.0000',
        TI: '7.5000',
        NB: '10.0000',
      }),
    ])
  })

  test('distinguishes through, blind and edge drilling', () => {
    const p: PanelBoringData = {
      ...side(),
      sideNotches: undefined,
      backPanelGroove: undefined,
      borings: [
        {
          id: 'through',
          type: 'shelf-pin',
          face: 'top',
          x: 100,
          y: 100,
          diameter: 6,
          depth: 18,
          note: 'fixed-panel-through',
        },
        { id: 'blind', type: 'hinge-screw', face: 'top', x: 120, y: 100, diameter: 3, depth: 3 },
        { id: 'l', type: 'shelf-pin', face: 'left', x: 0, y: 30, diameter: 5, depth: 30 },
        { id: 'r', type: 'shelf-pin', face: 'right', x: 780, y: 30, diameter: 5, depth: 30 },
      ],
    }
    const mpr = panelMpr(p)
    expect(macros(mpr, '102').map((b) => [b.BM, b.DU, b.TI])).toEqual([
      ['LSL', '6.0000', '18.0000'],
      ['LS', '3.0000', '3.0000'],
    ])
    expect(macros(mpr, '103').map((b) => [b.BM, b.WI, b.ZA])).toEqual([
      ['XP', '0.0000', '9.0000'],
      ['XM', '180.0000', '9.0000'],
    ])
  })
})

describe('cabinet → panel machining', () => {
  test('sink base: 목찬넬 notch, bottom bores, hinge plates on the hinge side', () => {
    const panels = cabinetBoringPanels(preset('lower-sink-cabinet'), '싱크')
    const left = panel(panels, '좌측판')
    const right = panel(panels, '우측판')
    expect([left.width, left.height]).toEqual([785, 600])
    expect(left.sideNotches).toEqual([{ y: 60, z: 40, fromBottom: 725 }])
    // Bottom (574 deep, flush with the front) on its centre line 9 mm up:
    // X counts from the side's top, the right side is mirrored in Y.
    expect(xy(left, 'fixed-panel-through')).toEqual([
      [776, 30],
      [776, 287],
      [776, 544],
    ])
    expect(xy(right, 'fixed-panel-through')).toEqual([
      [776, 570],
      [776, 313],
      [776, 56],
    ])
    const door = panel(panels, '도어')
    expect(door.borings.length).toBeGreaterThan(0)
    expect(xy(left, 'door-fixing-screw').length).toBe(4)
    expect(xy(right, 'door-fixing-screw')).toEqual([])
    const bottom = panel(panels, '바닥판')
    expect(bottom.borings.map((b) => [b.face, b.x, b.y])).toEqual([
      ['left', 0, 30],
      ['right', 563, 30],
      ['left', 0, 287],
      ['right', 563, 287],
      ['left', 0, 544],
      ['right', 563, 544],
    ])
  })

  test('doors: cups 22.5 from the edge, Y from the top, screws ±22.5 around each cup', () => {
    const single = panel(cabinetBoringPanels(preset('lower-sink-cabinet'), 's'), '도어')
    const cups = single.borings.filter((b) => b.type === 'hinge-cup')
    // Left-hinged single door seen from its inner face: cups on the right.
    expect(cups.map((b) => [b.x, b.y])).toEqual([
      [single.width - 22.5, single.height - 120],
      [single.width - 22.5, 120],
    ])
    expect(xy(single, 'door-fixing-screw').slice(0, 2)).toEqual([
      [single.width - 32, single.height - 97.5],
      [single.width - 32, single.height - 142.5],
    ])
    // A pair: mmmcraft mirrors the left leaf, so both carry cups at X = 22.5.
    const pair = cabinetBoringPanels(preset('dual-2drawer-hanging'), 'd')
    for (const name of ['양문(좌)', '양문(우)']) {
      const leaf = panel(pair, name)
      expect(new Set(leaf.borings.filter((b) => b.type === 'hinge-cup').map((b) => b.x))).toEqual(
        new Set([22.5]),
      )
    }
  })

  test('movable shelves rest on two pins under the shelf, set back with it', () => {
    const left = panel(cabinetBoringPanels(preset('upper-cabinet-shelf'), 'u'), '좌측판')
    const pins = xy(left, 'movable-shelf-pin')
    expect(pins.length).toBe(4)
    // Shelf 254 deep, 20 back from the front: pins at 20 + 30 and 20 + 224.
    expect(new Set(pins.map(([, y]) => y))).toEqual(new Set([50, 244]))
  })

  test('stacked bodies: each body side carries its own groove and the door plates in its range', () => {
    const panels = cabinetBoringPanels(preset('dual-2drawer-hanging'), 'd')
    const lower = panel(panels, '(하)좌측')
    const upper = panel(panels, '(상)좌측')
    expect(lower.backPanelGroove).toEqual({ offset: 16, width: 10, depth: 7.5 })
    expect(upper.backPanelGroove).toEqual({ offset: 16, width: 10, depth: 7.5 })
    const plates = [...xy(lower, 'door-fixing-screw'), ...xy(upper, 'door-fixing-screw')]
    // Four hinges on a 2232 door → four plate rows split over the two bodies.
    expect(plates.length).toBe(8)
    for (const p of [lower, upper]) {
      for (const b of p.borings) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x).toBeLessThanOrEqual(p.width)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeLessThanOrEqual(p.height)
      }
    }
  })
})

describe('encoding and packaging', () => {
  test('MPR text is CP949 with CRLF, without doubling CR', () => {
    const bytes = encodeMpr('좌측판\nXA="1"\r\n')
    expect(new TextDecoder('euc-kr').decode(bytes)).toBe('좌측판\r\nXA="1"\r\n')
    expect(bytes.length).toBe(16)
    expect(Array.from(encodeCp949('가'))).toEqual([0xb0, 0xa1])
    expect(Array.from(encodeCp949('😀'))).toEqual([0x3f])
  })

  test('ZIP holds one MPR per panel with unique CP949 names', () => {
    const node = preset('lower-sink-cabinet')
    const zip = cabinetsMprZip([
      { node, label: '싱크' },
      { node, label: '싱크' },
    ])
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    const count = view.getUint16(end + 10, true)
    expect(count).toBe(cabinetBoringPanels(node, '싱크').length * 2)
    const names: string[] = []
    let at = view.getUint32(end + 16, true)
    const decoder = new TextDecoder('euc-kr')
    for (let i = 0; i < count; i += 1) {
      expect(view.getUint32(at, true)).toBe(0x02014b50)
      const length = view.getUint16(at + 28, true)
      names.push(decoder.decode(zip.subarray(at + 46, at + 46 + length)))
      at += 46 + length
    }
    expect(new Set(names).size).toBe(count)
    expect(names).toContain('싱크_좌측판.mpr')
    expect(names).toContain('싱크_좌측판_2.mpr')
  })

  test('DXF draws edge bores beside the panel (mmmcraft layout)', () => {
    const dxf = panelsDxf([
      {
        panelId: 'fixed-panel',
        furnitureName: '장',
        panelType: 'bottom',
        panelName: '지판',
        width: 350,
        height: 1135,
        thickness: 18,
        material: 'PB',
        borings: [
          { id: 'top', type: 'shelf-pin', face: 'top', x: 100, y: 200, diameter: 5, depth: 12 },
          { id: 'left', type: 'shelf-pin', face: 'left', x: 0, y: 30, diameter: 5, depth: 30 },
          { id: 'right', type: 'shelf-pin', face: 'right', x: 350, y: 30, diameter: 5, depth: 30 },
        ],
      },
    ])
    expect(dxf).toContain('FACE LEFT')
    expect(dxf).toContain('FACE RIGHT')
    expect(dxf).toContain('10\n100.0000\n20\n200.0000')
    expect(dxf).toContain('10\n420.0000\n20\n9.0000')
    expect(dxf).toContain('10\n420.0000\n20\n52.0000')
    expect(dxf.endsWith('0\nEOF\n')).toBe(true)
  })
})
