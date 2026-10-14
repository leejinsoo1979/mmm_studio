import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AvatarGender } from '../avatar-catalog'
import { loadBaseForTests } from './__bench__/base-for-tests'
import type { CaptureView } from './avatar-job'
import type { BaseBody } from './base-body'
import { type Camera, cameraLookingAt, headRotation, project, toCamera } from './camera'
import type { FitResult } from './fit'
import { fitHairPart, type HairStyleName, partsFor, readHairStyle } from './hair-library'
import { hairStyleFor, readHair } from './hair-match'
import { landmarkPosition, shapePositions } from './head-model'
import type { Vec3 } from './linalg'
import { SEGMENT_CLASSES } from './segment'
import { rasterTriangle } from './silhouette'
import { linearToSrgb } from './texture'

const HAIR = join(
  import.meta.dir,
  '../../../../../../../apps/editor/public/characters/photoreal/hair',
)
const WIDTH = 480
const HEIGHT = 640
const SKIN: Vec3 = [0.45, 0.3, 0.22]
const HAIR_COLOUR: Vec3 = [0.05, 0.03, 0.02]

/**
 * Photos of a base head wearing a library style (or none): each view's
 * segmenter planes and pixels drawn with a depth buffer, skin and hair
 * flat-coloured, through cameras the fit would have solved.
 */
function photographed(base: BaseBody, gender: AvatarGender, name: HairStyleName | null) {
  const model = base.head
  const positions = shapePositions(model, new Float64Array(model.targetNames.length))
  const meshes: {
    points: Float32Array | Float64Array
    triangles: ArrayLike<number>
    hair: boolean
  }[] = [{ points: positions, triangles: model.triangles, hair: false }]
  if (name) {
    const bytes = readFileSync(join(HAIR, `${name}.bin`))
    const style = readHairStyle(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    )
    for (const part of partsFor(style, gender))
      meshes.push({
        points: fitHairPart(style, part, base.basemesh),
        triangles: part.indices,
        hair: true,
      })
  }
  const views: CaptureView[] = []
  const cameras: Camera[] = []
  for (const yaw of [0, 45, -45, 90, -90]) {
    const camera = cameraLookingAt({
      width: WIDTH,
      height: HEIGHT,
      rotation: headRotation((yaw * Math.PI) / 180),
      target: model.frame.eyes,
      at: [WIDTH / 2, HEIGHT * 0.38],
      distance: 0.7,
    })
    const depth = new Float32Array(WIDTH * HEIGHT).fill(Number.POSITIVE_INFINITY)
    const what = new Uint8Array(WIDTH * HEIGHT)
    for (const mesh of meshes) {
      const n = mesh.points.length / 3
      const q = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const c = toCamera(camera, [
          mesh.points[i * 3]!,
          mesh.points[i * 3 + 1]!,
          mesh.points[i * 3 + 2]!,
        ])
        q.set(
          [
            (camera.focal * c[0]) / c[2] + camera.cx,
            (camera.focal * c[1]) / c[2] + camera.cy,
            c[2],
          ],
          i * 3,
        )
      }
      for (let t = 0; t < mesh.triangles.length; t += 3) {
        const [a, b, c] = [
          mesh.triangles[t]! * 3,
          mesh.triangles[t + 1]! * 3,
          mesh.triangles[t + 2]! * 3,
        ]
        rasterTriangle(
          q[a]!,
          q[a + 1]!,
          q[b]!,
          q[b + 1]!,
          q[c]!,
          q[c + 1]!,
          WIDTH,
          HEIGHT,
          (pixel, w0, w1, w2) => {
            const z = w0 * q[a + 2]! + w1 * q[b + 2]! + w2 * q[c + 2]!
            if (z >= depth[pixel]!) return
            depth[pixel] = z
            what[pixel] = mesh.hair ? 2 : 1
          },
        )
      }
    }
    const size = WIDTH * HEIGHT
    const planes = new Uint8Array(size * SEGMENT_CLASSES.length)
    const rgba = new Uint8ClampedArray(size * 4)
    const mask = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
      const cls = what[i] === 2 ? 'hair' : what[i] === 1 ? 'faceSkin' : 'background'
      planes[SEGMENT_CLASSES.indexOf(cls) * size + i] = 255
      mask[i] = what[i] ? 255 : 0
      const colour = what[i] === 2 ? HAIR_COLOUR : what[i] === 1 ? SKIN : ([0.6, 0.6, 0.6] as Vec3)
      rgba.set([...colour.map(linearToSrgb), 255], i * 4)
    }
    // The face's landmarks where MediaPipe would find them: on the photos facing it.
    let landmarks: Float32Array | null = null
    if (Math.abs(yaw) < 30) {
      landmarks = new Float32Array(478 * 2)
      for (let l = 0; l < 478; l++) {
        const p = landmarkPosition(model, positions, l)
        if (p) landmarks.set(project(camera, p), l * 2)
      }
    }
    views.push({
      slot: 'free',
      width: WIDTH,
      height: HEIGHT,
      rgba,
      landmarks,
      mask,
      skin: null,
      covered: null,
      classes: { width: WIDTH, height: HEIGHT, planes },
      blendshapes: null,
      yaw: (yaw * Math.PI) / 180,
    })
    cameras.push(camera)
  }
  const fit = { positions, cameras } as unknown as FitResult
  return { views, fit }
}

describe('reading hair off photos', () => {
  const cases: [AvatarGender, HairStyleName | null, string][] = [
    ['male', null, 'bald'],
    ['female', null, 'bald'],
    ['male', 'buzz', 'buzz'],
    ['male', 'short02', 'short'],
    ['female', 'short03', 'short'],
    ['female', 'long01-bob', 'medium'],
    ['male', 'bob02', 'medium'],
    ['female', 'long01', 'long'],
    ['female', 'long01-shoulder', 'long'],
    ['female', 'ponytail01', 'long'],
    ['male', 'ponytail01', 'long'],
  ]
  for (const [gender, name, length] of cases) {
    test(`${name ?? 'a bald head'} on the ${gender} body reads as ${length}`, async () => {
      const base = await loadBaseForTests(gender)
      const { views, fit } = photographed(base, gender, name)
      const reading = readHair(views, fit, base, SKIN)
      expect(reading.length).toBe(length as never)
      if (name === 'ponytail01') expect(reading.tied).toBe(true)
      if (name?.startsWith('long01')) expect(reading.tied).toBe(false)
      if (name) expect(hairStyleFor(reading)).toBe(name)
      else expect(hairStyleFor(reading)).toBeNull()
      if (name) {
        // The photos' light is their own here (skin photographed as its colour): the hair's comes back as drawn, lifted for its shade.
        const colour = reading.colour!
        expect(colour[0] / colour[1]).toBeCloseTo(HAIR_COLOUR[0] / HAIR_COLOUR[1], 1)
      }
    })
  }
})
