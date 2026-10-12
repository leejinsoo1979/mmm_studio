// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, describe, expect, test } from 'bun:test'
import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
} from 'three'
import { GLSLNodeBuilder, WebGPURenderer } from 'three/webgpu'
import { SheenSafeLightingModel } from './sheen-safe-material'
import {
  installPhysicalMaterial,
  isSkinMaterial,
  SKIN_DIFFUSE,
  SKIN_EYE_ATTRIBUTE,
  SkinMaterial,
  SkinPhysicalNodeMaterial,
  setSkinShading,
  skinDetailNormals,
  skinShadingOn,
} from './skin-material'

afterEach(() => setSkinShading(false))

describe('skin shading', () => {
  test('is off until turned on', () => {
    expect(skinShadingOn()).toBe(false)
    setSkinShading(true)
    expect(skinShadingOn()).toBe(true)
    setSkinShading(false)
    expect(skinShadingOn()).toBe(false)
  })

  test("a skin material's settings go with its copies", () => {
    const material = new SkinMaterial({ detailRepeat: 16 })
    const copy = material.clone()
    expect(isSkinMaterial(copy)).toBe(true)
    expect(copy.skin).toEqual({ detailRepeat: 16 })
    expect(copy.skin).not.toBe(material.skin)
    expect(isSkinMaterial(new MeshPhysicalMaterial())).toBe(false)
  })

  test('a copy of a plain material keeps the settings it was made with', () => {
    const loaded = new MeshPhysicalMaterial({ roughness: 0.4, sheen: 1 })
    const skin = new SkinMaterial({ detailRepeat: 40 }).copy(loaded)
    expect(skin.skin).toEqual({ detailRepeat: 40 })
    expect(skin.roughness).toBe(0.4)
    expect(skin.sheen).toBe(1)
  })

  test('keys its shader apart from a plain one only while skin shading is on', () => {
    const plain = new MeshPhysicalMaterial()
    const skin = new SkinMaterial({ detailRepeat: 16 })
    const notSkin = new SkinMaterial(null)
    expect(skin.customProgramCacheKey()).toBe(plain.customProgramCacheKey())
    setSkinShading(true)
    expect(skin.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey())
    expect(notSkin.customProgramCacheKey()).toBe(plain.customProgramCacheKey())
    expect(skin.customProgramCacheKey()).not.toBe(
      new SkinMaterial({ detailRepeat: 40 }).customProgramCacheKey(),
    )
  })

  test('turning it on or off has the skin materials rebuilt, once', () => {
    const skin = new SkinMaterial({ detailRepeat: 16 })
    const plain = new SkinMaterial(null)
    const before = { skin: skin.version, plain: plain.version }
    setSkinShading(true)
    setSkinShading(true)
    expect(skin.version).toBe(before.skin + 1)
    expect(plain.version).toBe(before.plain)
    setSkinShading(false)
    expect(skin.version).toBe(before.skin + 2)
  })

  test('a material that is not skin is lit as any sheen-safe physical material', () => {
    const material = new SkinPhysicalNodeMaterial()
    material.sheen = 1
    const model = material.setupLightingModel() as unknown as { sheen: boolean }
    expect(model).toBeInstanceOf(SheenSafeLightingModel)
    expect(model.constructor).toBe(SheenSafeLightingModel)
    expect(model.sheen).toBe(true)
  })
})

describe('SKIN_DIFFUSE', () => {
  // Over a sphere lit from one side: each channel's wrapped light against Lambert's.
  const caught = (wrap: number) => {
    const steps = 20000
    let wrapped = 0
    let lambert = 0
    for (let i = 0; i < steps; i++) {
      const facing = -1 + (2 * (i + 0.5)) / steps
      const t = Math.min(1, Math.max(0, (facing + wrap) / (1 + wrap)))
      wrapped += t + (t * t - t) * SKIN_DIFFUSE.rollOff
      lambert += Math.max(0, facing)
    }
    return wrapped / lambert
  }

  test('keeps every channel’s energy, so a lit ball keeps its colour', () => {
    SKIN_DIFFUSE.wrap.forEach((wrap, channel) => {
      expect(caught(wrap) / SKIN_DIFFUSE.energy[channel]!).toBeCloseTo(1, 3)
    })
  })

  test('wraps red furthest', () => {
    const [red, green, blue] = SKIN_DIFFUSE.wrap
    expect(red).toBeGreaterThan(green)
    expect(green).toBeGreaterThan(blue)
  })
})

