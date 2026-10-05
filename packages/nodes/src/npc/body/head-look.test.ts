import { describe, expect, test } from 'bun:test'
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Matrix4,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
} from 'three'
import {
  HeadLook,
  JAW_OPEN,
  LOOK_DOWN_LIMIT,
  LOOK_UP_LIMIT,
  LOOK_YAW_LIMIT,
  lookAngles,
  MixerPose,
  openJaw,
} from './head-look'

const DEG = Math.PI / 180

describe('lookAngles', () => {
  test('ahead is straight on', () => {
    expect(lookAngles(0, 0, 1)).toEqual({ yaw: 0, pitch: 0, inSight: true })
  })

  test('turns toward +X for a target on the left of a +Z-facing body', () => {
    const { yaw, pitch } = lookAngles(1, 0, 1)
    expect(yaw).toBeCloseTo(45 * DEG)
    expect(pitch).toBeCloseTo(0)
  })

  test('clamps to the neck: 70° to the sides, 20° up, 25° down', () => {
    expect(lookAngles(1, 0, 0).yaw).toBeCloseTo(LOOK_YAW_LIMIT)
    expect(lookAngles(-1, 0, 0.2).yaw).toBeCloseTo(-LOOK_YAW_LIMIT)
    expect(lookAngles(0, 5, 1).pitch).toBeCloseTo(LOOK_UP_LIMIT)
    expect(lookAngles(0, -5, 1).pitch).toBeCloseTo(-LOOK_DOWN_LIMIT)
  })

  test('something behind is out of sight', () => {
    expect(lookAngles(1, 0, -0.1).inSight).toBe(true)
    expect(lookAngles(1, 0, -0.5).inSight).toBe(false)
    expect(lookAngles(0, 0, -1).inSight).toBe(false)
  })
})

/**
 * A body facing `facing` (rad about +Y) with a spine, neck and head in odd
 * bone frames, and a collarbone off the neck as Rocketbox hangs them.
 */
function rig(facing: number) {
  const body = new Object3D()
  body.position.set(2, 0, -3)
  body.rotation.y = facing
  const spine = new Object3D()
  spine.position.set(0, 1.2, 0)
  spine.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)
  const neck = new Object3D()
  neck.position.set(0.25, 0, 0)
  neck.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.3)
  const head = new Object3D()
  head.position.set(0.1, 0, 0)
  head.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), -0.2)
  const shoulder = new Object3D()
  shoulder.position.set(-0.05, 0.03, 0.08)
  shoulder.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 1.2)
  body.add(spine)
  spine.add(neck)
  neck.add(head, shoulder)
  body.updateMatrixWorld(true)
  const rest = {
    neck: neck.quaternion.clone(),
    head: head.quaternion.clone(),
    shoulder: shoulder.quaternion.clone(),
  }
  // The head's own axis that points where the body faces, whatever its bone frame.
  const forward = new Vector3(0, 0, 1)
    .applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), facing))
    .applyQuaternion(head.getWorldQuaternion(new Quaternion()).invert())
  /** Plays a "mixer" frame (the rest pose) and the look over it. */
  const frame = (look: HeadLook, target: Vector3 | null, delta: number) => {
    neck.quaternion.copy(rest.neck)
    head.quaternion.copy(rest.head)
    shoulder.quaternion.copy(rest.shoulder)
    look.update(body, target, delta)
    body.updateMatrixWorld(true)
  }
  /** Where the head faces, as yaw and pitch in the body's frame. */
  const facingOfHead = () => {
    const world = forward.clone().applyQuaternion(head.getWorldQuaternion(new Quaternion()))
    const local = world.applyQuaternion(body.getWorldQuaternion(new Quaternion()).invert())
    return {
      yaw: Math.atan2(local.x, local.z),
      pitch: Math.atan2(local.y, Math.hypot(local.x, local.z)),
    }
  }
  const eye = () => head.getWorldPosition(new Vector3())
  return { body, neck, head, shoulder, frame, facingOfHead, eye }
}

