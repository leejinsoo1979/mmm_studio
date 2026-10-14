// The photo avatar bench's page: ground-truth heads photographed under known cameras and lights,
// photo avatars made from those photos by the app's own reading (apps/editor/lib/photo-capture) and
// the package's real worker, and every gate quantity measured against the truth. Driven over CDP by
// scripts/photo-avatar/bench.ts, which calls `window.bench.*`.
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { texture } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { detectFaces, sampleIrisColor } from '../../../apps/editor/lib/face-detect'
import { runGuidedCapture } from '../../../apps/editor/lib/guided-capture'
import { finishPhotos, type ReadPhoto, readPhoto } from '../../../apps/editor/lib/photo-capture'
import {
  type Check,
  g1Checks,
  g2Checks,
  g4SingleChecks,
  g4ThreeChecks,
  GATES,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/gates'
import {
  deltaERgb,
  luminance,
  medianRgb,
  type Rgb,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/colour'
import {
  encodeTruth,
  type FixtureView,
  packMap,
  toBase64,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/fixture'
import {
  type GeometryReport,
  measureFit,
  skullVertices,
  type TruthHead,
  truthHead,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/__bench__/measure'
import type {
  AvatarJobReport,
  CaptureSlot,
  CaptureView,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/avatar-job'
import type { BaseBody } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/base-body'
import { loadBaseBody } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/base-files'
import { buildPhotoAvatar } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/build-client'
import type { Camera } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/camera'
import { startGuide } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/capture-guide'
import { landmarkUvs } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/features'
import { parseGlb, readPrimitives } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/glb'
import {
  landmarkPosition,
  shapePositions,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/head-model'
import { OVAL } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/landmark-sets'
import {
  applySimilarity,
  similarity,
  type Vec3,
} from '../../../packages/editor/src/components/editor/first-person/photo-avatar/linalg'
import { transformPoint4 } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/mat4'
import { profileError } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/profile'
import { classMap } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/segment'
import { fillTriangles } from '../../../packages/editor/src/components/editor/first-person/photo-avatar/silhouette'
import { retargetClip, rigRest } from '../../../packages/editor/src/components/editor/first-person/humanoid-rig'
import { preparePhotorealModel } from '../../../packages/editor/src/components/editor/first-person/photoreal-model'
import { prepareWebGPURenderer } from '../../../packages/viewer/src/lib/webgpu-renderer'

type Gender = 'male' | 'female'

/** A head the bench photographs (see scripts/photo-avatar/heads.ts). */
type HeadSpec = {
  id: string
  kind: 'rocketbox' | 'mpfb' | 'scan'
  url: string
  /** A second file: the same head with a small expression (MPFB heads). */
  expressionUrl?: string
  /** For a scan: its colour map, and the scale that makes it an adult's size. */
  map?: string
  scale?: number
  gender: Gender
  absoluteScale: boolean
  /** A tint on its skin (linear RGB factors). */
  tint?: [number, number, number]
  bald?: boolean
}

type Light = 'soft' | 'hard'

/** A photo of the head: its turn (degrees), the camera and the light. */
type ShotSpec = {
  yaw: number
  pitch: number
  roll: number
  width: number
  height: number
  /** Focal length in pixels. */
  focal: number
  /** How much of the image's height the head (chin to crown, ~24 cm) fills. */
  fill: number
  /** Where the eyes land off the image's centre (pixels). */
  shift: [number, number]
  light: Light
  /** A small expression, 0–1. */
  expression: number
  format: 'png' | 'jpeg'
  quality?: number
}

const LIGHTS: Record<Light, { key: number; hemi: number; env: number; from: Vec3 }> = {
  soft: { key: 1.6, hemi: 0.6, env: 0.55, from: [0.6, 1.2, 1.6] },
  hard: { key: 3.2, hemi: 0.25, env: 0.25, from: [1.4, 0.9, 0.6] },
}

const HEAD_HEIGHT = 0.24

const canvas = document.getElementById('c') as HTMLCanvasElement
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const errors: string[] = []

let renderer: THREE.WebGPURenderer
let scene: THREE.Scene
let key: THREE.DirectionalLight
let hemi: THREE.HemisphereLight

// ---------------------------------------------------------------------------------------------
// Setup and rendering

async function init() {
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true })
  renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.NeutralToneMapping
  await renderer.init()
  prepareWebGPURenderer(renderer, 'bench')
  const device = (renderer.backend as { device?: GPUDevice }).device
  device?.addEventListener('uncapturederror', (e) =>
    errors.push((e as GPUUncapturedErrorEvent).error.message),
  )
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#cfcac4')
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  scene.environment = pmrem.fromScene(room, 0.04).texture
  room.dispose()
  key = new THREE.DirectionalLight('#ffffff', 1.6)
  hemi = new THREE.HemisphereLight('#ffffff', '#8a8079', 0.6)
  scene.add(key, key.target, hemi)
  await device?.queue.onSubmittedWorkDone()
  pmrem.dispose()
  return { backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl' }
}

function setSize(width: number, height: number) {
  canvas.width = width
  canvas.height = height
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  renderer.setSize(width, height, false)
}

async function draw(camera: THREE.Camera) {
  renderer.render(scene, camera)
  await (renderer.backend as { device?: GPUDevice }).device?.queue.onSubmittedWorkDone()
}

/** The canvas as it was last drawn: pixels (RGBA). */
async function pixels(): Promise<ImageData> {
  // A WebGPU canvas drawn into a 2D one reads back blank once presented; its PNG does not.
  const bitmap = await createImageBitmap(await (await fetch(canvas.toDataURL('image/png'))).blob())
  const copy = document.createElement('canvas')
  copy.width = bitmap.width
  copy.height = bitmap.height
  const context = copy.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0)
  return context.getImageData(0, 0, copy.width, copy.height)
}

function setLight(light: Light, pivot: THREE.Vector3) {
  const l = LIGHTS[light]
  key.intensity = l.key
  hemi.intensity = l.hemi
  scene.environmentIntensity = l.env
  key.position.set(pivot.x + l.from[0], pivot.y + l.from[1], pivot.z + l.from[2])
  key.target.position.copy(pivot)
  key.updateMatrixWorld()
  key.target.updateMatrixWorld()
}

/** A three camera at `position` looking down −z, with a pinhole of `focal` pixels on `width` × `height`. */
function pinhole(width: number, height: number, focal: number, position: THREE.Vector3) {
  const fov = (2 * Math.atan(height / 2 / focal) * 180) / Math.PI
  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.02, 20)
  camera.position.copy(position)
  camera.updateMatrixWorld()
  return camera
}

/** A three camera at the origin looking down −z, projecting as a solved photo camera does (its own principal point). */
function solvedCamera(c: Camera) {
  const camera = new THREE.PerspectiveCamera(
    (2 * Math.atan(c.height / 2 / c.focal) * 180) / Math.PI,
    c.width / c.height,
    0.02,
    20,
  )
  camera.updateProjectionMatrix()
  const e = camera.projectionMatrix.elements
  e[8] = 1 - (2 * c.cx) / c.width
  e[9] = (2 * c.cy) / c.height - 1
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
  camera.updateMatrixWorld()
  return camera
}

/** The matrix putting a fitted head's frame where a solved camera sees it (GL camera space). */
function solvedPlacement(c: Camera) {
  const r = c.rotation
  const t = c.translation
  return new THREE.Matrix4().set(
    r[0],
    r[1],
    r[2],
    t[0],
    -r[3],
    -r[4],
    -r[5],
    -t[1],
    -r[6],
    -r[7],
    -r[8],
    -t[2],
    0,
    0,
    0,
    1,
  )
}

// ---------------------------------------------------------------------------------------------
// The truth

type Truth = {
  spec: HeadSpec
  holder: THREE.Group
  model: THREE.Object3D
  expression: THREE.Object3D | null
  /** Its skin in its own frame (scaled to metres), and its texture's colour at each vertex (−1: none). */
  positions: Float32Array
  triangles: Uint32Array
  colours: Int16Array
  /** Which vertices are bare skin, for the skull and for the face's outline (undefined: all). */
  bare?: { skull: Uint8Array; face: Uint8Array; hair: Rgb | null }
  /** The point it turns about (between the eyes), in its frame. */
  pivot: THREE.Vector3
  hair: { meshes: THREE.Mesh[]; albedo: Rgb | null }
  landmarks: (Vec3 | null)[] | null
  summary: TruthHead | null
  bones: Map<string, { bone: THREE.Object3D; rest: THREE.Quaternion }>
}

let truth: Truth | null = null

async function textureMedian(texture: THREE.Texture | null | undefined): Promise<Rgb | null> {
  const image = texture?.image as CanvasImageSource & { width: number; height: number }
  if (!image?.width) return null
  const c = document.createElement('canvas')
  c.width = Math.min(512, image.width)
  c.height = Math.min(512, image.height)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(image, 0, 0, c.width, c.height)
  const { data } = g.getImageData(0, 0, c.width, c.height)
  return medianRgb(data, (i) => data[i * 4 + 3]! > 128)
}

/** The skin of a loaded model, at rest, in its frame, as positions and triangles (and each vertex's texture colour). */
function skinOf(meshes: THREE.Mesh[], scale: number) {
  const positions: number[] = []
  const triangles: number[] = []
  const colours: number[] = []
  const v = new THREE.Vector3()
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true)
    const g = mesh.geometry
    const offset = positions.length / 3
    const count = g.attributes.position!.count
    const image = imageOf((mesh.material as THREE.MeshStandardMaterial).map)
    const uv = g.attributes.uv as THREE.BufferAttribute | undefined
    for (let i = 0; i < count; i++) {
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).getVertexPosition(i, v)
      else v.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i)
      v.applyMatrix4(mesh.matrixWorld)
      positions.push(v.x * scale, v.y * scale, v.z * scale)
      if (image && uv) {
        const x = Math.min(image.width - 1, Math.max(0, Math.floor(uv.getX(i) * image.width)))
        const y = Math.min(image.height - 1, Math.max(0, Math.floor(uv.getY(i) * image.height)))
        const at = (y * image.width + x) * 4
        colours.push(image.data[at]!, image.data[at + 1]!, image.data[at + 2]!)
      } else colours.push(-1, -1, -1)
    }
    const index = g.index
    const n = index ? index.count : count
    for (let i = 0; i < n; i++) triangles.push(offset + (index ? index.getX(i) : i))
  }
  return {
    positions: Float32Array.from(positions),
    triangles: Uint32Array.from(triangles),
    colours: Int16Array.from(colours),
  }
}

