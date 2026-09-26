import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SceneManager } from '../../core/engine/SceneManager'
import { eventBus } from '../../core/events/EventBus'
import { FloorEvents } from '../../core/events/FloorEvents'
import { Vector2 } from '../../core/math/Vector2'
import { SnapService } from '../services/SnapService'
import { WallTool } from './WallTool'

// Same snap setup as FloorplanCanvas (coordinates in mm).
function setup() {
  SceneManager.resetInstance()
  const scene = SceneManager.getInstance({
    gridSize: 100,
    snapEnabled: true,
    snapThreshold: 15,
    wallThickness: 100,
    wallHeight: 2400,
    canvasWidth: 1000,
    canvasHeight: 800,
  })
  const tool = new WallTool(scene, new SnapService({ gridSize: 100, pointSnapThreshold: 150 }))
  tool.activate()
  return { scene, tool }
}

const move = (tool: WallTool, x: number, y: number) =>
  tool.handleMouseMove(new Vector2(x, y), { shiftKey: false } as MouseEvent)
const click = (tool: WallTool, x: number, y: number) => {
  move(tool, x, y)
  tool.handleMouseDown(new Vector2(x, y), { button: 0, shiftKey: false } as MouseEvent)
}

function drawing(scene: SceneManager) {
  const points = scene.objectManager.getAllPoints()
  const byId = new Map(points.map((point) => [point.id, point]))
  return {
    points: points.length,
    walls: scene.objectManager.getAllWalls().map((wall) => {
      const start = byId.get(wall.startPointId)!
      const end = byId.get(wall.endPointId)!
      return [start.x, start.y, end.x, end.y]
    }),
  }
}

describe('WallTool', () => {
  let previewEnd: { x: number; y: number } | null
  const onPreview = (data: { end: { x: number; y: number } }) => {
    previewEnd = { x: data.end.x, y: data.end.y }
  }
  beforeEach(() => {
    previewEnd = null
    eventBus.on(FloorEvents.WALL_PREVIEW_UPDATED, onPreview)
  })
  afterEach(() => {
    eventBus.off(FloorEvents.WALL_PREVIEW_UPDATED, onPreview)
  })

  test('Esc during a draft leaves nothing in the drawing', () => {
    const { scene, tool } = setup()
    click(tool, 0, 0)
    move(tool, 3000, 0)
    tool.cancel()

    expect(drawing(scene)).toEqual({ points: 0, walls: [] })
    expect(scene.historyManager.getUndoCount()).toBe(0)
  })

  test('each confirm creates one wall at the previewed end and chains from it', () => {
    const { scene, tool } = setup()
    click(tool, 0, 0)
    move(tool, 3000, 0)
    const firstPreview = previewEnd
    click(tool, 3000, 0)
    move(tool, 3000, 2000)
    const secondPreview = previewEnd
    click(tool, 3000, 2000)

    const { points, walls } = drawing(scene)
    expect(walls).toEqual([
      [0, 0, 3000, 0],
      [3000, 0, 3000, 2000],
    ])
    expect(points).toBe(3)
    expect(firstPreview).toEqual({ x: 3000, y: 0 })
    expect(secondPreview).toEqual({ x: 3000, y: 2000 })
    expect(scene.historyManager.getUndoCount()).toBe(2)
  })

  test('clicking the start point again (double click) creates no wall', () => {
    const { scene, tool } = setup()
    click(tool, 0, 0)
    click(tool, 0, 0)

    expect(drawing(scene).walls).toEqual([])
    expect(scene.historyManager.getUndoCount()).toBe(0)
  })

  test('undo removes the wall with the points it added; redo restores them', () => {
    const { scene, tool } = setup()
    click(tool, 0, 0)
    click(tool, 3000, 0)
    click(tool, 3000, 2000)
    tool.cancel()
    const drawn = drawing(scene)

    scene.historyManager.undo()
    expect(drawing(scene)).toEqual({ points: 2, walls: [[0, 0, 3000, 0]] })
    scene.historyManager.undo()
    expect(drawing(scene)).toEqual({ points: 0, walls: [] })

    scene.historyManager.redo()
    scene.historyManager.redo()
    expect(drawing(scene)).toEqual(drawn)
  })

  test('closing the loop on the first point ends the chain', () => {
    const { scene, tool } = setup()
    for (const [x, y] of [
      [0, 0],
      [3000, 0],
      [3000, 2000],
      [0, 2000],
      [0, 0],
    ]) {
      click(tool, x, y)
    }
    // The chain is closed: the next click starts a new draft instead of a wall.
    click(tool, 6000, 0)

    const { points, walls } = drawing(scene)
    expect(walls).toHaveLength(4)
    expect(points).toBe(4)
  })
})