/** A world point `distance` ahead-ish of the head, `yaw` round and `pitch` up in the body's frame. */
function around(r: ReturnType<typeof rig>, facing: number, yaw: number, pitch: number) {
  const dir = new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  )
  dir.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), facing))
  return r.eye().add(dir.multiplyScalar(3))
}

describe('HeadLook', () => {
  test('turns the head to face a point, in any body facing and bone frame', () => {
    for (const facing of [0, 1.1, -2.5]) {
      const r = rig(facing)
      const look = new HeadLook(r.neck, r.head)
      const target = around(r, facing, 40 * DEG, 10 * DEG)
      for (let i = 0; i < 60; i++) r.frame(look, target, 0.1)
      const faced = r.facingOfHead()
      // The look is aimed from the unturned head; turning moves the eye a little.
      expect(faced.yaw).toBeCloseTo(40 * DEG, 1)
      expect(faced.pitch).toBeCloseTo(10 * DEG, 1)
    }
  })

  test('stops at the neck limit', () => {
    const r = rig(0.4)
    const look = new HeadLook(r.neck, r.head)
    const target = around(r, 0.4, 95 * DEG, 0)
    for (let i = 0; i < 60; i++) r.frame(look, target, 0.1)
    expect(r.facingOfHead().yaw).toBeCloseTo(LOOK_YAW_LIMIT, 1)
  })

  test('eases in rather than snapping', () => {
    const r = rig(0)
    const look = new HeadLook(r.neck, r.head)
    r.frame(look, around(r, 0, 60 * DEG, 0), 1 / 60)
    const yaw = r.facingOfHead().yaw
    expect(yaw).toBeGreaterThan(0)
    expect(yaw).toBeLessThan(5 * DEG)
  })

  test('lets go of a target behind, and of none', () => {
    const r = rig(0)
    const look = new HeadLook(r.neck, r.head)
    for (let i = 0; i < 60; i++) r.frame(look, around(r, 0, 50 * DEG, 0), 0.1)
    for (let i = 0; i < 60; i++) r.frame(look, around(r, 0, 170 * DEG, 0), 0.1)
    expect(look.weight).toBeLessThan(0.01)
    expect(Math.abs(r.facingOfHead().yaw)).toBeLessThan(1 * DEG)

    for (let i = 0; i < 60; i++) r.frame(look, around(r, 0, -30 * DEG, 0), 0.1)
    expect(r.facingOfHead().yaw).toBeCloseTo(-30 * DEG, 1)
    for (let i = 0; i < 60; i++) r.frame(look, null, 0.1)
    expect(Math.abs(r.facingOfHead().yaw)).toBeLessThan(1 * DEG)
  })

  test('holds the collarbones still while the neck turns, and puts them back after', () => {
    const r = rig(0.7)
    const shoulderAt = r.shoulder.getWorldPosition(new Vector3())
    const shoulderTurn = r.shoulder.getWorldQuaternion(new Quaternion())
    const onNeck = r.shoulder.position.clone()
    const look = new HeadLook(r.neck, r.head)
    for (let i = 0; i < 60; i++) r.frame(look, around(r, 0.7, 60 * DEG, -20 * DEG), 0.1)
    expect(r.facingOfHead().yaw).toBeCloseTo(60 * DEG, 1)
    expect(r.shoulder.getWorldPosition(new Vector3()).distanceTo(shoulderAt)).toBeLessThan(1e-6)
    expect(r.shoulder.getWorldQuaternion(new Quaternion()).angleTo(shoulderTurn)).toBeLessThan(1e-5)
    expect(r.shoulder.position.distanceTo(onNeck)).toBeGreaterThan(0.01)

    for (let i = 0; i < 80; i++) r.frame(look, null, 0.1)
    expect(r.shoulder.position.distanceTo(onNeck)).toBeLessThan(1e-9)
  })

  test('leaves a collarbone someone else moved where they put it', () => {
    const r = rig(0)
    const look = new HeadLook(r.neck, r.head)
    for (let i = 0; i < 20; i++) r.frame(look, around(r, 0, 40 * DEG, 0), 0.1)
    // A body-shape look widens the shoulders between frames.
    const widened = new Vector3(-0.05, 0.03, 0.1)
    r.shoulder.position.copy(widened)
    for (let i = 0; i < 80; i++) r.frame(look, null, 0.1)
    expect(r.shoulder.position.distanceTo(widened)).toBeLessThan(1e-9)
  })

  test('does nothing without the bones', () => {
    const body = new Object3D()
    expect(() => new HeadLook(null, null).update(body, new Vector3(1, 1, 1), 0.1)).not.toThrow()
  })
})