/** A texture's picture as pixels (at most 1024 a side), or null. */
function imageOf(texture: THREE.Texture | null | undefined): ImageData | null {
  const image = texture?.image as CanvasImageSource & { width: number; height: number }
  if (!image?.width) return null
  const c = document.createElement('canvas')
  c.width = Math.min(1024, image.width)
  c.height = Math.min(1024, image.height)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(image, 0, 0, c.width, c.height)
  return g.getImageData(0, 0, c.width, c.height)
}

/** Further than this (CIEDE2000) from the face's skin, a head texture's texel is painted hair. */
const HAIR_FROM_SKIN = 12

/**
 * Which of the truth's vertices are bare skin, not hair modelled into the
 * head and painted on it (Rocketbox heads carry their hair so): its texture's
 * colour against the skin's colour about the cheeks and the forehead.
 */
function bareSkin(t: Truth, landmarks: (Vec3 | null)[]): Truth['bare'] {
  if (t.spec.kind !== 'rocketbox') return undefined
  const n = t.positions.length / 3
  const near = (i: number, l: number) => {
    const p = landmarks[l]
    if (!p) return false
    return Math.hypot(t.positions[i * 3]! - p[0], t.positions[i * 3 + 1]! - p[1], t.positions[i * 3 + 2]! - p[2]) < 0.015
  }
  const reference: number[] = []
  for (let i = 0; i < n; i++)
    if (t.colours[i * 3]! >= 0 && (near(i, 50) || near(i, 280) || near(i, 151))) reference.push(i)
  const data = new Uint8ClampedArray(reference.length * 4)
  reference.forEach((i, k) => data.set([t.colours[i * 3]!, t.colours[i * 3 + 1]!, t.colours[i * 3 + 2]!, 255], k * 4))
  const skin = medianRgb(data, () => true)
  const skull = new Uint8Array(n).fill(1)
  const face = new Uint8Array(n).fill(1)
  if (!skin) return { skull, face, hair: null }
  // Only above the brows or behind the face: brows, lips and a beard are the face's own surface.
  // For the face's outline and width, only above the mouth's corners too (a beard down the jaw).
  const brows = Math.max(landmarks[105]?.[1] ?? 0, landmarks[334]?.[1] ?? 0) + 0.005
  const front = (landmarks[168]?.[2] ?? 0) - 0.03
  const mouth = Math.max(landmarks[61]?.[1] ?? 0, landmarks[291]?.[1] ?? 0)
  for (let i = 0; i < n; i++) {
    if (t.colours[i * 3]! < 0) continue
    const y = t.positions[i * 3 + 1]!
    const z = t.positions[i * 3 + 2]!
    if (y < brows && z > front) continue
    const c: Rgb = [t.colours[i * 3]!, t.colours[i * 3 + 1]!, t.colours[i * 3 + 2]!]
    if (deltaERgb(c, skin) <= HAIR_FROM_SKIN) continue
    skull[i] = 0
    if (y > mouth) face[i] = 0
  }
  // The hair painted on the scalp (a buzz cut has no other), from well above the brows.
  const scalp: number[] = []
  for (let i = 0; i < n; i++) if (!skull[i] && t.positions[i * 3 + 1]! > brows + 0.03) scalp.push(i)
  const painted = new Uint8ClampedArray(scalp.length * 4)
  scalp.forEach((i, k) => painted.set([t.colours[i * 3]!, t.colours[i * 3 + 1]!, t.colours[i * 3 + 2]!, 255], k * 4))
  // Hair's lighter strands read as skin here and there: the skull's hair grown by a ring of vertices.
  const grown = Uint8Array.from(skull)
  for (let k = 0; k < t.triangles.length; k += 3) {
    const corners = [t.triangles[k]!, t.triangles[k + 1]!, t.triangles[k + 2]!]
    if (corners.some((v) => !skull[v])) for (const v of corners) grown[v] = 0
  }
  return { skull: grown, face, hair: scalp.length ? medianRgb(painted, () => true) : null }
}

async function loadTruth(spec: HeadSpec) {
  if (truth) scene.remove(truth.holder)
  const gltf = await loader.loadAsync(spec.url)
  const source = gltf.scene
  const skin: THREE.Mesh[] = []
  const hair: THREE.Mesh[] = []
  if (spec.kind === 'scan') {
    const map = await new THREE.TextureLoader().loadAsync(spec.map!)
    map.colorSpace = THREE.SRGBColorSpace
    source.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.material = new THREE.MeshStandardMaterial({ map, roughness: 0.6, name: 'scan_skin' })
      skin.push(mesh)
    })
  } else {
    source.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as THREE.MeshStandardMaterial
      const name = material.name
      if (spec.kind === 'rocketbox') {
        if (/_head$/.test(name)) skin.push(mesh)
        // Its hair and lashes are cut from cards on this material: drawn as hair.
        if (/_opacity$/.test(name)) {
          material.name = `${name}_hair`
          hair.push(mesh)
        }
      } else {
        if (name === 'Head_Skin' || name === 'Body_Skin') {
          skin.push(mesh)
          if (spec.tint) material.color.setRGB(...spec.tint)
        }
        if (mesh.name === 'Hair' || name === 'Hair') {
          hair.push(mesh)
          if (spec.bald) mesh.visible = false
        }
      }
    })
  }
  const scale = spec.scale ?? 1
  const { positions, triangles, colours } = skinOf(skin, scale)
  const model = preparePhotorealModel(source)
  model.scale.setScalar(scale)
  const holder = new THREE.Group()
  holder.matrixAutoUpdate = false
  holder.add(model)
  let expression: THREE.Object3D | null = null
  if (spec.expressionUrl) {
    const other = await loader.loadAsync(spec.expressionUrl)
    other.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as THREE.MeshStandardMaterial
      if (spec.tint && (material.name === 'Head_Skin' || material.name === 'Body_Skin'))
        material.color.setRGB(...spec.tint)
      if (spec.bald && (mesh.name === 'Hair' || material.name === 'Hair')) mesh.visible = false
    })
    expression = preparePhotorealModel(other.scene)
    expression.visible = false
    holder.add(expression)
  }
  scene.add(holder)
  // Between the eyes: about 11 cm under the top of its skin, centred on the head's top 30 cm.
  let top = Number.NEGATIVE_INFINITY
  for (let i = 1; i < positions.length; i += 3) top = Math.max(top, positions[i]!)
  const box = new THREE.Box3()
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1]! > top - 0.3)
      box.expandByPoint(new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]))
  }
  const centre = box.getCenter(new THREE.Vector3())
  const pivot = new THREE.Vector3(centre.x, top - 0.45 * Math.min(box.max.y - box.min.y, 0.26), centre.z)
  const bones = new Map<string, { bone: THREE.Object3D; rest: THREE.Quaternion }>()
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, { bone: o, rest: o.quaternion.clone() })
  })
  let albedo: Rgb | null = null
  for (const mesh of hair) {
    albedo ??= await textureMedian((mesh.material as THREE.MeshStandardMaterial).map)
  }
  truth = {
    spec,
    holder,
    model,
    expression,
    positions,
    triangles,
    colours,
    pivot,
    hair: { meshes: hair, albedo: spec.bald ? null : albedo },
    landmarks: null,
    summary: null,
    bones,
  }
  return {
    vertices: positions.length / 3,
    triangles: triangles.length / 3,
    pivot: pivot.toArray(),
    hairAlbedo: truth.hair.albedo,
    hairClass: hairClass(truth.model, hair.filter((m) => m.visible), pivot, { positions, triangles }, scale),
    bones: bones.size,
  }
}

