import { describe, expect, test } from 'bun:test'
import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import {
  dragDelta,
  facingOpacity,
  grabFrame,
  hitRadius,
  KEY_NUDGE,
  nearestHandle,
  nudgePixels,
  pointerMove,
  ringPixels,
  snapTurn,
  viewTurn,
} from './sculpt-gesture'

/** The studio's camera: in front of the face, looking straight at it. */
function camera() {
  const lens = new PerspectiveCamera(25, 16 / 9, 0.05, 50)
  lens.position.set(0, 1.6, 0.9)
  lens.lookAt(0, 1.6, 0)
  lens.updateMatrixWorld(true)
  return lens
}

const POINT = new Vector3(0, 1.6, 0.1)
const SIZE = 0.25
const HEIGHT = 720

describe('a drag on a handle', () => {
  test('moves across and up from the front', () => {
    const frame = grabFrame(camera(), POINT, new Matrix4(), SIZE, HEIGHT)
    const [dx, dy, dz] = dragDelta(frame, pointerMove(100, 0, false))
    expect(dx).toBeCloseTo((100 * frame.perPixel) / SIZE, 4)
    expect(dy).toBeCloseTo(0, 6)
    expect(dz).toBeCloseTo(0, 6)
    const [, down] = dragDelta(frame, pointerMove(0, 40, false))
    expect(down).toBeCloseTo((40 * frame.perPixel) / SIZE, 4)
  })

  test('measures a px at the grabbed point’s depth', () => {
    const frame = grabFrame(camera(), POINT, new Matrix4(), SIZE, HEIGHT)
    expect(frame.perPixel).toBeCloseTo((2 * 0.8 * Math.tan((12.5 * Math.PI) / 180)) / HEIGHT, 9)
  })

  test('moves forward and back across the screen from the side', () => {
    // Turned a quarter to the left: the face (bind +z) looks to screen right.
    const turned = new Matrix4().makeRotationY(Math.PI / 2)
    const frame = grabFrame(camera(), POINT, turned, SIZE, HEIGHT)
    const [dx, dy, dz] = dragDelta(frame, pointerMove(100, 0, false))
    expect(dz).toBeCloseTo((100 * frame.perPixel) / SIZE, 4)
    expect(dx).toBeCloseTo(0, 6)
    expect(dy).toBeCloseTo(0, 6)
  })

  test('mixes across and forward at three quarters', () => {
    const turned = new Matrix4().makeRotationY(Math.PI / 4)
    const frame = grabFrame(camera(), POINT, turned, SIZE, HEIGHT)
    const [dx, , dz] = dragDelta(frame, pointerMove(100, 0, false))
    expect(dx).toBeCloseTo(dz, 4)
    expect(dx).toBeGreaterThan(0)
  })

  test('pulls towards the viewer on a depth drag upwards, ignoring across', () => {
    const frame = grabFrame(camera(), POINT, new Matrix4(), SIZE, HEIGHT)
    const [dx, dy, dz] = dragDelta(frame, pointerMove(80, -50, true))
    expect(dz).toBeCloseTo((50 * frame.perPixel) / SIZE, 4)
    expect(dx).toBeCloseTo(0, 6)
    expect(dy).toBeCloseTo(0, 4)
    const [, , push] = dragDelta(frame, pointerMove(0, 50, true))
    expect(push).toBeLessThan(0)
  })

  test('undoes the head’s size, so the skin follows the pointer', () => {
    const bigger = new Matrix4().makeScale(1.25, 1.25, 1.25)
    const plain = grabFrame(camera(), POINT, new Matrix4(), SIZE, HEIGHT)
    const grown = grabFrame(camera(), POINT, bigger, SIZE, HEIGHT)
    expect(dragDelta(grown, pointerMove(100, 0, false))[0]).toBeCloseTo(
      dragDelta(plain, pointerMove(100, 0, false))[0] / 1.25,
      4,
    )
    expect(grown.scale).toBeCloseTo(1.25, 9)
  })

  test('nudges by KEY_NUDGE of the front view per key press', () => {
    const frame = grabFrame(camera(), POINT, new Matrix4().makeScale(1.1, 1.1, 1.1), SIZE, HEIGHT)
    const [dx] = dragDelta(frame, pointerMove(nudgePixels(frame), 0, false))
    expect(dx).toBeCloseTo(KEY_NUDGE, 4)
  })

  test('draws the sculpt’s radius at its size on the screen', () => {
    const frame = grabFrame(camera(), POINT, new Matrix4(), SIZE, HEIGHT)
    const px = ringPixels(0.04, SIZE, 1, frame.perPixel)
    expect(px * frame.perPixel).toBeCloseTo(0.04 * SIZE, 9)
  })
})

