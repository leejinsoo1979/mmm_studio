import { describe, expect, test } from 'bun:test'
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { applyBodyBones, bodyHeightScale, bodyStrideScale } from './avatar-body'
import { lengthScale } from './body-shape'

/**
 * A body just big enough to hold the bones a build moves: a collarbone and
 * its upper arm, and a head, skinned by a mesh of `material` (a head's, or
 * a whole body made in one piece).
 */
function body(material = 'm001_head') {
  const pelvis = new Bone()
  pelvis.name = 'Bip01_Pelvis'
  const clavicle = new Bone()
  clavicle.name = 'Bip01_L_Clavicle'
  clavicle.position.set(0.05, 0.5, 0)
  const upperArm = new Bone()
  upperArm.name = 'Bip01_L_UpperArm'
  upperArm.position.set(0.14, 0.01, 0)
  const head = new Bone()
  head.name = 'Bip01_Head'
  head.position.set(0, 0.7, 0)
  pelvis.add(clavicle, head)
  clavicle.add(upperArm)

  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([0, 1.7, 0, 0.1, 1.7, 0, 0, 1.8, 0], 3),
  )
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array(12).fill(0), 4))
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  )
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial({ name: material }))
  const model = new Group()
  model.scale.setScalar(1.5)
  model.add(mesh, pelvis)
  model.updateMatrixWorld(true)
  mesh.bind(new Skeleton([pelvis, clavicle, upperArm, head]))
  return { model, clavicle, upperArm, head }
}

describe('a build’s bones', () => {
  test('widen the shoulders along the collarbone, grow the head and scale the body', () => {
    const { model, upperArm, head } = body()
    const reach = upperArm.position.clone()
    applyBodyBones(model, { height: 1, sliders: { shoulders: 1, headSize: -1 } })
    // Along the collarbone: the same direction, further out.
    expect(upperArm.position.clone().normalize().dot(reach.clone().normalize())).toBeCloseTo(1, 6)
    expect(upperArm.position.length()).toBeGreaterThan(reach.length() * 1.1)
    expect(head.scale.x).toBeLessThan(0.95)
    expect(head.scale.x).toBeCloseTo(head.scale.z, 6)
    expect(model.scale.x).toBeCloseTo(1.5 * bodyHeightScale({ height: 1, sliders: {} }), 6)
    expect(bodyHeightScale({ height: 1, sliders: {} })).toBeGreaterThan(1.1)
    expect(bodyHeightScale({ height: -1, sliders: {} })).toBeLessThan(0.9)
  })

  test('make room for the arms by a filled-out trunk, but not by a slimmed one', () => {
    const { model, upperArm } = body()
    const reach = upperArm.position.length()
    const undo = applyBodyBones(model, { height: 0, sliders: { weight: 1 } })
    expect(upperArm.position.length()).toBeGreaterThan(reach)
    undo()
    applyBodyBones(model, { height: 0, sliders: { weight: -1 } })
    expect(upperArm.position.length()).toBe(reach)
  })

  test('give the arms only so much room, so narrowed shoulders still read narrower', () => {
    const { model, upperArm } = body()
    const reach = upperArm.position.length()
    const heaviest = { weight: 1, waist: 1, hips: 1, muscle: 1, belly: 1 }
    let undo = applyBodyBones(model, { height: 0, sliders: heaviest })
    const roomiest = upperArm.position.length()
    undo()
    undo = applyBodyBones(model, { height: 0, sliders: { weight: 1 } })
    expect(upperArm.position.length()).toBeCloseTo(roomiest, 9)
    undo()
    undo = applyBodyBones(model, { height: 0, sliders: { shoulders: 1 } })
    const widest = upperArm.position.length()
    undo()
    // The room is well short of what the shoulders slider reaches.
    expect(roomiest - reach).toBeLessThan((widest - reach) * 0.6)
    applyBodyBones(model, { height: 0, sliders: { ...heaviest, shoulders: -1 } })
    expect(upperArm.position.length()).toBeLessThan(reach - (roomiest - reach) * 0.8)
  })

  test('reach the bones of a body made all in one piece, with no head mesh', () => {
    const { model, upperArm, head } = body('f204')
    const reach = upperArm.position.length()
    applyBodyBones(model, { height: 0, sliders: { shoulders: 1, headSize: 1 } })
    expect(upperArm.position.length()).toBeGreaterThan(reach * 1.1)
    expect(head.scale.x).toBeGreaterThan(1.05)
  })

  test('are put back exactly', () => {
    const { model, clavicle, upperArm, head } = body()
    const before = [
      model.scale,
      clavicle.position,
      upperArm.position,
      head.scale,
      head.position,
    ].map((vector) => vector.toArray())
    const undo = applyBodyBones(model, {
      height: -0.7,
      sliders: { shoulders: -0.3, headSize: 0.8, waist: 1 },
    })
    undo()
    expect(
      [model.scale, clavicle.position, upperArm.position, head.scale, head.position].map((vector) =>
        vector.toArray(),
      ),
    ).toEqual(before)
  })

  test('leave be what something else has set since', () => {
    const { model, head } = body()
    const undo = applyBodyBones(model, { height: 0.5, sliders: { headSize: 1 } })
    head.scale.setScalar(2)
    undo()
    expect(head.scale.toArray()).toEqual([2, 2, 2])
    expect(model.scale.x).toBe(1.5)
  })
})

