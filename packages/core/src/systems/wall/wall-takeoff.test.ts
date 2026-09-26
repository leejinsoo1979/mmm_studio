import { describe, expect, test } from 'bun:test'
import { DoorNode, WallNode } from '../../schema'
import {
  facePieces,
  framingTakeoff,
  levelWallTakeoff,
  sheetsForPieces,
  summarizeTakeoff,
  takeoffCsv,
  WALL_SHEETS,
} from './wall-takeoff'

const door = { x0: 1000, x1: 1900, y0: 0, y1: 2100 }

describe('wall finish takeoff', () => {
  test('openings come off the face area', () => {
    const pieces = facePieces(3000, 2400, [door])
    const area = pieces.reduce((s, p) => s + (p.x1 - p.x0) * (p.y1 - p.y0), 0)
    expect(area / 1e6).toBeCloseTo(7.2 - 0.9 * 2.1, 9)
    expect(pieces).toHaveLength(3)
  })

  test('sheets: upright on a grid from the wall start, offcuts reused', () => {
    const full = [{ x0: 0, x1: 3000, y0: 0, y1: 2400 }]
    // 석고 900×1800: three 900 columns (3 × 1800 + three 600 offcuts in one
    // sheet) + a 300 column (1800 + 600, three 300 strips per sheet).
    expect(sheetsForPieces(full, WALL_SHEETS['gypsum-9.5'])).toBe(5)
    // MDF 1220×2440: two full columns + a 560 column (two per sheet).
    expect(sheetsForPieces(full, WALL_SHEETS['mdf-9'])).toBe(3)
  })

  test('framing: studs every spacing plus the end, cut short over openings', () => {
    const plain = framingTakeoff('timber', 303, 3000, 2400, [])
    expect([plain.studs, plain.studM, plain.plateM, plain.openingM]).toEqual([11, 26.4, 6, 0])
    const withDoor = framingTakeoff('steel', 303, 3000, 2400, [door])
    // Studs at 1212 / 1515 / 1818 keep 300 above the door; the bottom runner
    // breaks at the door; jambs 2 × 2.4 + header 0.9.
    expect([withDoor.studM, withDoor.plateM, withDoor.openingM]).toEqual([20.1, 5.1, 5.7])
  })

  test('a 목상 wall: net area, 석고 1P + MDF 2P, framing; 떡가베 has two faces', () => {
    const d = DoorNode.parse({ width: 0.9, height: 2.1, position: [1.45, 1.05, 0] })
    const wall = WallNode.parse({
      start: [0, 0],
      end: [3, 0],
      height: 2.4,
      thickness: 0.158,
      children: [d.id],
      construction: { kind: 'timber', side: 'left' },
    })
    const faces = levelWallTakeoff([wall], { [d.id]: d } as never)
    expect(faces).toHaveLength(1)
    const f = faces[0]!
    expect([f.lengthMm, f.grossM2, f.openingM2, f.netM2]).toEqual([3000, 7.2, 1.89, 5.31])
    expect(f.boards.map((b) => b.sheet)).toEqual(['gypsum-9.5', 'mdf-9'])
    expect(f.framing?.spacingMm).toBe(303)
    const bonded = WallNode.parse({
      start: [0, 0],
      end: [3, 0],
      height: 2.4,
      construction: { kind: 'bonded', side: 'left', bothFaces: true },
    })
    const both = levelWallTakeoff([bonded], {})
    expect(both.map((x) => x.face)).toEqual(['front', 'back'])
    expect(both[0]?.framing).toBeNull()
    const sum = summarizeTakeoff([...faces, ...both])
    expect(sum.sheets.find((s) => s.sheet === 'gypsum-9.5')?.count).toBe(
      f.boards[0]!.sheets + both[0]!.boards[0]!.sheets * 2 + both[0]!.boards[1]!.sheets * 2,
    )
    expect(takeoffCsv(faces, () => '벽1')).toContain('석고보드 일반 9.5T,900×1800')
  })

  test('경량 walls take 50 mm studs at 450', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [2, 0],
      height: 2.4,
      construction: { kind: 'steel', side: 'right' },
    })
    const [f] = levelWallTakeoff([wall], {})
    expect(f?.framing).toMatchObject({ kind: 'steel', spacingMm: 450, studs: 6 })
  })
})
