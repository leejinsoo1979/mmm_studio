import { describe, expect, test } from 'bun:test'
import { Bone, Group, Vector3 } from 'three'
import {
  AvatarReach,
  estimateBodyAnchors,
  findArmBones,
  reachArm,
  solveTwoBoneIk,
} from './avatar-reach'

/** A right arm held out along +X from a shoulder at (0, 1.4, 0): 0.3 m upper arm, 0.25 m forearm. */
function rig() {
  const model = new Group()
  const upper = new Bone()
  upper.name = 'Bip01_R_UpperArm'
  upper.position.set(0, 1.4, 0)
  const forearm = new Bone()
  forearm.name = 'Bip01 R Forearm'
  forearm.position.set(0.3, 0, 0)
  const hand = new Bone()
  hand.name = 'Bip01_R_Hand'
  hand.position.set(0.25, 0, 0)
  const finger = new Bone()
  finger.name = 'Bip01_R_Finger1'
  finger.position.set(0.05, 0, 0)
  model.add(upper)
  upper.add(forearm)
  forearm.add(hand)
  hand.add(finger)
  model.updateWorldMatrix(true, true)
  return { model, upper, forearm, hand }
}

const world = (object: { getWorldPosition(v: Vector3): Vector3 }) =>
  object.getWorldPosition(new Vector3())

describe('solveTwoBoneIk', () => {
  const shoulder = new Vector3(0, 0, 0)
  const elbow = new Vector3(0.3, 0, 0)
  const hand = new Vector3(0.55, 0, 0)

  test('reaches a target within reach, keeping the bone lengths', () => {
    const target = new Vector3(0.2, -0.2, 0.25)
    const solution = solveTwoBoneIk(shoulder, elbow, hand, target, new Vector3(0, -1, 0))
    expect(solution.reached).toBe(true)
    expect(solution.hand.distanceTo(target)).toBeLessThan(1e-6)
    expect(solution.elbow.distanceTo(shoulder)).toBeCloseTo(0.3, 6)
    expect(solution.hand.distanceTo(solution.elbow)).toBeCloseTo(0.25, 6)
  })

  test('clamps a target out of reach onto the line toward it', () => {
    const target = new Vector3(0, 2, 0)
    const solution = solveTwoBoneIk(shoulder, elbow, hand, target, new Vector3(0, 0, -1))
    expect(solution.reached).toBe(false)
    expect(solution.hand.length()).toBeCloseTo(0.55, 3)
    expect(solution.hand.x).toBeCloseTo(0, 6)
    expect(solution.hand.z).toBeCloseTo(0, 6)
    expect(solution.hand.y).toBeGreaterThan(0)
  })

  test('clamps a target too near to the folded arm', () => {
    const solution = solveTwoBoneIk(
      shoulder,
      elbow,
      hand,
      new Vector3(0.01, 0, 0),
      new Vector3(0, -1, 0),
    )
    expect(solution.reached).toBe(false)
    expect(solution.hand.length()).toBeCloseTo(0.05, 3)
  })

  test('bends the elbow toward the pole', () => {
    const target = new Vector3(0.4, 0, 0)
    for (const pole of [new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 1, -1)]) {
      const solution = solveTwoBoneIk(shoulder, elbow, hand, target, pole)
      const off = solution.elbow.clone().setX(0)
      expect(off.length()).toBeGreaterThan(0.1)
      expect(off.normalize().dot(pole.clone().normalize())).toBeGreaterThan(0.99)
    }
  })
})

describe('reachArm', () => {
  test('puts the hand bone on the target', () => {
    const { model, upper, hand } = rig()
    const arm = findArmBones(model, 'right')
    expect(arm).not.toBeNull()
    const target = new Vector3(0.25, 1.65, 0.3)
    reachArm(arm!, target, new Vector3(0.2, 0.8, -0.3), 1)
    expect(world(hand).distanceTo(target)).toBeLessThan(1e-4)
    expect(world(upper).distanceTo(new Vector3(0, 1.4, 0))).toBeLessThan(1e-9)
  })

  test('half the weight leaves the hand between the pose and the target', () => {
    const { model, hand } = rig()
    const arm = findArmBones(model, 'right')!
    const start = world(hand)
    const target = new Vector3(0.1, 1.9, 0.2)
    reachArm(arm, target, new Vector3(0, 0.8, -0.3), 0.5)
    const reached = world(hand)
    expect(reached.distanceTo(start)).toBeGreaterThan(0.05)
    expect(reached.distanceTo(target)).toBeGreaterThan(0.05)
  })

  test('an AvatarReach does not pile turns up on bones the animation leaves alone', () => {
    const { model, hand } = rig()
    const reach = new AvatarReach(model)
    const target = new Vector3(0.3, 1.2, 0.3)
    const pole = new Vector3(0, 0.8, -0.3)
    reach.begin()
    reach.reach('right', target, pole, 0.5)
    const once = world(hand)
    reach.begin()
    reach.reach('right', target, pole, 0.5)
    expect(world(hand).distanceTo(once)).toBeLessThan(1e-6)
  })
})

test('estimateBodyAnchors faces the yaw with the right side to the right', () => {
  const body = estimateBodyAnchors(new Vector3(1, 0, 2), 0)
  expect(body.forward.z).toBeCloseTo(1, 6)
  // Facing +Z, the right hand is toward -X.
  expect(body.right.x).toBeCloseTo(-1, 6)
  expect(body.rightShoulder.x).toBeLessThan(body.leftShoulder.x)
  expect(body.head.y).toBeGreaterThan(body.chest.y)
  expect(body.chest.y).toBeGreaterThan(body.waist.y)
})