describe('openJaw', () => {
  /**
   * The head and jaw of Rocketbox `Female_Adult_01` in its bind pose, read from
   * the GLB (in metres): the head bone's X runs up the neck and its Y ahead;
   * `Bip01 MJaw` sits below it, the bottom lip at the jaw's tip.
   */
  function rocketboxJaw() {
    const head = new Object3D()
    head.quaternion.setFromRotationMatrix(
      new Matrix4().makeBasis(
        new Vector3(0, 0.99, 0.16).normalize(),
        new Vector3(0, -0.16, 0.99).normalize(),
        new Vector3(1, 0, 0),
      ),
    )
    head.position.set(0, 1.522, -0.056)
    const jaw = new Object3D()
    jaw.position.set(0.0305, 0.0115, 0)
    jaw.quaternion.set(
      0.0012046514311805367,
      -0.004261384718120098,
      0.7641019821166992,
      0.6450802683830261,
    )
    const lip = new Object3D()
    lip.position.set(0.1055, -0.0233, -0.0009)
    head.add(jaw)
    jaw.add(lip)
    head.updateMatrixWorld(true)
    return { head, jaw, lip }
  }

  test('drops the chin: the bottom lip goes down and a little back', () => {
    const { head, jaw, lip } = rocketboxJaw()
    const closed = lip.getWorldPosition(new Vector3())
    openJaw(jaw, 1)
    head.updateMatrixWorld(true)
    const open = lip.getWorldPosition(new Vector3()).sub(closed)
    expect(open.y).toBeLessThan(-0.015)
    expect(open.z).toBeLessThan(0)
    expect(Math.abs(open.x)).toBeLessThan(0.001)
  })

  test('opens by the level, up to JAW_OPEN', () => {
    const { jaw } = rocketboxJaw()
    const rest = jaw.quaternion.clone()
    openJaw(jaw, 0.5)
    expect(jaw.quaternion.angleTo(rest)).toBeCloseTo(JAW_OPEN / 2)
    jaw.quaternion.copy(rest)
    openJaw(jaw, 3)
    expect(jaw.quaternion.angleTo(rest)).toBeCloseTo(JAW_OPEN)
    jaw.quaternion.copy(rest)
    openJaw(jaw, 0)
    expect(jaw.quaternion.equals(rest)).toBe(true)
  })
})

describe('MixerPose', () => {
  test('takes the overlays off, so they never pile up on a bone whose clip holds still', () => {
    const model = new Object3D()
    const jaw = new Bone()
    jaw.name = 'jaw'
    model.add(jaw)
    const still = new QuaternionKeyframeTrack('jaw.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
    const mixer = new AnimationMixer(model)
    mixer.clipAction(new AnimationClip('idle', 1, [still])).play()
    const animated = new MixerPose(model)
    for (let frame = 0; frame < 10; frame++) {
      animated.restore()
      mixer.update(0.1)
      animated.keep()
      openJaw(jaw, 1)
    }
    expect(jaw.quaternion.angleTo(new Quaternion())).toBeCloseTo(JAW_OPEN)
  })

  test('leaves the bones be until it has kept a pose', () => {
    const model = new Object3D()
    const bone = new Bone()
    bone.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.5)
    model.add(bone)
    new MixerPose(model).restore()
    expect(bone.quaternion.angleTo(new Quaternion())).toBeCloseTo(0.5)
  })
})
