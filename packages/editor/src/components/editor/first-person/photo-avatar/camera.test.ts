import { describe, expect, test } from 'bun:test'
import {
  cameraCentre,
  cameraLookingAt,
  headAngles,
  headRotation,
  nudgeCamera,
  project,
  projectionJacobian,
  toCamera,
  turnJacobian,
} from './camera'
import type { Vec3 } from './linalg'

const degrees = Math.PI / 180

describe('head rotation', () => {
  test('headAngles undoes headRotation', () => {
    for (const [yaw, pitch, roll] of [
      [0, 0, 0],
      [45, 5, -3],
      [-80, -10, 4],
      [20, 15, 10],
    ]) {
      const found = headAngles(headRotation(yaw! * degrees, pitch! * degrees, roll! * degrees))
      expect(found.yaw / degrees).toBeCloseTo(yaw!, 9)
      expect(found.pitch / degrees).toBeCloseTo(pitch!, 9)
      expect(found.roll / degrees).toBeCloseTo(roll!, 9)
    }
  })

  test('a positive yaw turns the nose to the image right', () => {
    const camera = cameraLookingAt({
      width: 400,
      height: 400,
      rotation: headRotation(30 * degrees),
      target: [0, 0, 0],
      distance: 0.5,
    })
    const [noseX] = project(camera, [0, 0, 0.1])
    expect(noseX).toBeGreaterThan(200)
    const [chinX, chinY] = project(
      cameraLookingAt({
        width: 400,
        height: 400,
        rotation: headRotation(0),
        target: [0, 0, 0],
        distance: 0.5,
      }),
      [0, -0.1, 0],
    )
    expect(chinX).toBeCloseTo(200, 9)
    // +y is up the body, down the image is +v.
    expect(chinY).toBeGreaterThan(200)
  })
})

describe('cameraLookingAt', () => {
  test('puts the target where asked, at the distance asked', () => {
    const target: Vec3 = [0.01, 0.05, 0.08]
    const camera = cameraLookingAt({
      width: 640,
      height: 480,
      rotation: headRotation(40 * degrees, 5 * degrees),
      target,
      at: [300, 200],
      distance: 0.6,
    })
    const [u, v] = project(camera, target)
    expect(u).toBeCloseTo(300, 9)
    expect(v).toBeCloseTo(200, 9)
    expect(toCamera(camera, target)[2]).toBeCloseTo(0.6, 12)
    const centre = cameraCentre(camera)
    expect(
      Math.hypot(centre[0] - target[0], centre[1] - target[1], centre[2] - target[2]),
    ).toBeGreaterThan(0.6)
  })
})

describe('derivatives', () => {
  const camera = cameraLookingAt({
    width: 500,
    height: 500,
    rotation: headRotation(20 * degrees),
    target: [0, 0, 0],
    distance: 0.5,
  })

  test('projectionJacobian matches finite differences', () => {
    const q: Vec3 = [0.03, -0.02, 0.48]
    const [ju, jv] = projectionJacobian(camera, q)
    const h = 1e-7
    for (let k = 0; k < 3; k++) {
      const plus = [...q] as Vec3
      const minus = [...q] as Vec3
      plus[k] = q[k]! + h
      minus[k] = q[k]! - h
      const at = (p: Vec3) => [
        (camera.focal * p[0]) / p[2] + camera.cx,
        (camera.focal * p[1]) / p[2] + camera.cy,
      ]
      const [u1, v1] = at(plus)
      const [u0, v0] = at(minus)
      expect(ju[k]).toBeCloseTo((u1! - u0!) / (2 * h), 3)
      expect(jv[k]).toBeCloseTo((v1! - v0!) / (2 * h), 3)
    }
  })

  test('turnJacobian is the derivative of nudgeCamera', () => {
    const p: Vec3 = [0.02, 0.05, 0.09]
    const q = toCamera(camera, p)
    const pivot: Vec3 = [0, 0.01, 0.5]
    const j = turnJacobian(q, pivot)
    const h = 1e-6
    for (let k = 0; k < 3; k++) {
      const w: Vec3 = [0, 0, 0]
      w[k] = h
      const moved = toCamera(nudgeCamera(camera, w, [0, 0, 0], pivot), p)
      for (let r = 0; r < 3; r++) expect(j[r * 3 + k]).toBeCloseTo((moved[r]! - q[r]!) / h, 5)
    }
  })

  test('nudgeCamera keeps the pivot fixed and scales the focal length', () => {
    const pivot: Vec3 = [0.01, -0.02, 0.5]
    const moved = nudgeCamera(camera, [0.1, -0.2, 0.05], [0, 0, 0], pivot, Math.log(1.2))
    // A body point at the pivot stays there.
    const body = (() => {
      // Solve R p + t = pivot for p.
      const r = camera.rotation
      const d: Vec3 = [
        pivot[0] - camera.translation[0],
        pivot[1] - camera.translation[1],
        pivot[2] - camera.translation[2],
      ]
      return [
        r[0] * d[0] + r[3] * d[1] + r[6] * d[2],
        r[1] * d[0] + r[4] * d[1] + r[7] * d[2],
        r[2] * d[0] + r[5] * d[1] + r[8] * d[2],
      ] as Vec3
    })()
    const q = toCamera(moved, body)
    for (let k = 0; k < 3; k++) expect(q[k]).toBeCloseTo(pivot[k]!, 12)
    expect(moved.focal).toBeCloseTo(camera.focal * 1.2, 9)
  })
})