/**
 * A small expression on a Rocketbox head (its face bones): the jaw a little
 * open, the mouth's corners and the brows a little raised. MPFB heads switch
 * to their expression file.
 */
function setExpression(amount: number) {
  if (!truth) return
  if (truth.expression) {
    truth.expression.visible = amount > 0
    truth.model.visible = amount <= 0
    return
  }
  for (const { bone, rest } of truth.bones.values()) bone.quaternion.copy(rest)
  if (amount <= 0) return
  const turn = (name: string, axis: Vec3, degrees: number) => {
    const found = truth!.bones.get(name)
    if (!found) return
    found.bone.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), (degrees * amount * Math.PI) / 180),
    )
  }
  turn('Bip01 MJaw', [0, 0, 1], 5)
  turn('Bip01 LMouthCorner', [0, 1, 0], 6)
  turn('Bip01 RMouthCorner', [0, 1, 0], -6)
  turn('Bip01 LInnerEyebrow', [0, 0, 1], 4)
  turn('Bip01 RInnerEyebrow', [0, 0, 1], 4)
}

/** Where the turned head is, and the camera that photographs it. */
function posed(shot: ShotSpec, s = 1) {
  const t = truth!
  const pivot = t.pivot.clone()
  const turn = new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationZ((shot.roll * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationY((shot.yaw * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeRotationX((-shot.pitch * Math.PI) / 180))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
  const distance = (shot.focal * HEAD_HEIGHT) / (shot.fill * shot.height)
  const position = new THREE.Vector3(
    pivot.x - (shot.shift[0] * distance) / shot.focal,
    pivot.y + (shot.shift[1] * distance) / shot.focal,
    pivot.z + distance,
  )
  void s
  return { turn, camera: pinhole(shot.width, shot.height, shot.focal, position), pivot, distance, position }
}

async function photograph(shots: ShotSpec[]) {
  const t = truth!
  const out: { url: string; distance: number }[] = []
  for (const shot of shots) {
    setSize(shot.width, shot.height)
    const { turn, camera, pivot, distance } = posed(shot)
    t.holder.visible = true
    t.holder.matrix.copy(turn)
    t.holder.updateMatrixWorld(true)
    setExpression(shot.expression)
    setLight(shot.light, pivot)
    await draw(camera)
    out.push({
      url:
        shot.format === 'jpeg'
          ? canvas.toDataURL('image/jpeg', shot.quality ?? 0.75)
          : canvas.toDataURL('image/png'),
      distance,
    })
  }
  setExpression(0)
  return out
}

/** The truth's MediaPipe landmarks on its skin: found in a front photo (`shot`), each cast back onto the skin. */
async function liftLandmarks(url: string, shot: ShotSpec) {
  const t = truth!
  const image = await createImageBitmap(await (await fetch(url)).blob())
  const { largest } = await detectFaces(image)
  if (!largest) throw new Error('no face in the truth photo')
  const { turn, camera } = posed(shot)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(t.positions, 3))
  g.setIndex(new THREE.BufferAttribute(t.triangles, 1))
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  mesh.matrixAutoUpdate = false
  mesh.matrix.copy(turn)
  mesh.updateMatrixWorld(true)
  const back = turn.clone().invert()
  const ray = new THREE.Raycaster()
  const landmarks: (Vec3 | null)[] = []
  largest.points.forEach(([x, y]) => {
    ray.setFromCamera(new THREE.Vector2((x / shot.width) * 2 - 1, -(y / shot.height) * 2 + 1), camera)
    const hit = ray.intersectObject(mesh, false)[0]
    landmarks.push(hit ? (hit.point.clone().applyMatrix4(back).toArray() as Vec3) : null)
  })
  t.landmarks = landmarks
  t.bare = bareSkin(t, landmarks)
  t.summary = truthHead({ positions: t.positions, triangles: t.triangles }, landmarks, {
    absoluteScale: t.spec.absoluteScale,
    bare: t.bare?.skull,
    bareFace: t.bare?.face,
  })
  return {
    bareShare: t.bare ? t.bare.skull.reduce((a, b) => a + b, 0) / t.bare.skull.length : 1,
    lifted: landmarks.filter(Boolean).length,
    paintedHair: t.bare?.hair ?? null,
    yaw: largest.yaw,
    pitch: largest.pitch,
    summary: encodeTruth(t.summary),
  }
}

// ---------------------------------------------------------------------------------------------
// Building

type Built = {
  glb: Uint8Array
  /** The worker's report (null for a file made outside the page: see adopt). */
  report: AvatarJobReport | null
  base: BaseBody
  positions: Float64Array
  url: string
  views: CaptureView[]
  slots: CaptureSlot[]
  gender: Gender
}

const builds = new Map<string, Built>()
const reads = new Map<string, ReadPhoto>()

const cloneView = (v: CaptureView): CaptureView => ({
  ...v,
  rgba: Uint8ClampedArray.from(v.rgba),
  mask: v.mask && Uint8Array.from(v.mask),
  skin: v.skin && Uint8Array.from(v.skin),
  covered: v.covered && Uint8Array.from(v.covered),
  landmarks: v.landmarks && Float32Array.from(v.landmarks),
  classes: v.classes && { ...v.classes, planes: Uint8Array.from(v.classes.planes) },
})

/** A photo read as the app reads it (once per photo; each build gets its own copy). */
async function read(url: string, slot: CaptureSlot): Promise<ReadPhoto> {
  const known = reads.get(`${slot}|${url.length}|${url.slice(-64)}`)
  if (known) return { ...known, view: cloneView(known.view) }
  const image = await createImageBitmap(await (await fetch(url)).blob())
  const photo = await readPhoto(image, slot)
  reads.set(`${slot}|${url.length}|${url.slice(-64)}`, { ...photo, view: cloneView(photo.view) })
  return photo
}

/** Every base mesh vertex of the fitted head, as the built file holds it: the region's positions. */
async function fittedRegion(glb: Uint8Array, base: BaseBody): Promise<Float64Array> {
  const primitives = await readPrimitives(parseGlb(glb))
  const world = Float64Array.from(base.basemesh)
  for (const p of primitives) {
    const mh = p.attributes._MHVERT?.values
    if (!mh) continue
    const values = p.attributes.POSITION!.values
    for (let i = 0; i < mh.length; i++) {
      const q = transformPoint4(base.packing, values[i * 3]!, values[i * 3 + 1]!, values[i * 3 + 2]!)
      world.set(q, mh[i]! * 3)
    }
  }
  const { vertices } = base.head
  const out = new Float64Array(vertices.length * 3)
  for (let i = 0; i < vertices.length; i++) out.set(world.subarray(vertices[i]! * 3, vertices[i]! * 3 + 3), i * 3)
  return out
}

async function build({
  name,
  photos,
  gender,
  worker = './avatar-worker.js',
}: {
  name: string
  photos: { url: string; slot: CaptureSlot }[]
  gender: Gender
  worker?: string
}) {
  const t0 = performance.now()
  const read_: ReadPhoto[] = []
  for (const { url, slot } of photos) read_.push(await read(url, slot))
  const colors = finishPhotos(read_)
  if (!colors) throw new Error('no face in the front photo')
  const tRead = performance.now()
  const views = read_.map((r) => r.view)
  const kept = views.map(cloneView)
  const progress: [string, number, number][] = []
  const result = await buildPhotoAvatar(
    { gender, views, colors },
    (p) => progress.push([p.stage, +p.fraction.toFixed(2), Math.round(performance.now() - tRead)]),
    undefined,
    () => new Worker(worker, { type: 'module' }),
  )
  const tBuilt = performance.now()
  const base = await loadBaseBody(gender)
  const positions = await fittedRegion(result.glb, base)
  const old = builds.get(name)
  if (old) URL.revokeObjectURL(old.url)
  builds.set(name, {
    glb: result.glb,
    report: result.report,
    base,
    positions,
    url: URL.createObjectURL(new Blob([result.glb as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' })),
    views: kept,
    slots: photos.map((p) => p.slot),
    gender,
  })
  return {
    colors,
    bytes: result.glb.byteLength,
    seconds: { read: (tRead - t0) / 1000, build: (tBuilt - tRead) / 1000 },
    progress,
    views: result.report.views.map((v, k) => ({
      slot: photos[k]!.slot,
      landmarks: Boolean(kept[k]!.landmarks),
      yaw: (v.yaw * 180) / Math.PI,
      landmarksMm: v.landmarksMm,
      skinOutlinePoints: v.skinOutlinePoints,
      skinOutlineMm: v.skinOutlineMm,
    })),
    lightFit: result.report.lightFit,
    photoShare: result.report.photoShare,
    hair: result.report.hair,
    jobSeconds: result.report.seconds,
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry

async function measure(name: string) {
  const b = builds.get(name)!
  const t = truth!
  const report = measureFit(t.summary!, b.base.head, b.positions)
  // The old landmark-aligned profile measure, for comparison with earlier reports.
  const model = b.base.head
  const landmarks = new Map<number, Vec3>()
  for (let l = 0; l < 468; l++) {
    const p = landmarkPosition(model, b.positions, l)
    if (p) landmarks.set(l, p)
  }
  const truthLandmarks = new Map<number, Vec3>()
  t.landmarks!.forEach((p, l) => p && truthLandmarks.set(l, p))
  const legacy = profileError(
    { positions: b.positions, triangles: model.triangles, landmarks },
    { positions: t.positions, triangles: t.triangles, landmarks: truthLandmarks },
  )
  return { report, legacy, exact: t.spec.kind === 'mpfb' ? await exactCheck(b, report) : null }
}

/**
 * For an MPFB truth (the base's own topology): the skull alignment from its
 * known vertex pairs against the measure's ICP, and the face's error vertex
 * by vertex after it — a check on the measure itself.
 */
async function exactCheck(b: Built, report: GeometryReport) {
  const model = b.base.head
  const bytes = new Uint8Array(await (await fetch(truth!.spec.url)).arrayBuffer())
  const truthRegion = await fittedRegion(bytes, b.base)
  const at = (positions: Float64Array, i: number): Vec3 => [
    positions[i * 3]!,
    positions[i * 3 + 1]!,
    positions[i * 3 + 2]!,
  ]
  const skull = skullVertices(model)
  const from: Vec3[] = []
  const to: Vec3[] = []
  const weights: number[] = []
  skull.index.forEach((i, k) => {
    from.push(at(b.positions, i))
    to.push(at(truthRegion, i))
    weights.push(skull.weight[k]!)
  })
  const exact = similarity(from, to, weights)
  const underExact = measureFit(truth!.summary!, model, b.positions, exact)
  const icp = report.alignment.transform
  const tip = landmarkPosition(model, b.positions, 1)!
  const a = applySimilarity(exact, tip)
  const c = applySimilarity(icp, tip)
  let sum = 0
  let max = 0
  let count = 0
  for (let i = 0; i < model.vertices.length; i++) {
    if (!model.skin[i] || model.rest[i * 3 + 2]! < model.frame.earZ + 0.02) continue
    const p = applySimilarity(exact, at(b.positions, i))
    const q = at(truthRegion, i)
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 1000
    sum += d
    max = Math.max(max, d)
    count++
  }
  return {
    scaleError: 1 / exact.scale - 1,
    icpScaleError: report.alignment.scaleError,
    noseTipMm: Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) * 1000,
    faceVertexMm: { mean: sum / count, max },
    points: underExact.points,
    profile: underExact.profile,
  }
}

/** The untouched base head against the truth: what one photo must beat. */
async function measureBase(gender: Gender): Promise<GeometryReport> {
  const base = await loadBaseBody(gender)
  const positions = shapePositions(base.head, new Float64Array(base.head.targetNames.length))
  return measureFit(truth!.summary!, base.head, positions)
}

function checks(kind: 'G1' | 'G2' | 'G4-three' | 'G4-single', report: GeometryReport, base?: GeometryReport): Check[] {
  const real = truth!.spec.absoluteScale
  if (kind === 'G1') return g1Checks(report, real)
  if (kind === 'G2') return g2Checks(report, real)
  if (kind === 'G4-three') return g4ThreeChecks(report)
  return g4SingleChecks(report, base!)
}

// ---------------------------------------------------------------------------------------------
// Drawing the avatar

const avatars = new Map<string, THREE.Object3D>()

async function avatarModel(name: string) {
  let model = avatars.get(name)
  if (!model) {
    const gltf = await loader.loadAsync(builds.get(name)!.url)
    model = preparePhotorealModel(gltf.scene)
    avatars.set(name, model)
  }
  return model
}

/** The avatar and the truth photographed with the same camera and light (the avatar put on the truth by its skull). */
async function photographBoth(name: string, shots: ShotSpec[], align: GeometryReport['alignment']['transform']) {
  const t = truth!
  const model = await avatarModel(name)
  const holder = new THREE.Group()
  holder.matrixAutoUpdate = false
  holder.add(model)
  scene.add(holder)
  const r = align.rotation
  const k = align.scale
  const placed = new THREE.Matrix4().set(
    k * r[0],
    k * r[1],
    k * r[2],
    align.translation[0],
    k * r[3],
    k * r[4],
    k * r[5],
    align.translation[1],
    k * r[6],
    k * r[7],
    k * r[8],
    align.translation[2],
    0,
    0,
    0,
    1,
  )
  const out: { truth: ImageData; avatar: ImageData; truthUrl: string; avatarUrl: string }[] = []
  for (const shot of shots) {
    setSize(shot.width, shot.height)
    const { turn, camera, pivot } = posed(shot)
    setLight(shot.light, pivot)
    t.holder.visible = true
    holder.visible = false
    t.holder.matrix.copy(turn)
    t.holder.updateMatrixWorld(true)
    await draw(camera)
    const truthPixels = await pixels()
    const truthUrl = canvas.toDataURL('image/jpeg', 0.9)
    t.holder.visible = false
    holder.visible = true
    holder.matrix.copy(turn).multiply(placed)
    holder.updateMatrixWorld(true)
    await draw(camera)
    out.push({ truth: truthPixels, avatar: await pixels(), truthUrl, avatarUrl: canvas.toDataURL('image/jpeg', 0.9) })
  }
  scene.remove(holder)
  t.holder.visible = true
  return out
}

// ---------------------------------------------------------------------------------------------
// Likeness (G5)

/** A polygon's pixels (even–odd) as a mask. */
function polygonMask(points: [number, number][], width: number, height: number) {
  const out = new Uint8Array(width * height)
  const xy = points.flat()
  const triangles: number[] = []
  // A fan from the centroid: the face's outline is star-shaped about it.
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length
  xy.push(cx, cy)
  const centre = points.length
  for (let i = 0; i < points.length; i++) triangles.push(centre, i, (i + 1) % points.length)
  fillTriangles(xy, triangles, width, height, out, 1)
  return out
}

function iou(a: Uint8Array, b: Uint8Array) {
  let both = 0
  let either = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++
    if (a[i] || b[i]) either++
  }
  return either ? both / either : Number.NaN
}

async function landmarksOf(image: ImageData) {
  const c = document.createElement('canvas')
  c.width = image.width
  c.height = image.height
  c.getContext('2d')!.putImageData(image, 0, 0)
  const { largest } = await detectFaces(c)
  return largest
}

/** Silhouette masks (any non-background pixel), drawn with every material flat white on black. */
async function silhouette(object: THREE.Object3D, camera: THREE.Camera) {
  const saved = scene.background
  const white = new THREE.MeshBasicNodeMaterial({ color: '#ffffff', side: THREE.DoubleSide })
  const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = []
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    const m = mesh.material as THREE.Material & { alphaTest?: number; map?: THREE.Texture | null }
    swapped.push([mesh, mesh.material])
    if (m.alphaTest && m.map) {
      const cut = new THREE.MeshBasicNodeMaterial({ color: '#ffffff', side: THREE.DoubleSide })
      cut.map = m.map
      cut.alphaTest = m.alphaTest
      mesh.material = cut
    } else mesh.material = white
  })
  scene.background = new THREE.Color('#000000')
  const env = scene.environment
  scene.environment = null
  await draw(camera)
  const image = await pixels()
  for (const [mesh, material] of swapped) mesh.material = material
  scene.background = saved
  scene.environment = env
  const out = new Uint8Array(image.width * image.height)
  for (let i = 0; i < out.length; i++) out[i] = image.data[i * 4]! > 100 ? 1 : 0
  return out
}

async function likeness(name: string, shots: ShotSpec[], urls: string[]) {
  const b = builds.get(name)!
  const t = truth!
  const model = await avatarModel(name)
  const holder = new THREE.Group()
  holder.matrixAutoUpdate = false
  holder.add(model)
  scene.add(holder)
  const results = []
  for (let k = 0; k < shots.length; k++) {
    const shot = shots[k]!
    const camera = b.report!.cameras[k]!
    setSize(camera.width, camera.height)
    // The photo's light, kept where it was against its camera.
    const { pivot, position, turn, camera: trueCamera } = posed(shot)
    const cam = solvedCamera(camera)
    const offset = position.clone()
    setLight(shot.light, pivot.clone().sub(offset))
    t.holder.visible = false
    holder.visible = true
    holder.matrix.copy(solvedPlacement(camera))
    holder.updateMatrixWorld(true)
    await draw(cam)
    const image = await pixels()
    const avatarUrl = canvas.toDataURL('image/jpeg', 0.85)
    const avatarMask = await silhouette(holder, cam)
    // The truth's silhouette through its true camera (the photo was made so).
    setLight(shot.light, pivot)
    holder.visible = false
    t.holder.visible = true
    t.holder.matrix.copy(turn)
    t.holder.updateMatrixWorld(true)
    const truthMask = await silhouette(t.holder, trueCamera)
    const input = await (async () => {
      const bitmap = await createImageBitmap(await (await fetch(urls[k]!)).blob())
      const c = document.createElement('canvas')
      c.width = bitmap.width
      c.height = bitmap.height
      const g = c.getContext('2d', { willReadFrequently: true })!
      g.drawImage(bitmap, 0, 0)
      return g.getImageData(0, 0, c.width, c.height)
    })()
    const theirs = b.views[k]!.landmarks
    const mine = await landmarksOf(image)
    let nme = Number.NaN
    let ovalIou = Number.NaN
    let width = Number.NaN
    if (theirs && mine) {
      const p = (l: number): [number, number] => [theirs[l * 2]!, theirs[l * 2 + 1]!]
      const interocular = Math.hypot(p(33)[0] - p(263)[0], p(33)[1] - p(263)[1])
      let sum = 0
      for (let l = 0; l < 468; l++) sum += Math.hypot(mine.points[l]![0] - p(l)[0], mine.points[l]![1] - p(l)[1])
      nme = sum / 468 / interocular
      ovalIou = iou(
        polygonMask(OVAL.map((l) => p(l)), camera.width, camera.height),
        polygonMask(OVAL.map((l) => mine.points[l]!), camera.width, camera.height),
      )
      const w = (pts: (l: number) => [number, number]) => Math.hypot(pts(234)[0] - pts(454)[0], pts(234)[1] - pts(454)[1])
      width = w((l) => mine.points[l]!) / w(p) - 1
    }
    // The head's silhouette above the chin (hair included), against the truth's.
    const chin = landmarkPosition(b.base.head, b.positions, 152)!
    const q = camera.rotation
    const chinRow =
      (camera.focal * (q[3] * chin[0] + q[4] * chin[1] + q[5] * chin[2] + camera.translation[1])) /
        (q[6] * chin[0] + q[7] * chin[1] + q[8] * chin[2] + camera.translation[2]) +
      camera.cy
    const cut = Math.min(camera.height, Math.round(chinRow + 0.02 * (camera.focal / Math.max(0.2, camera.translation[2]))))
    const above = (m: Uint8Array) => m.map((v, i) => (Math.floor(i / camera.width) < cut ? v : 0))
    results.push({
      slot: b.slots[k],
      nme,
      ovalIou,
      width,
      headIou: iou(above(avatarMask), above(truthMask)),
      avatarUrl,
      inputSize: [input.width, input.height],
    })
  }
  scene.remove(holder)
  t.holder.visible = true
  return results
}

// ---------------------------------------------------------------------------------------------
// Skin (G6)

/** The median colour in disks about landmarks (radius a fraction of the eyes' distance). */
function patchMedian(image: ImageData, points: [number, number][], ls: number[], radius: number): Rgb | null {
  const eyes = Math.hypot(points[33]![0] - points[263]![0], points[33]![1] - points[263]![1])
  const r = radius * eyes
  const mark = new Uint8Array(image.width * image.height)
  for (const l of ls) {
    const [cx, cy] = points[l]!
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (x >= 0 && y >= 0 && x < image.width && y < image.height && (x - cx) ** 2 + (y - cy) ** 2 <= r * r)
          mark[y * image.width + x] = 1
  }
  return medianRgb(image.data, (i) => mark[i] === 1)
}

const CHEEKS = { right: [50, 205, 187], left: [280, 425, 411] }

async function skinRenders(name: string, shots: ShotSpec[], align: GeometryReport['alignment']['transform']) {
  const both = await photographBoth(name, shots, align)
  const out = []
  for (let k = 0; k < both.length; k++) {
    const { truth: tImage, avatar: aImage, truthUrl, avatarUrl } = both[k]!
    const tFace = await landmarksOf(tImage)
    const aFace = await landmarksOf(aImage)
    const cheeks: Record<string, { truth: Rgb | null; avatar: Rgb | null; deltaE: number }> = {}
    for (const [side, ls] of Object.entries(CHEEKS)) {
      const tp = tFace?.points
      const ap = aFace?.points ?? tp
      const truthColour = tp ? patchMedian(tImage, tp, ls, 0.06) : null
      const avatarColour = ap ? patchMedian(aImage, ap, ls, 0.06) : null
      cheeks[side] = {
        truth: truthColour,
        avatar: avatarColour,
        deltaE: truthColour && avatarColour ? deltaERgb(truthColour, avatarColour) : Number.NaN,
      }
    }
    let iris = Number.NaN
    let irisColours: [string | null, string | null] = [null, null]
    if (tFace && aFace && Math.abs(shots[k]!.yaw) < 1) {
      const ti = sampleIrisColor(tImage, tFace.points)
      const ai = sampleIrisColor(aImage, aFace.points)
      irisColours = [ti, ai]
      if (ti && ai) iris = deltaERgb(hexRgb(ti), hexRgb(ai))
    }
    out.push({ yaw: shots[k]!.yaw, light: shots[k]!.light, cheeks, iris, irisColours, truthUrl, avatarUrl, avatarFound: Boolean(aFace) })
  }
  return out
}

const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb

/** An image in a GLB (by name) decoded. */
async function glbImage(glb: Uint8Array, name: string): Promise<ImageData | null> {
  const parsed = parseGlb(glb)
  const image = parsed.json.images.find((one: { name?: string }) => one.name === name)
  if (!image) return null
  const view = parsed.json.bufferViews[image.bufferView]
  const bytes = parsed.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: image.mimeType }))
  const c = document.createElement('canvas')
  c.width = bitmap.width
  c.height = bitmap.height
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bitmap, 0, 0)
  return g.getImageData(0, 0, c.width, c.height)
}