/** How far (cm, in the Avatar node's units) the test body's hip joints stand above its ankles. */
const LEGS = 80
/** How far (cm) its spine's first joint stands below its neck's. */
const SPINE = 50

/**
 * A body standing as Rocketbox's do: the hips' bone under an Avatar node
 * at their height (0.9 m), counting in centimetres; the thighs hanging from
 * the spine's first bone; and its bind pose quantized, in a frame of its
 * own that the model's is a scaled and shifted copy of.
 */
function standing() {
  const model = new Group()
  const avatar = new Group()
  avatar.name = 'Avatar'
  avatar.position.set(0, 0.9, 0)
  avatar.scale.setScalar(0.01)
  model.add(avatar)
  const all: Bone[] = []
  const bone = (name: string, parent: Object3D, x: number, y: number) => {
    const made = new Bone()
    made.name = name
    made.position.set(x, y, 0)
    parent.add(made)
    all.push(made)
    return made
  }
  const pelvis = bone('Bip01_Pelvis', avatar, 0, 0)
  const spine = bone('Bip01_Spine', pelvis, 0, 10)
  const spine1 = bone('Bip01_Spine1', spine, 0, 15)
  const spine2 = bone('Bip01_Spine2', spine1, 0, 15)
  const neck = bone('Bip01_Neck', spine2, 0, SPINE - 30)
  const head = bone('Bip01_Head', neck, 0, 7)
  const legs = (['L', 'R'] as const).map((side) => {
    const thigh = bone(`Bip01_${side}_Thigh`, spine, side === 'L' ? 9 : -9, -10)
    const calf = bone(`Bip01_${side}_Calf`, thigh, 0, -LEGS / 2)
    const foot = bone(`Bip01_${side}_Foot`, calf, 0, -LEGS / 2)
    return { thigh, calf, foot }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([0, 0, 0, 0], 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0], 4))
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial({ name: 'm001_body' }))
  model.add(mesh)
  model.updateMatrixWorld(true)
  const quantized = new Matrix4().makeScale(0.9, 0.9, 0.9).setPosition(0, 0.9, 0)
  mesh.bind(
    new Skeleton(
      all,
      all.map((each) => each.matrixWorld.clone().invert().multiply(quantized)),
    ),
    new Matrix4(),
  )
  return { model, avatar, pelvis, spine1, spine2, neck, head, legs }
}

/** Where something stands, up from the model's feet. */
function heightOf(object: Object3D) {
  object.updateWorldMatrix(true, false)
  return new Vector3().setFromMatrixPosition(object.matrixWorld).y
}

/** Bends both knees by `angle` and dips the hips (as a clip would) so the feet stay where they stood. */
function crouch(body: ReturnType<typeof standing>, angle: number) {
  for (const { thigh, calf } of body.legs) {
    thigh.rotation.x = angle
    calf.rotation.x = -2 * angle
  }
  body.pelvis.position.y = -LEGS * (1 - Math.cos(angle))
}