describe('hitting a handle', () => {
  const handles = [
    { handle: 'nose-tip' as const, x: 100, y: 100, visible: true },
    { handle: 'lip-upper' as const, x: 100, y: 120, visible: true },
    { handle: 'ear-r' as const, x: 60, y: 100, visible: false },
  ]

  test('takes the nearest visible handle within the radius', () => {
    expect(nearestHandle(handles, { x: 101, y: 104 }, 22)).toBe('nose-tip')
    expect(nearestHandle(handles, { x: 100, y: 116 }, 22)).toBe('lip-upper')
  })

  test('passes over hidden handles and far presses', () => {
    expect(nearestHandle(handles, { x: 62, y: 100 }, 22)).toBeNull()
    expect(nearestHandle(handles, { x: 100, y: 160 }, 22)).toBeNull()
    expect(nearestHandle(handles, { x: 100, y: 145 }, hitRadius('touch'))).toBe('lip-upper')
    expect(nearestHandle(handles, { x: 100, y: 145 }, hitRadius('mouse'))).toBeNull()
  })
})

describe('a handle as its face turns away', () => {
  test('fades out and hides', () => {
    expect(facingOpacity(0.05)).toBe(0)
    expect(facingOpacity(0.1)).toBe(0)
    expect(facingOpacity(0.2)).toBeGreaterThan(0)
    expect(facingOpacity(0.2)).toBeLessThan(facingOpacity(0.3))
    expect(facingOpacity(0.35)).toBe(1)
    expect(facingOpacity(1)).toBe(1)
  })
})

describe('the turntable', () => {
  const degrees = (value: number) => (value * Math.PI) / 180

  test('snaps near a preset angle, either side, whole turns kept', () => {
    expect(snapTurn(degrees(3))).toEqual({ yaw: 0, view: 'front' })
    expect(snapTurn(degrees(48)).view).toBe('angle')
    expect(snapTurn(degrees(48)).yaw).toBeCloseTo(degrees(45), 9)
    expect(snapTurn(degrees(-93)).yaw).toBeCloseTo(degrees(-90), 9)
    expect(snapTurn(degrees(-93)).view).toBe('side')
    expect(snapTurn(2 * Math.PI + degrees(2)).yaw).toBeCloseTo(2 * Math.PI, 9)
    expect(snapTurn(degrees(20))).toEqual({ yaw: degrees(20), view: 'free' })
  })

  test('turns to a view the short way round', () => {
    expect(viewTurn('front', 'free', 2 * Math.PI + 0.3, 1).yaw).toBeCloseTo(2 * Math.PI, 9)
    expect(viewTurn('angle', 'front', 0, 1).yaw).toBeCloseTo(degrees(45), 9)
    expect(viewTurn('side', 'angle', degrees(-45), -1).yaw).toBeCloseTo(degrees(-90), 9)
  })

  test('flips to the other side when the same view is asked again', () => {
    const again = viewTurn('angle', 'angle', degrees(45), 1)
    expect(again.yaw).toBeCloseTo(degrees(-45), 9)
    expect(again.sign).toBe(-1)
    expect(viewTurn('side', 'side', degrees(-90), -1)).toEqual({ yaw: degrees(90), sign: 1 })
  })
})