/**
 * The avatar's skin as its textures hold it: face, neck and body tone, the
 * face's left against its right, the head and body textures where they meet
 * at the neck, and how much of the forehead isn't skin coloured.
 */
async function textureSkin(name: string) {
  const b = builds.get(name)!
  const head = (await glbImage(b.glb, 'head_color'))!
  const body = (await glbImage(b.glb, 'body_color'))!
  const { headSkin, head: model } = b.base
  const uv = landmarkUvs(model, headSkin.weld, headSkin.mesh.uvs)
  const sample = (image: ImageData, u: number, v: number, r: number) => {
    const cx = u * image.width
    const cy = v * image.height
    return medianRgb(image.data, (i) => {
      const x = i % image.width
      const y = Math.floor(i / image.width)
      return Math.abs(x - cx) <= r && Math.abs(y - cy) <= r
    })
  }
  const at = (l: number, r = 6) => sample(head, uv[l * 2]!, uv[l * 2 + 1]!, r)
  const face = at(50, 10) && at(280, 10) ? mix(at(50, 10)!, at(280, 10)!) : null
  // The body: its texture's skin (arms and hands) where its skin triangles are; the neck: the body
  // skin's vertices 2–7 cm under the chin, at the front.
  const bodyPrimitive = b.base.primitives.find((p) => p.material === 'Body_Skin')
  const chinY = model.frame.chinY
  const neckUvs: [number, number][] = []
  if (bodyPrimitive) {
    const values = bodyPrimitive.attributes.POSITION!.values
    const uvs = bodyPrimitive.attributes.TEXCOORD_0!.values
    for (let i = 0; i < values.length / 3; i++) {
      const [, y, z] = transformPoint4(b.base.packing, values[i * 3]!, values[i * 3 + 1]!, values[i * 3 + 2]!)
      if (y < chinY - 0.02 && y > chinY - 0.07 && z > model.frame.eyes[2] - 0.08)
        neckUvs.push([uvs[i * 2]!, uvs[i * 2 + 1]!])
    }
  }
  const neck = medianOfTexels(body, neckUvs)
  const bodyUvs: [number, number][] = []
  if (bodyPrimitive) {
    const uvs = bodyPrimitive.attributes.TEXCOORD_0!.values
    for (let i = 0; i < uvs.length; i += 2) bodyUvs.push([uvs[i]!, uvs[i + 1]!])
  }
  const bodyTone = medianOfTexels(body, bodyUvs)
  // Left against right: matching patches either side of the face.
  const balance: Record<string, number> = {}
  for (const [label, [l, r]] of Object.entries({ cheek: [280, 50], forehead: [297, 67], jaw: [397, 172], temple: [251, 21] })) {
    const left = at(l!)
    const right = at(r!)
    balance[label] = left && right ? luminance(left) / Math.max(1e-6, luminance(right)) : Number.NaN
  }
  // Where the head's texture meets the body's at the neck: each shared base mesh vertex's two colours.
  const seam: number[] = []
  if (bodyPrimitive) {
    const bodyMh = bodyPrimitive.attributes._MHVERT!.values
    const bodyUv = bodyPrimitive.attributes.TEXCOORD_0!.values
    const bodyAt = new Map<number, [number, number]>()
    for (let i = 0; i < bodyMh.length; i++) bodyAt.set(bodyMh[i]!, [bodyUv[i * 2]!, bodyUv[i * 2 + 1]!])
    for (let i = 0; i < headSkin.weld.length; i++) {
      const other = bodyAt.get(headSkin.weld[i]!)
      if (!other) continue
      const a = sample(head, headSkin.mesh.uvs[i * 2]!, headSkin.mesh.uvs[i * 2 + 1]!, 2)
      const c = sample(body, other[0], other[1], 2)
      if (a && c) seam.push(deltaERgb(a, c))
    }
  }
  seam.sort((x, y) => x - y)
  // The forehead between the brows and MediaPipe's top of the face: texels far from the face's skin colour.
  const forehead = [10, 109, 67, 103, 54, 21, 71, 63, 105, 66, 107, 9, 336, 296, 334, 293, 301, 251, 284, 332, 297, 338]
  let far = 0
  let all = 0
  if (face) {
    const polygon = forehead.map((l) => [uv[l * 2]! * head.width, uv[l * 2 + 1]! * head.height] as [number, number])
    const mask = polygonMask(polygon, head.width, head.height)
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue
      all++
      if (deltaERgb([head.data[i * 4]!, head.data[i * 4 + 1]!, head.data[i * 4 + 2]!], face) > 15) far++
    }
  }
  return {
    face,
    neck,
    body: bodyTone,
    faceNeck: face && neck ? deltaERgb(face, neck) : Number.NaN,
    faceBody: face && bodyTone ? deltaERgb(face, bodyTone) : Number.NaN,
    neckBody: neck && bodyTone ? deltaERgb(neck, bodyTone) : Number.NaN,
    balance,
    neckSeam: seam.length ? { mean: seam.reduce((s, x) => s + x, 0) / seam.length, p95: seam[Math.floor(seam.length * 0.95)]!, count: seam.length } : null,
    foreheadNotSkin: all ? far / all : Number.NaN,
    photoShare: b.report?.photoShare ?? Number.NaN,
  }
}