describe('the shader three builds', () => {
  const texture = () => {
    const made = new Texture()
    made.image = { width: 4, height: 4 }
    return made
  }

  /** The WebGL fallback's shaders for a sheened physical material with the usual maps, drawn as the viewer draws it. */
  function shaders(material: Material, eyes: boolean) {
    const canvas = {
      style: {},
      width: 1,
      height: 1,
      addEventListener() {},
      removeEventListener() {},
      getContext: () => null,
    }
    const renderer = new WebGPURenderer({ forceWebGL: true, canvas } as never)
    installPhysicalMaterial(renderer)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(6), 2))
    if (eyes) geometry.setAttribute(SKIN_EYE_ATTRIBUTE, new BufferAttribute(new Float32Array(6), 2))
    const mesh = new Mesh(geometry, material)
    const scene = new Scene()
    const light = new DirectionalLight()
    scene.add(mesh, light)
    const camera = new PerspectiveCamera()
    const builder = new GLSLNodeBuilder(mesh, renderer) as any
    builder.scene = scene
    builder.material = material
    builder.camera = camera
    builder.context.material = material
    builder.lightsNode = (renderer as any).lighting.getNode(scene, camera)
    builder.lightsNode.setLights([light])
    builder.environmentNode = null
    builder.fogNode = null
    builder.clippingContext = null
    builder.build()
    return { vertex: builder.vertexShader as string, fragment: builder.fragmentShader as string }
  }
  const fragment = (material: Material, eyes: boolean) => shaders(material, eyes).fragment

  const maps = () => ({ map: texture(), normalMap: texture(), roughnessMap: texture(), sheen: 1 })
  const plain = () => fragment(new MeshPhysicalMaterial(maps()), false)

  test('off, a skin material builds exactly as a plain one', () => {
    expect(fragment(new SkinMaterial({ detailRepeat: 16 }, maps()), true)).toBe(plain())
  })

  test('on, the softer normal is turned on the surface frame, not on the mapped normal', () => {
    setSkinShading(true)
    const skin = fragment(new SkinMaterial({ detailRepeat: 16 }, maps()), true)
    expect(skin).not.toBe(plain())
    const biased = /(\w+) = texture\( \w+, \w+, 3\.0 \)/.exec(skin)
    expect(biased).not.toBeNull()
    const turned = skin.split('\n').filter((line) => line.includes('TBNViewMatrix *'))
    expect(turned.length).toBeGreaterThanOrEqual(2)
    expect(turned.every((line) => line.includes('NORMAL_TBNViewMatrix'))).toBe(true)
  })

  test("on, an eye's wet roughness keeps three's floor and its anti-aliasing", () => {
    setSkinShading(true)
    const skin = fragment(new SkinMaterial({ detailRepeat: 16 }, maps()), true)
    const roughness = skin.split('\n').filter((line) => /^\s*Roughness = /.test(line))
    expect(roughness).toHaveLength(1)
    expect(roughness[0]).toContain('0.04')
    expect(roughness[0]).toContain('0.0525')
  })

  test('on, a head reads its eyes, a body without them builds no eye shading', () => {
    setSkinShading(true)
    const head = shaders(new SkinMaterial({ detailRepeat: 16 }, maps()), true)
    const body = shaders(new SkinMaterial({ detailRepeat: 40 }, maps()), false)
    expect(head.vertex).toContain(SKIN_EYE_ATTRIBUTE)
    expect(body.vertex).not.toContain(SKIN_EYE_ATTRIBUTE)
    expect(body.fragment.length).toBeLessThan(head.fragment.length)
  })
})

describe('skinDetailNormals', () => {
  const size = 512
  const normals = skinDetailNormals(size)
  const at = (x: number, y: number, c: number) => normals[(y * size + x) * 4 + c]!

  test('is the same every time', () => {
    expect(skinDetailNormals(size)).toEqual(normals)
  })

  test('is a gentle tangent-space normal map: facing out, tilting both ways', () => {
    let sumX = 0
    let sumZ = 0
    let minZ = 255
    for (let i = 0; i < size * size; i++) {
      sumX += normals[i * 4]!
      sumZ += normals[i * 4 + 2]!
      minZ = Math.min(minZ, normals[i * 4 + 2]!)
      expect(normals[i * 4 + 3]).toBe(255)
    }
    expect(Math.abs(sumX / (size * size) - 127.5)).toBeLessThan(6)
    expect(sumZ / (size * size)).toBeGreaterThan(232)
    expect(minZ).toBeGreaterThan(128)
  })

  test('tiles: its far edge runs on into its near one as smoothly as anywhere', () => {
    let across = 0
    let inside = 0
    for (let y = 0; y < size; y++) {
      for (let c = 0; c < 3; c++) {
        across += Math.abs(at(size - 1, y, c) - at(0, y, c))
        inside += Math.abs(at(size / 2, y, c) - at(size / 2 + 1, y, c))
      }
    }
    expect(across).toBeLessThan(inside * 1.6)
  })
})
