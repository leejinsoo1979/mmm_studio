import { type GltfJson, writeGlb } from './glb'

/**
 * Test fixture: a tiny rigged GLB shaped like a MetaPerson export (root
 * `AvatarRoot`, Mixamo-style joints without a prefix, a head with ARKit and
 * viseme blend shapes, teeth with visemes only, one embedded image), built
 * in code so nothing non-redistributable is committed.
 */

export type TestGlbOptions = {
  joints?: string[]
  /** Blend shape names per mesh (head, teeth). */
  targets?: [string[], string[]]
  /** Edits the glTF JSON before it is written. */
  edit?: (json: GltfJson) => void
}

export const TEST_HEAD_TARGETS = ['jawOpen', 'eyeBlinkLeft', 'mouthSmileLeft', 'eyeBlinkRight']
export const TEST_TEETH_TARGETS = ['CH', 'DD']
export const TEST_IMAGE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

export function testAvatarGlb(options: TestGlbOptions = {}): Uint8Array<ArrayBuffer> {
  const joints = options.joints ?? ['Hips', 'Spine', 'Head']
  const [headTargets, teethTargets] = options.targets ?? [TEST_HEAD_TARGETS, TEST_TEETH_TARGETS]
  const chunks: Uint8Array[] = []
  let length = 0
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = []
  const accessors: Record<string, unknown>[] = []
  const view = (bytes: Uint8Array) => {
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
    padded.set(bytes)
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length })
    chunks.push(padded)
    length += padded.length
    return bufferViews.length - 1
  }
  const accessor = (data: Float32Array | Uint16Array, type: string, extra = {}) => {
    const componentType = data instanceof Float32Array ? 5126 : 5123
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type] ?? 1
    accessors.push({
      bufferView: view(new Uint8Array(data.buffer)),
      componentType,
      count: data.length / size,
      type,
      ...extra,
    })
    return accessors.length - 1
  }
  const triangle = () =>
    accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', {
      min: [0, 0, 0],
      max: [1, 1, 0],
    })
  const primitive = (targets: string[]) => ({
    attributes: {
      POSITION: triangle(),
      JOINTS_0: accessor(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0]), 'VEC4'),
      WEIGHTS_0: accessor(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4'),
    },
    indices: accessor(new Uint16Array([0, 1, 2, 0]), 'SCALAR', { count: 3 }),
    ...(targets.length
      ? {
          targets: targets.map((_, i) => ({
            POSITION: accessor(new Float32Array([0, 0, i * 0.01, 0, 0, 0, 0, 0, 0]), 'VEC3', {
              min: [0, 0, 0],
              max: [0, 0, i * 0.01],
            }),
          })),
        }
      : {}),
  })
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const inverseBindMatrices = accessor(new Float32Array(joints.flatMap(() => identity)), 'MAT4')
  const meshes = [
    { primitives: [primitive(headTargets)], ...meshExtras(headTargets) },
    { primitives: [primitive(teethTargets)], ...meshExtras(teethTargets) },
  ]
  const image = view(TEST_IMAGE)
  const jointNodes = joints.map((name, i) => ({
    name,
    ...(i + 1 < joints.length ? { children: [i + 2] } : {}),
  }))
  const json: GltfJson = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'AvatarRoot', children: [1, joints.length + 1, joints.length + 2] },
      ...jointNodes,
      { name: 'AvatarHead', mesh: 0, skin: 0 },
      { name: 'AvatarTeethLower', mesh: 1, skin: 0 },
    ],
    skins: [{ joints: joints.map((_, i) => i + 1), inverseBindMatrices }],
    meshes,
    materials: [{ name: 'AvatarHead' }, { name: 'haircut', alphaMode: 'BLEND' }],
    images: [{ bufferView: image, mimeType: 'image/png' }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: length }],
  }
  options.edit?.(json)
  const bin = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    bin.set(chunk, at)
    at += chunk.length
  }
  return writeGlb(json, bin)
}

function meshExtras(targets: string[]) {
  return targets.length ? { weights: targets.map(() => 0), extras: { targetNames: targets } } : {}
}