const mix = (a: Rgb, b: Rgb): Rgb => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

function medianOfTexels(image: ImageData, uvs: [number, number][]): Rgb | null {
  const mark = new Uint8Array(image.width * image.height)
  for (const [u, v] of uvs) {
    const x = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)))
    const y = Math.min(image.height - 1, Math.max(0, Math.floor(v * image.height)))
    mark[y * image.width + x] = 1
  }
  return medianRgb(image.data, (i) => mark[i] === 1)
}

// ---------------------------------------------------------------------------------------------
// Hair (G7), eyes and expression (G8)

/** A point's distance (m) to a triangle (Ericson, Real-Time Collision Detection 5.1.5). */
function triangleDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  const triangle = new THREE.Triangle(a, b, c)
  const closest = new THREE.Vector3()
  triangle.closestPointToPoint(p, closest)
  return closest.distanceTo(p)
}

/** How far points are from a skin's surface (its triangles), within a reach, on a 1 cm grid. */
function skinDistances(skin: { positions: Float32Array; triangles: Uint32Array }) {
  const cell = 0.01
  const grid = new Map<string, number[]>()
  const { positions, triangles } = skin
  const at = (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
  for (let t = 0; t < triangles.length; t += 3) {
    const box = new THREE.Box3().setFromPoints([at(triangles[t]!), at(triangles[t + 1]!), at(triangles[t + 2]!)])
    for (let x = Math.floor(box.min.x / cell); x <= Math.floor(box.max.x / cell); x++)
      for (let y = Math.floor(box.min.y / cell); y <= Math.floor(box.max.y / cell); y++)
        for (let z = Math.floor(box.min.z / cell); z <= Math.floor(box.max.z / cell); z++) {
          const key = `${x},${y},${z}`
          const list = grid.get(key)
          if (list) list.push(t)
          else grid.set(key, [t])
        }
  }
  return (p: THREE.Vector3, within: number) => {
    const reach = Math.ceil(within / cell)
    const [gx, gy, gz] = [Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell)]
    let best = Number.POSITIVE_INFINITY
    const seen = new Set<number>()
    for (let dx = -reach; dx <= reach; dx++)
      for (let dy = -reach; dy <= reach; dy++)
        for (let dz = -reach; dz <= reach; dz++)
          for (const t of grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
            if (seen.has(t)) continue
            seen.add(t)
            best = Math.min(best, triangleDistance(p, at(triangles[t]!), at(triangles[t + 1]!), at(triangles[t + 2]!)))
          }
    return best
  }
}

