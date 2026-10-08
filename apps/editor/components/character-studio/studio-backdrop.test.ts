import { describe, expect, test } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'
import { floorGlowEllipse, freeRoomCentre } from './studio-backdrop'

describe('freeRoomCentre', () => {
  test('is the view’s middle with no chrome', () => {
    expect(
      freeRoomCentre({ width: 1600, height: 900 }, { top: 0, right: 0, bottom: 0, left: 0 }),
    ).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })

  test('moves left of a panel on the right and up from a bar along the bottom (y from the bottom)', () => {
    const centre = freeRoomCentre(
      { width: 1600, height: 900 },
      { top: 0, right: 400, bottom: 100, left: 0 },
    )
    expect(centre.x).toBeCloseTo(600 / 1600, 9)
    expect(centre.y).toBeCloseTo(1 - 400 / 900, 9)
  })

  test('keeps a pixel of room when the chrome covers everything', () => {
    const centre = freeRoomCentre(
      { width: 100, height: 100 },
      { top: 80, right: 80, bottom: 80, left: 80 },
    )
    expect(centre.x).toBeCloseTo(0.805, 9)
    expect(centre.y).toBeCloseTo(1 - 0.805, 9)
  })
})

describe('floorGlowEllipse', () => {
  test('takes the platform’s centre to view uv and its radii across in view heights', () => {
    const [x, y, across, up] = floorGlowEllipse({ x: 0, y: -0.5 }, { x: 0.4 }, { y: -0.6 }, 2)
    expect(x).toBe(0.5)
    expect(y).toBe(0.25)
    expect(across).toBeCloseTo(0.4, 9)
    expect(up).toBeCloseTo(0.05, 9)
  })

  test('follows a camera looking down at the platform from the front', () => {
    const camera = new PerspectiveCamera(30, 16 / 9, 0.05, 50)
    camera.position.set(0, 1, 4)
    camera.lookAt(0, 1, 0)
    camera.updateMatrixWorld()
    const centre = new Vector3(0, 0, 0).project(camera)
    const rimX = new Vector3(0.95, 0, 0).project(camera)
    const rimZ = new Vector3(0, 0, 0.95).project(camera)
    const [x, y, across, up] = floorGlowEllipse(centre, rimX, rimZ, 16 / 9)
    expect(x).toBeCloseTo(0.5, 9)
    expect(y).toBeLessThan(0.5)
    // Seen at a slant, the disc is wider than it is deep.
    expect(across).toBeGreaterThan(up)
  })
})