describe('a build’s lengths', () => {
  test('lengthen the legs along the thigh and the shin, raising the body off its feet', () => {
    const body = standing()
    const [{ calf, foot }] = body.legs as [(typeof body.legs)[number]]
    const [calfAt, footAt] = [calf.position.clone(), foot.position.clone()]
    const [feet, head] = [heightOf(foot), heightOf(body.head)]
    const build = { height: 0, sliders: { legLength: 1 } }
    const longer = lengthScale(build, 'legLength')
    applyBodyBones(body.model, build)
    expect(longer).toBeGreaterThan(1.05)
    expect(calf.position.toArray()).toEqual(calfAt.multiplyScalar(longer).toArray())
    expect(foot.position.toArray()).toEqual(footAt.multiplyScalar(longer).toArray())
    expect(heightOf(foot)).toBeCloseTo(feet, 9)
    expect(heightOf(body.head) - head).toBeCloseTo((longer - 1) * LEGS * 0.01, 9)
  })

  test('shorten them as far the other way, the feet still on the floor', () => {
    const body = standing()
    const [{ foot }] = body.legs as [(typeof body.legs)[number]]
    const [feet, head] = [heightOf(foot), heightOf(body.head)]
    const build = { height: 0, sliders: { legLength: -1 } }
    applyBodyBones(body.model, build)
    expect(heightOf(foot)).toBeCloseTo(feet, 9)
    expect(head - heightOf(body.head)).toBeCloseTo(
      (1 - lengthScale(build, 'legLength')) * LEGS * 0.01,
      9,
    )
  })

  test('keep the feet down as the clips dip the hips onto bent knees, whatever the height', () => {
    for (const build of [
      { height: 0, sliders: { legLength: 1 } },
      { height: 0, sliders: { legLength: -1 } },
      { height: -0.6, sliders: { legLength: 0.7, torsoLength: 1 } },
    ]) {
      const body = standing()
      const [{ foot }] = body.legs as [(typeof body.legs)[number]]
      const scale = body.model.scale.clone()
      crouch(body, 0.9)
      const feet = heightOf(foot)
      applyBodyBones(body.model, build)
      expect(heightOf(foot)).toBeCloseTo(feet * (body.model.scale.y / scale.y), 9)
      // The clip's next frame sets the hips' dip again: the same.
      crouch(body, 0.9)
      expect(heightOf(foot)).toBeCloseTo(feet * (body.model.scale.y / scale.y), 9)
    }
  })

  test('lengthen the torso along the spine, raising the neck and the head but not the legs', () => {
    const body = standing()
    const [{ thigh, foot }] = body.legs as [(typeof body.legs)[number]]
    const before = [body.spine1, body.spine2, body.neck].map((bone) => bone.position.clone())
    const [hips, feet, head] = [heightOf(thigh), heightOf(foot), heightOf(body.head)]
    const build = { height: 0, sliders: { torsoLength: 1 } }
    const longer = lengthScale(build, 'torsoLength')
    applyBodyBones(body.model, build)
    expect(longer).toBeGreaterThan(1.05)
    ;[body.spine1, body.spine2, body.neck].forEach((bone, k) => {
      expect(bone.position.toArray()).toEqual(before[k]!.clone().multiplyScalar(longer).toArray())
    })
    expect(heightOf(thigh)).toBeCloseTo(hips, 9)
    expect(heightOf(foot)).toBeCloseTo(feet, 9)
    expect(heightOf(body.head) - head).toBeCloseTo((longer - 1) * SPINE * 0.01, 9)
  })

  test('are put back exactly', () => {
    const body = standing()
    const vectors = [
      body.avatar.position,
      body.avatar.scale,
      body.pelvis.scale,
      body.spine1.position,
      body.spine2.position,
      body.neck.position,
      ...body.legs.flatMap(({ calf, foot }) => [calf.position, foot.position]),
    ]
    const before = vectors.map((vector) => vector.toArray())
    const undo = applyBodyBones(body.model, {
      height: 0.4,
      sliders: { legLength: -0.6, torsoLength: 0.8 },
    })
    expect(vectors.map((vector) => vector.toArray())).not.toEqual(before)
    undo()
    expect(vectors.map((vector) => vector.toArray())).toEqual(before)
  })

  test('scale the strides by the legs, and the height by the legs and the torso', () => {
    const plain = { height: 0, sliders: {} }
    const legs = { height: 0, sliders: { legLength: 1 } }
    const torso = { height: 0, sliders: { torsoLength: 1 } }
    expect(bodyStrideScale(plain)).toBe(1)
    expect(bodyHeightScale(plain)).toBe(1)
    expect(bodyStrideScale(legs)).toBeCloseTo(lengthScale(legs, 'legLength'), 9)
    expect(bodyStrideScale(torso)).toBe(1)
    // The legs are about half the body's height, the spine about a quarter.
    expect(bodyHeightScale(legs) - 1).toBeCloseTo((bodyStrideScale(legs) - 1) / 2, 1)
    expect(bodyHeightScale(torso)).toBeGreaterThan(1.02)
    expect(bodyHeightScale(torso)).toBeLessThan(bodyHeightScale(legs))
    const tall = { height: 1, sliders: { legLength: -1 } }
    expect(bodyStrideScale(tall)).toBeCloseTo(
      bodyStrideScale({ height: 1, sliders: {} }) * lengthScale(tall, 'legLength'),
      9,
    )
  })
})