/** A buzz cut's hair stays this near the skull (m). */
const BUZZ_REACH = 0.006

/**
 * A hair class from hair meshes (of a model at rest): none, buzz (within
 * 6 mm of the skull: every hair vertex that near the surface of `skin`, the
 * head's skin in the same frame), short (ending above the earlobes), medium
 * (above the chin), long; and whether long hair hangs loose or is tied
 * (gathered within 5 cm of the midline at the back).
 */
function hairClass(
  root: THREE.Object3D,
  meshes: THREE.Mesh[],
  pivot: THREE.Vector3,
  skin: { positions: Float32Array; triangles: Uint32Array },
  scale = 1,
) {
  if (!meshes.length) return { length: 'bald', lowest: null as number | null, spread: null as number | null, offSkull: null as number | null }
  root.updateMatrixWorld(true)
  const nearSkin = skinDistances(skin)
  let lowest = Number.POSITIVE_INFINITY
  let offSkull = 0
  let wide = 0
  let count = 0
  const v = new THREE.Vector3()
  for (const mesh of meshes) {
    const g = mesh.geometry
    for (let i = 0; i < g.attributes.position!.count; i += 3) {
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).getVertexPosition(i, v)
      else v.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i)
      v.applyMatrix4(mesh.matrixWorld).multiplyScalar(scale)
      // Lashes and brows sit in front of the eyes: not hair.
      if (v.z > pivot.z - 0.03 && v.y < pivot.y + 0.04) continue
      lowest = Math.min(lowest, v.y - pivot.y)
      if (offSkull <= BUZZ_REACH) offSkull = Math.max(offSkull, nearSkin(v, BUZZ_REACH))
      if (v.y - pivot.y < -0.1) {
        count++
        if (Math.abs(v.x - pivot.x) > 0.05) wide++
      }
    }
  }
  if (!Number.isFinite(lowest)) return { length: 'bald', lowest: null, spread: null, offSkull: null }
  // Below the eyes: earlobes ~6 cm, chin ~12 cm.
  const length = offSkull <= BUZZ_REACH ? 'buzz' : lowest > -0.06 ? 'short' : lowest > -0.13 ? 'medium' : 'long'
  return {
    length: length === 'long' && count > 0 && wide / count < 0.2 ? 'long-tied' : length,
    lowest,
    spread: count ? wide / count : null,
    offSkull: Number.isFinite(offSkull) ? offSkull : null,
  }
}

/** A loaded avatar's head and body skin at rest (metres, its frame): positions and triangles. */
function avatarSkin(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const positions: number[] = []
  const triangles: number[] = []
  const v = new THREE.Vector3()
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (!mesh.isMesh || !/^(Head|Body)_Skin$/.test((mesh.material as THREE.Material).name)) return
    const offset = positions.length / 3
    const count = mesh.geometry.attributes.position!.count
    for (let i = 0; i < count; i++) {
      if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, v)
      else v.fromBufferAttribute(mesh.geometry.attributes.position as THREE.BufferAttribute, i)
      v.applyMatrix4(mesh.matrixWorld)
      positions.push(v.x, v.y, v.z)
    }
    const index = mesh.geometry.index
    for (let i = 0; i < (index ? index.count : count); i++) triangles.push(offset + (index ? index.getX(i) : i))
  })
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles) }
}

async function avatarHair(name: string) {
  const b = builds.get(name)!
  const gltf = await loader.loadAsync(b.url)
  const hair: THREE.Mesh[] = []
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && (mesh.name === 'Hair' || (mesh.material as THREE.Material).name === 'Hair')) hair.push(mesh)
  })
  const eyes = b.base.head.frame.eyes
  const image = await glbImage(b.glb, 'hair_color')
  return {
    class: hairClass(gltf.scene, hair, new THREE.Vector3(...eyes), avatarSkin(gltf.scene)),
    albedo: image ? medianRgb(image.data, (i) => image.data[i * 4 + 3]! > 128) : null,
  }
}

/**
 * Whether a base mesh vertex (by its rest place) is scalp any head of hair
 * covers: the crown 9 cm and more above the eyes (above every hairline),
 * and the back of the head above the nape.
 */
function onScalp(model: BaseBody['head'], i: number) {
  const { eyes, earZ } = model.frame
  const y = model.rest[i * 3 + 1]! - eyes[1]
  const z = model.rest[i * 3 + 2]!
  return y > 0.09 || (z < earZ - 0.03 && y > -0.02)
}

/** The head skin drawn as two groups: its scalp faces (material 1) and the rest (material 0). */
function scalpGroups(b: Built, mesh: THREE.Mesh): THREE.BufferGeometry {
  const model = b.base.head
  const scalp = new Set<number>()
  for (let i = 0; i < model.vertices.length; i++) if (onScalp(model, i)) scalp.add(model.vertices[i]!)
  const weld = b.base.headSkin.weld
  const source = mesh.geometry
  const index = source.index!
  const rest: number[] = []
  const top: number[] = []
  for (let i = 0; i < index.count; i += 3) {
    const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
    ;(face.every((v) => scalp.has(weld[v]!)) ? top : rest).push(...face)
  }
  const g = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(source.attributes)) g.setAttribute(name, attribute)
  g.morphAttributes = source.morphAttributes
  g.setIndex([...rest, ...top])
  g.addGroup(0, rest.length, 0)
  g.addGroup(rest.length, top.length, 1)
  return g
}

/**
 * Probes for holes in the avatar's hair: from 8 directions (incl. the top,
 * the back and the nape) in its idle, walk and wave poses, the share of the
 * scalp's visible pixels (onScalp) that show skin or the background through
 * the hair, its cards cut by their alpha as the app draws them.
 */
async function hairHoles(name: string) {
  const b = builds.get(name)!
  const gltf = await loader.loadAsync(b.url)
  const model = preparePhotorealModel(gltf.scene)
  const rig = rigRest(model)
  const motion = await loader.loadAsync(`./characters/rocketbox/motion-${b.gender}.glb`)
  const emotes = await loader.loadAsync(`./characters/rocketbox/emotes-${b.gender}.glb`)
  const clip = (set: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, n: string) => {
    const found = set.animations.find((c) => c.name === n)
    const from = rigRest(set.scene)
    return found && from && rig ? retargetClip(found, from, rig) : null
  }
  const poses: [string, THREE.AnimationClip | null, number][] = [
    ['idle', clip(motion, 'idle'), 0.5],
    ['walk', clip(motion, 'walk'), 0.4],
    ['wave', clip(emotes, 'wave'), 1.0],
  ]
  const holder = new THREE.Group()
  holder.add(model)
  scene.add(holder)
  if (truth) truth.holder.visible = false
  const mixer = new THREE.AnimationMixer(model)
  const flat = (color: string, side: THREE.Side = THREE.DoubleSide) =>
    new THREE.MeshBasicNodeMaterial({ color, side })
  const red = (material: THREE.Material | THREE.Material[]) => {
    const source = (Array.isArray(material) ? material[0]! : material) as THREE.MeshStandardMaterial
    const cut = flat('#ff0000')
    if (source.map) {
      cut.opacityNode = texture(source.map).a
      cut.alphaTest = source.alphaTest || 0.35
    }
    return cut
  }
  const green = flat('#00ff00')
  const blue = flat('#0000ff')
  const black = flat('#000000', THREE.FrontSide)
  const white = flat('#ffffff', THREE.FrontSide)
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) originals.set(mesh, mesh.material)
  })
  const nameOf = (m: THREE.Material | THREE.Material[]) => (Array.isArray(m) ? m[0]! : m).name
  const head = [...originals.keys()].find((m) => nameOf(originals.get(m)!) === 'Head_Skin')
  const headGeometry = head?.geometry
  const grouped = head ? scalpGroups(b, head) : null
  const views: [string, number, number][] = [
    ['front', 0, 0],
    ['left', 90, 0],
    ['right', -90, 0],
    ['back', 180, 0],
    ['backLeft', 135, 0],
    ['backRight', -135, 0],
    ['top', 0, 80],
    ['nape', 180, -35],
  ]
  const results: { pose: string; view: string; holes: number; singleSample: number; scalpPixels: number }[] =
    []
  const restHair = hairAtRest(model)
  const stretch: ReturnType<typeof hairStretch>[] = []
  const sheet: { pose: string; view: string; url: string; holes: string }[] = []
  setSize(400, 400)
  const savedBackground = scene.background
  const savedEnvironment = scene.environment
  for (const [pose, action, time] of poses) {
    mixer.stopAllAction()
    if (action) {
      mixer.clipAction(action).play()
      mixer.setTime(time)
    }
    model.updateMatrixWorld(true)
    stretch.push(hairStretch(pose, restHair))
    const centre = new THREE.Vector3()
    model.getObjectByName('Head')?.getWorldPosition(centre)
    for (const [view, yaw, elevation] of views) {
      const radians = Math.PI / 180
      const direction = new THREE.Vector3(
        Math.sin(yaw * radians) * Math.cos(elevation * radians),
        Math.sin(elevation * radians),
        Math.cos(yaw * radians) * Math.cos(elevation * radians),
      )
      const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20)
      camera.position.copy(centre).addScaledVector(direction, 0.9)
      if (elevation > 60) camera.up.set(0, 0, -1)
      camera.lookAt(centre.x, centre.y + 0.05, centre.z)
      camera.updateMatrixWorld()
      scene.background = new THREE.Color('#000000')
      scene.environment = null
      // What shows: hair red, skin green, everything else blue.
      for (const [mesh, material] of originals) {
        const n = nameOf(material)
        mesh.material = /hair/i.test(n) ? red(material) : /skin/i.test(n) ? green : blue
      }
      await draw(camera)
      const ids = await pixels()
      // Where the scalp is in view, the hair left out: the scalp white, all else black.
      for (const [mesh, material] of originals) {
        if (/hair/i.test(nameOf(material))) mesh.visible = false
        else mesh.material = black
      }
      if (head && grouped) {
        head.geometry = grouped
        head.material = [black, white]
      }
      await draw(camera)
      const scalpImage = await pixels()
      if (head && headGeometry) head.geometry = headGeometry
      for (const [mesh, material] of originals) {
        mesh.visible = true
        mesh.material = material
      }
      scene.background = savedBackground
      scene.environment = savedEnvironment
      let scalpPixels = 0
      let holes = 0
      let lone = 0
      // Where the holes are: the scalp grey, its holes red where skin shows, orange where it
      // shows in one of the pixel's four samples only, yellow where the background does (a
      // pixel the hair only partly covers), the rest black.
      const map = new ImageData(ids.width, ids.height)
      for (let i = 0; i < ids.data.length / 4; i++) {
        map.data[i * 4 + 3] = 255
        if (scalpImage.data[i * 4]! < 128) continue
        scalpPixels++
        const r = ids.data[i * 4]!
        const g = ids.data[i * 4 + 1]!
        const bl = ids.data[i * 4 + 2]!
        const isHair = r > 128 && g < 100 && bl < 100
        const isOther = bl > 128 && r < 100 && g < 100
        const hole = !(isHair || isOther)
        // Three samples hair, one skin: resolved linear, so a quarter of green reads 137.
        const single = hole && r > 200 && g > 115 && g < 160 && bl < 60
        if (hole) holes++
        if (single) lone++
        map.data.set(
          hole ? (single ? [255, 128, 0] : g > 100 ? [255, 0, 0] : [255, 200, 0]) : [90, 90, 90],
          i * 4,
        )
      }
      results.push({
        pose,
        view,
        holes: scalpPixels ? holes / scalpPixels : Number.NaN,
        singleSample: scalpPixels ? lone / scalpPixels : Number.NaN,
        scalpPixels,
      })
      const mapCanvas = document.createElement('canvas')
      mapCanvas.width = map.width
      mapCanvas.height = map.height
      mapCanvas.getContext('2d')!.putImageData(map, 0, 0)
      await draw(camera)
      sheet.push({ pose, view, url: canvas.toDataURL('image/jpeg', 0.8), holes: mapCanvas.toDataURL('image/png') })
    }
  }
  scene.remove(holder)
  if (truth) truth.holder.visible = true
  return { results, stretch, sheet }
}

/** A hair triangle whose edges grow or shrink past this in a pose is torn or folded over. */
const TORN = 1.5
/** Edges shorter than this (m) at rest are left out: their ends' rounding alone could pass TORN. */
const TORN_EDGE = 0.002

type HairAtRest = { mesh: THREE.SkinnedMesh; rest: Float32Array }[]

/** The world position of a skinned mesh's vertex as it is posed now. */
function skinnedAt(mesh: THREE.SkinnedMesh, i: number, out: THREE.Vector3) {
  return mesh.getVertexPosition(i, out).applyMatrix4(mesh.matrixWorld)
}

/** The hair's vertices with the skeleton in its bind pose (its bones put back after). */
function hairAtRest(model: THREE.Object3D): HairAtRest {
  const hair: HairAtRest = []
  const v = new THREE.Vector3()
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (!(mesh.isSkinnedMesh && /hair/i.test(material?.name ?? ''))) return
    const bones = mesh.skeleton.bones
    const saved = bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const)
    mesh.skeleton.pose()
    model.updateMatrixWorld(true)
    const position = mesh.geometry.attributes.position!
    const rest = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) rest.set(skinnedAt(mesh, i, v).toArray(), i * 3)
    bones.forEach((b, k) => {
      b.position.copy(saved[k]![0])
      b.quaternion.copy(saved[k]![1])
      b.scale.copy(saved[k]![2])
    })
    model.updateMatrixWorld(true)
    hair.push({ mesh, rest })
  })
  return hair
}

/**
 * How the pose tears or folds the hair: the share of its triangles (cards and
 * cap) with an edge, posed, more than TORN times longer or shorter than at rest.
 */
function hairStretch(pose: string, hair: HairAtRest) {
  let triangles = 0
  let torn = 0
  let worst = 1
  let at: number[] = []
  const v = new THREE.Vector3()
  for (const { mesh, rest } of hair) {
    const posed = new Float32Array(rest.length)
    for (let i = 0; i < rest.length / 3; i++) posed.set(skinnedAt(mesh, i, v).toArray(), i * 3)
    const length = (p: Float32Array, a: number, b: number) =>
      Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!)
    const index = mesh.geometry.index!
    for (let t = 0; t < index.count; t += 3) {
      triangles++
      let most = 1
      for (let e = 0; e < 3; e++) {
        const a = index.getX(t + e)
        const b = index.getX(t + ((e + 1) % 3))
        const before = length(rest, a, b)
        if (before < TORN_EDGE) continue
        const ratio = length(posed, a, b) / before
        most = Math.max(most, ratio, 1 / Math.max(ratio, 1e-6))
      }
      if (most > TORN) torn++
      if (most > worst) {
        worst = most
        const a = index.getX(t)
        at = [rest[a * 3]!, rest[a * 3 + 1]!, rest[a * 3 + 2]!].map((x) => Math.round(x * 1000) / 1000)
      }
    }
  }
  return { pose, triangles, torn: triangles ? torn / triangles : 0, worst, at }
}

/** What the built file carries for the face's motion and the eyes. */
async function glbFacts(name: string) {
  const b = builds.get(name)!
  const parsed = parseGlb(b.glb)
  const morphs = new Set<string>()
  for (const mesh of parsed.json.meshes) for (const n of mesh.extras?.targetNames ?? []) morphs.add(n)
  const images = parsed.json.images.map((image: { name?: string; mimeType?: string }) => ({ name: image.name, mimeType: image.mimeType }))
  const textures = parsed.json.textures.map((t: { source?: number; extensions?: { EXT_texture_webp?: { source: number } } }) => ({
    source: t.source ?? null,
    webp: t.extensions?.EXT_texture_webp?.source ?? null,
  }))
  const hair = await glbImage(b.glb, 'hair_color')
  let alpha = { min: 255, max: 0 }
  if (hair) for (let i = 3; i < hair.data.length; i += 4) alpha = { min: Math.min(alpha.min, hair.data[i]!), max: Math.max(alpha.max, hair.data[i]!) }
  // Textures pointing (through EXT_texture_webp) at a picture that isn't WebP: not valid glTF.
  const invalid = textures.filter((t: { webp: number | null }) => t.webp !== null && images[t.webp]?.mimeType !== 'image/webp').length
  const meshes = parsed.json.meshes.map((m: { name?: string }) => m.name)
  return {
    morphs: [...morphs],
    images,
    hairAlpha: hair ? alpha : null,
    invalidWebpTextures: invalid,
    extensionsRequired: parsed.json.extensionsRequired ?? [],
    meshes,
    bytes: b.glb.byteLength,
  }
}

/** The closed mouth's line in a front render: how much of it is near-white (a tooth line or slit). */
async function lipLine(name: string, shot: ShotSpec, align: GeometryReport['alignment']['transform']) {
  const [both] = await photographBoth(name, [shot], align)
  const face = await landmarksOf(both!.avatar)
  if (!face) return { whiteShare: Number.NaN }
  const p = face.points
  const left = p[61]!
  const right = p[291]!
  const mid = [(p[13]![1] + p[14]![1]) / 2]
  let white = 0
  let total = 0
  const image = both!.avatar
  for (let x = Math.round(Math.min(left[0], right[0])); x <= Math.max(left[0], right[0]); x++) {
    for (let dy = -2; dy <= 2; dy++) {
      const y = Math.round(mid[0]! + dy)
      const i = (y * image.width + x) * 4
      const r = image.data[i]!
      const g = image.data[i + 1]!
      const bl = image.data[i + 2]!
      total++
      if (Math.min(r, g, bl) > 170 && Math.max(r, g, bl) - Math.min(r, g, bl) < 40) white++
    }
  }
  return { whiteShare: total ? white / total : Number.NaN }
}

// ---------------------------------------------------------------------------------------------
// The webcam path (G3): a turntable clip's frames, and the frame picker on a camera

async function clipFrames(shot: ShotSpec, poses: { yaw: number; pitch: number; roll: number }[]) {
  const t = truth!
  const out: string[] = []
  setSize(shot.width, shot.height)
  for (const pose of poses) {
    const s = { ...shot, ...pose }
    const { turn, camera, pivot } = posed(s)
    t.holder.matrix.copy(turn)
    t.holder.updateMatrixWorld(true)
    setLight(shot.light, pivot)
    await draw(camera)
    out.push(canvas.toDataURL('image/jpeg', 0.9))
  }
  return out
}

/** The studio's frame picker run on this browser's camera (a fake one playing a clip): the poses it takes. */
async function webcamCapture(timeoutMs: number) {
  const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 960 } })
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = media
  await video.play()
  const state = { current: startGuide(0) }
  const shots: { slot: string; url: string; at: number }[] = []
  const messages: string[] = []
  const started = performance.now()
  await new Promise<void>((resolve) => {
    const stop = runGuidedCapture(() => video, state, {
      onAdvice: (message) => {
        if (messages[messages.length - 1] !== message) messages.push(message)
      },
      onShot: (step, frame) => {
        shots.push({ slot: step.slot, url: frame.toDataURL('image/png'), at: (performance.now() - started) / 1000 })
        if (shots.length >= 5) {
          stop()
          resolve()
        }
      },
      onState: () => {},
      onError: () => messages.push('error'),
    })
    setTimeout(() => {
      stop()
      resolve()
    }, timeoutMs)
  })
  for (const track of media.getTracks()) track.stop()
  return { shots, messages: messages.slice(-40), seconds: (performance.now() - started) / 1000, size: [video.videoWidth, video.videoHeight] }
}

// ---------------------------------------------------------------------------------------------
// Fixtures

const packed = (map: Uint8Array | null | undefined) => (map ? toBase64(packMap(map)) : null)

/** A build's views as the fixtures keep them (see __bench__/fixture.ts), maps not yet compressed. */
function fixtureViews(name: string, shots: ShotSpec[]): FixtureView[] {
  const b = builds.get(name)!
  const out: FixtureView[] = []
  for (let k = 0; k < b.views.length; k++) {
    const v = b.views[k]!
    const shot = shots[k]!
    out.push({
      slot: v.slot,
      width: v.width,
      height: v.height,
      yaw: v.yaw,
      pitch: v.pitch,
      roll: v.roll,
      guessedYaw: v.guessedYaw,
      mouthOpen: v.mouthOpen,
      blink: v.blink,
      landmarks: v.landmarks ? toBase64(new Uint8Array(v.landmarks.buffer.slice(0))) : null,
      mask: packed(v.mask),
      skin: packed(v.skin),
      covered: packed(v.covered),
      classes: v.classes ? toBase64(classMap(v.classes)) : null,
      blendshapes: v.blendshapes,
      truth: { yaw: shot.yaw, pitch: shot.pitch, roll: shot.roll, focal: shot.focal * (v.width / shot.width), light: shot.light },
    })
  }
  return out
}

/** The truth's skin alone (what the measure reads as its surface), drawn from a side and the front. */
async function truthSkinViews() {
  const t = truth!
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(t.positions, 3))
  g.setIndex(new THREE.BufferAttribute(t.triangles, 1))
  g.computeVertexNormals()
  const colour = new Float32Array(t.positions.length)
  for (let i = 0; i < t.positions.length / 3; i++) colour.set(t.bare && !t.bare.skull[i] ? (t.bare.face[i] ? [0.95, 0.6, 0.1] : [0.9, 0.15, 0.1]) : [0.85, 0.85, 0.85], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(colour, 3))
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardNodeMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }))
  scene.add(mesh)
  t.holder.visible = false
  setSize(600, 600)
  const urls: string[] = []
  for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0.3, -1).normalize()]) {
    const camera = new THREE.PerspectiveCamera(25, 1, 0.05, 20)
    camera.position.copy(t.pivot).addScaledVector(direction, 0.9)
    camera.lookAt(t.pivot.x, t.pivot.y - 0.03, t.pivot.z)
    camera.updateMatrixWorld()
    await draw(camera)
    urls.push(canvas.toDataURL('image/jpeg', 0.85))
  }
  scene.remove(mesh)
  t.holder.visible = true
  return urls
}

/** An avatar file made outside the page (a hair style on a base body at rest) taken as a build, for the hair probes. */
async function adopt(name: string, url: string, gender: Gender) {
  const glb = new Uint8Array(await (await fetch(url)).arrayBuffer())
  const base = await loadBaseBody(gender)
  forget(name)
  builds.set(name, {
    glb,
    report: null,
    base,
    positions: await fittedRegion(glb, base),
    url: URL.createObjectURL(new Blob([glb as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' })),
    views: [],
    slots: [],
    gender,
  })
}

function forget(name: string) {
  const b = builds.get(name)
  if (b) URL.revokeObjectURL(b.url)
  builds.delete(name)
  avatars.delete(name)
}

const glbBase64 = (name: string) => toBase64(builds.get(name)!.glb)

;(window as unknown as Record<string, unknown>).bench = {
  init,
  loadTruth,
  photograph,
  liftLandmarks,
  build,
  measure,
  measureBase,
  checks,
  likeness,
  skinRenders,
  textureSkin,
  avatarHair,
  hairHoles,
  glbFacts,
  lipLine,
  clipFrames,
  webcamCapture,
  fixtureViews,
  adopt,
  forget,
  glbBase64,
  truthSkinViews,
  gates: GATES,
  errors: () => errors.splice(0),
}
;(window as unknown as { ready: boolean }).ready = true
