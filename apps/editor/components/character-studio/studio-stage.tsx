'use client'

import {
  type AvatarLook,
  bodyHeightScale,
  EmoteLayer,
  findAvatar,
  useAvatarBody,
  useAvatarLook,
  useEmoteClips,
  useFaceTarget,
} from '@pascal-app/editor'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AnimationMixer,
  DirectionalLight,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  NeutralToneMapping,
  type Object3D,
  type PerspectiveCamera,
  type SkinnedMesh,
  Source,
  type Texture,
  Vector3,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { PMREMGenerator, type WebGPURenderer } from 'three/webgpu'
import {
  createHandleBoard,
  dragHandle,
  dropHandle,
  FaceHandles,
  grabHandle,
  type HandleBoard,
  HandleProjector,
  handleKey,
  hitHandle,
  hoverHandle,
  setHandleState,
} from './face-handles'
import { type HeadFraming, type HeadSpan, headFraming, headSpan } from './head-frame'
import { DRAG_THRESHOLD, pointerMove, snapTurn, viewTurn } from './sculpt-gesture'
import type {
  CameraFocus,
  StageInsets,
  StagePose,
  StageView,
  StudioFilterId,
  StudioStageApi,
  StudioStageProps,
} from './stage-contract'
import { createBackdrop, floorGlowEllipse, freeRoomCentre } from './studio-backdrop'
import {
  type CaptureRig,
  captureAiShot,
  captureSnapshot,
  drawStage,
  placeCamera,
} from './studio-capture'
import { ContactShadow } from './studio-contact-shadow'
import { grainDataUrl, overlayBackground, overlayBlend, STUDIO_FILTER } from './studio-filters'
import { StudioPose } from './studio-pose'
import { useStudioRenderer } from './studio-renderer'
import { untonedColor } from './studio-tone'

type HeadFocus = 'hair' | 'face' | 'eyes' | 'mouth'

/**
 * Framing per focus until the body has loaded, as fractions of its height:
 * where the camera looks and how much of the body the view holds top to
 * bottom. Once it has, the face and hair are framed by the head itself.
 */
const FRAMING: Record<HeadFocus, { look: number; span: number }> = {
  hair: { look: 0.88, span: 0.4 },
  face: { look: 0.9, span: 0.22 },
  eyes: { look: 0.92, span: 0.12 },
  mouth: { look: 0.87, span: 0.12 },
}

/**
 * Per focus, the lens's vertical field of view (°) — long, as a portrait
 * lens is, the closer it comes, so a face isn't bulged by a wide angle —
 * and how far the wheel may zoom it out of and into its framing.
 */
const LENS: Record<CameraFocus, { fov: number; zoom: [number, number] }> = {
  full: { fov: 30, zoom: [0.55, 1.6] },
  upper: { fov: 28, zoom: [0.55, 1.6] },
  hair: { fov: 27, zoom: [0.6, 1.5] },
  face: { fov: 25, zoom: [0.6, 1.4] },
  eyes: { fov: 25, zoom: [0.6, 1.8] },
  mouth: { fov: 25, zoom: [0.6, 1.8] },
  legs: { fov: 28, zoom: [0.55, 1.6] },
  feet: { fov: 28, zoom: [0.55, 1.6] },
}

/** The share of the free room's height the face (crown to chin) fills, and the head with its hair. */
const FACE_FILL = 0.8
const HAIR_FILL = 0.85
/** How far below the chin the hair view reaches, in head heights: to the shoulders, where long hair falls. */
const HAIR_DROP = 0.75
/** The whole body's share of the free room, and how wide it is for its tallest height (arms down). */
const FULL_FILL = 0.92
const FULL_ASPECT = 0.3
/** The upper body: from the crown down this share of the body's height, its share of the room and its width for that. */
const UPPER_REACH = 0.62
const UPPER_FILL = 0.9
const UPPER_ASPECT = 0.5

/**
 * Closer in on the face, in eyes-to-chin heights from the eyes: the eyes
 * and brows up to the forehead, and the nose and mouth down past the chin;
 * each as wide as the face for its height.
 */
const EYES_BAND = { above: 0.5, below: 0.4 }
const MOUTH_BAND = { above: 0.15, below: 1.1 }
const FEATURE_FILL = 0.85
const FEATURE_ASPECT = 1.3
/** The legs: from a little above the hips (a share of the body's height) to the floor, and how wide they stand. */
const LEGS_ABOVE_HIPS = 0.06
const LEGS_FILL = 0.92
const LEGS_ASPECT = 0.5
/** The feet: from just under the knees (a share of the hips' height) to the floor. */
const SHINS = 0.55
const FEET_FILL = 0.85
const FEET_ASPECT = 0.7
/** How far under the floor the legs' and feet's views reach, so the soles don't sit on the edge. */
const UNDER_FLOOR = 0.03

/** A Rocketbox body stands about 1.95 of its hip height tall. */
const HEIGHT_PER_HIP = 1.95
const HIPS_BONE = /Pelvis$/
/**
 * How many times its own height the tallest look makes a body: the whole
 * body is framed for that, so it fits at any height and the 키 slider
 * shows as the body growing or shrinking on the stage.
 */
const TALLEST = bodyHeightScale({ height: 1, sliders: {} })
/** How long (s) the camera takes, about, to ease from one framing to the next. */
const EASE_TIME = 0.45
/** How near its framing (a share of what it sees) the camera is once it has settled there. */
const SETTLED = 0.04
/** How quickly (per second) the turntable eases to its turn. */
const TURN_RESPONSE = 17
/** How far (radians) the turntable turns per CSS px dragged, and per arrow key. */
const TURN_PER_PIXEL = 0.012
const TURN_STEP = Math.PI / 12
/** How much one wheel notch's delta (px) zooms, and one +/− key press. */
const WHEEL_ZOOM = 0.001
const KEY_ZOOM = 1.15
/** The most pixels the canvas's drawing buffer holds: a full-bleed stage at dpr 2 could be 5120 × 2880. */
const MOST_PIXELS = 8.3e6

/** A value easing towards its target as a critically damped spring does: out of rest and into the target, never past it. */
type Spring = { value: number; speed: number }

const spring = (): Spring => ({ value: 0, speed: 0 })

/** Game Programming Gems 4, 1.10: a critically damped spring stepped by `delta` s. */
function ease(state: Spring, target: number, delta: number) {
  const omega = 2 / EASE_TIME
  const x = omega * delta
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const off = state.value - target
  const pull = (state.speed + omega * off) * delta
  state.speed = (state.speed - omega * pull) * decay
  state.value = target + (off + pull) * decay
}

/** The head with the hair below it to the shoulders. */
const HEAD_FOCUS: ReadonlySet<CameraFocus> = new Set<HeadFocus>(['hair', 'face', 'eyes', 'mouth'])

const withHair = (span: HeadSpan): HeadSpan => ({
  ...span,
  bottom: span.bottom - (span.top - span.bottom) * HAIR_DROP,
})

/** The canvas's pixel ratio: the screen's, at most 2, and less on a stage so big its buffer would pass MOST_PIXELS. */
function cappedDpr(width: number, height: number): number {
  const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return Math.max(1, Math.min(device, 2, Math.sqrt(MOST_PIXELS / Math.max(1, width * height))))
}

/**
 * What the stage's parts share, mutable so a frame can read it without a
 * render: the latest props, the turntable and zoom, the camera's aim and
 * what the capture needs.
 */
type StageState = {
  focus: CameraFocus
  insets: StageInsets
  pose: StagePose
  cue: StudioStageProps['cue']
  /** The look's height scale. */
  scale: number
  zoom: number
  /** The turntable's turn asked for (radians), and the avatar's turn as it eases there. */
  yaw: number
  turned: number
  /** The side 45° and 측면 last turned to, and the view last told. */
  sign: 1 | -1
  told: StageView
  /** The camera's aim, which the lights follow; the framing held while a handle is. */
  view: HeadFraming
  held: HeadFraming | null
  model: { current: Object3D | null }
  board: HandleBoard
  rig: CaptureRig
}

const clampZoom = (focus: CameraFocus, zoom: number) => {
  const [low, high] = LENS[focus].zoom
  return Math.min(high, Math.max(low, zoom))
}

/** Where the camera aims, and how much it sees, for a focus: centred in the free room. */
function framingFor(
  state: StageState,
  size: { width: number; height: number },
  stature: number,
): HeadFraming {
  const { focus, insets } = state
  const stage = { width: size.width, height: size.height, insets }
  const zoom = clampZoom(focus, state.zoom)
  const height = stature * state.scale
  if (focus === 'full') {
    return headFraming({ top: stature * TALLEST, bottom: 0, x: 0 }, stage, FULL_FILL, {
      aspect: FULL_ASPECT,
      zoom,
    })
  }
  if (focus === 'legs' || focus === 'feet') {
    const hips = state.model.current ? hipsHeight(state.model.current) : null
    const hipY = hips ?? height / HEIGHT_PER_HIP
    return focus === 'legs'
      ? headFraming(
          { top: hipY + LEGS_ABOVE_HIPS * height, bottom: -UNDER_FLOOR, x: 0 },
          stage,
          LEGS_FILL,
          { aspect: LEGS_ASPECT, zoom },
        )
      : headFraming({ top: hipY * SHINS, bottom: -UNDER_FLOOR, x: 0 }, stage, FEET_FILL, {
          aspect: FEET_ASPECT,
          zoom,
        })
  }
  const head = state.model.current ? headSpan(state.model.current) : null
  if (focus === 'upper') {
    const top = head?.top ?? height
    return headFraming(
      { top, bottom: top - UPPER_REACH * height, x: head?.x ?? 0 },
      stage,
      UPPER_FILL,
      { aspect: UPPER_ASPECT, zoom },
    )
  }
  if (!head) {
    const { look, span } = FRAMING[focus as HeadFocus]
    return headFraming(
      { top: height * (look + span / 2), bottom: height * (look - span / 2), x: 0 },
      stage,
      1,
      { zoom },
    )
  }
  if ((focus === 'eyes' || focus === 'mouth') && head.eyes !== undefined) {
    const { above, below } = focus === 'eyes' ? EYES_BAND : MOUTH_BAND
    const reach = head.eyes - head.bottom
    return headFraming(
      {
        top: head.eyes + above * reach,
        bottom: head.eyes - below * reach,
        x: head.x,
        front: head.front,
      },
      stage,
      FEATURE_FILL,
      { aspect: FEATURE_ASPECT, zoom },
    )
  }
  return focus === 'hair'
    ? headFraming(withHair(head), stage, HAIR_FILL, { zoom })
    : headFraming(head, stage, FACE_FILL, { zoom })
}

const hipsBones = new WeakMap<Object3D, Object3D | null>()

/** How high the hips stand now (world), or null for a body without them. */
function hipsHeight(model: Object3D): number | null {
  let hips = hipsBones.get(model)
  if (hips === undefined) {
    hips = null
    model.traverse((object) => {
      if (!hips && HIPS_BONE.test(object.name)) hips = object
    })
    hipsBones.set(model, hips)
  }
  if (!hips) return null
  hips.updateWorldMatrix(true, false)
  return point.setFromMatrixPosition(hips.matrixWorld).y
}

const point = new Vector3()

/**
 * Eases the camera to the focus's framing, straight in front of the body
 * and centred in the room the studio's chrome leaves. The face, hair and
 * upper body go by where the head (and the hair or hat over it) is each
 * frame, so they stay framed whatever the look's height, the head's size,
 * the hairstyle or the clip; the whole body by the tallest it can be. The
 * aim, the view's size and the lens all ease together, so a new focus or
 * the panel opening glides there. While a handle is held the framing
 * stays put, so the face doesn't slide from under the pointer.
 */
function CameraRig({ state, stature }: { state: StageState; stature: number }) {
  const camera = useThree((three) => three.camera) as PerspectiveCamera
  const size = useThree((three) => three.size)
  const springs = useMemo(
    () => ({
      x: spring(),
      y: spring(),
      half: spring(),
      fov: spring(),
      started: false,
      focus: state.focus,
    }),
    [state],
  )
  useFrame((_, delta) => {
    const target = state.board.drag && state.held ? state.held : framingFor(state, size, stature)
    state.held = target
    const fov = LENS[state.focus].fov
    if (springs.focus !== state.focus) {
      springs.focus = state.focus
      state.board.settling = true
    }
    if (springs.started) {
      const step = Math.min(delta, 0.1)
      ease(springs.x, target.x, step)
      ease(springs.y, target.y, step)
      ease(springs.half, target.half, step)
      ease(springs.fov, fov, step)
    } else {
      springs.started = true
      springs.x.value = target.x
      springs.y.value = target.y
      springs.half.value = target.half
      springs.fov.value = fov
    }
    if (
      state.board.settling &&
      Math.abs(springs.half.value - target.half) < SETTLED * target.half &&
      Math.hypot(springs.x.value - target.x, springs.y.value - target.y) < SETTLED * target.half
    )
      state.board.settling = false
    state.view.x = springs.x.value
    state.view.y = springs.y.value
    state.view.half = springs.half.value
    placeCamera(camera, state.view, springs.fov.value)
  })
  return null
}

/** Where each light shines from (towards the aim), seen from the camera: right, up, towards it. */
const KEY_FROM = new Vector3(0.62, 0.62, 0.58).normalize()
const FILL_FROM = new Vector3(-0.8, 0.12, 0.6).normalize()
const RIM_FROM = new Vector3(-0.8, 0.28, -0.53).normalize()
const KICK_FROM = new Vector3(0.82, 0.18, -0.55).normalize()
/** How far from the aim the lights stand: the key's shadow camera reaches this far either way along it. */
const LIGHT_DISTANCE = 4
/** How soft (m) the key's shadow's edge is, and the shadow map's size. */
const PENUMBRA = 0.006
const SHADOW_MAP = 1024

/**
 * A portrait's three-point rig, following the camera's aim: a warm key
 * high to the right whose soft shadow models the face, a cool fill low to
 * the left, and a rim light with a kicker behind, which outline the hair
 * against the dark backdrop. The key's shadow camera closes in on what the
 * view holds, so a close-up's shadows are as fine as the whole body's. The
 * capture aims it at its own shot the same way.
 */
function StudioLights({ state }: { state: StageState }) {
  const lights = useMemo(() => {
    const key = new DirectionalLight('#fff0df', 2.6)
    key.castShadow = true
    key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
    key.shadow.bias = -0.0003
    key.shadow.normalBias = 0.012
    const fill = new DirectionalLight('#dbe6ff', 0.55)
    const rim = new DirectionalLight('#eef4ff', 3)
    const kick = new DirectionalLight('#fff3e6', 1.4)
    return [
      { light: key, from: KEY_FROM },
      { light: fill, from: FILL_FROM },
      { light: rim, from: RIM_FROM },
      { light: kick, from: KICK_FROM },
    ]
  }, [])
  const aim = useCallback(
    (view: HeadFraming) => {
      for (const { light, from } of lights) {
        light.target.position.set(view.x, view.y, 0)
        light.position.copy(light.target.position).addScaledVector(from, LIGHT_DISTANCE)
        light.updateMatrixWorld()
        light.target.updateMatrixWorld()
      }
      const { shadow } = lights[0]!.light
      const reach = Math.max(view.half * 1.5, 0.3)
      const camera = shadow.camera
      if (Math.abs(camera.right - reach) > 1e-4) {
        camera.left = -reach
        camera.right = reach
        camera.top = reach
        camera.bottom = -reach
        camera.near = LIGHT_DISTANCE - 3
        camera.far = LIGHT_DISTANCE + 3
        camera.updateProjectionMatrix()
        shadow.radius = Math.min(8, Math.max(1.5, (PENUMBRA * SHADOW_MAP) / (2 * reach)))
      }
    },
    [lights],
  )
  useEffect(() => {
    state.rig.aimLights = aim
  }, [state, aim])
  useFrame(() => aim(state.view))
  return (
    <>
      {lights.map(({ light }) => (
        <group key={light.uuid}>
          <primitive object={light} />
          <primitive object={light.target} />
        </group>
      ))}
    </>
  )
}

/** How bright the studio's surroundings light and show in the character (the lights above do the modelling). */
const ENVIRONMENT_INTENSITY = 0.35

/** Soft image-based light from a studio room, made here (no picture to download). */
function StudioEnvironment() {
  const gl = useThree((state) => state.gl) as unknown as WebGPURenderer
  const scene = useThree((state) => state.scene)
  useEffect(() => {
    const generator = new PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const target = generator.fromScene(room, 0.04)
    room.dispose()
    generator.dispose()
    scene.environment = target.texture
    scene.environmentIntensity = ENVIRONMENT_INTENSITY
    return () => {
      scene.environment = null
      target.dispose()
    }
  }, [gl, scene])
  return null
}

/** The platform's radius (m), which the floor glow spreads round. */
const PLATFORM_RADIUS = 0.95

const origin = new Vector3()
const rimX = new Vector3()
const rimZ = new Vector3()

/** The studio's backdrop (studio-backdrop.ts), its light following the free room and its floor glow the platform. */
function Backdrop({ state }: { state: StageState }) {
  const size = useThree((three) => three.size)
  const camera = useThree((three) => three.camera)
  const backdrop = useMemo(createBackdrop, [])
  useEffect(() => {
    const { rig } = state
    rig.backdrop = backdrop.mesh
    rig.setBackdropWindow = (x, y, width, height) => backdrop.view.set(x, y, width, height)
    return () => {
      if (rig.backdrop === backdrop.mesh) rig.backdrop = null
      backdrop.mesh.geometry.dispose()
      backdrop.mesh.material.dispose()
    }
  }, [backdrop, state])
  const started = useRef(false)
  useFrame((_, delta) => {
    const { width, height } = size
    const target = freeRoomCentre(size, state.insets)
    const step = started.current ? 1 - Math.exp((-2 / EASE_TIME) * Math.min(delta, 0.1)) : 1
    started.current = true
    backdrop.centre.x += (target.x - backdrop.centre.x) * step
    backdrop.centre.y += (target.y - backdrop.centre.y) * step
    const aspect = width / Math.max(1, height)
    backdrop.aspect.value = aspect
    origin.set(0, 0, 0).project(camera)
    rimX.set(PLATFORM_RADIUS, 0, 0).project(camera)
    rimZ.set(0, 0, PLATFORM_RADIUS).project(camera)
    backdrop.floorGlow.set(...floorGlowEllipse(origin, rimX, rimZ, aspect))
  })
  return <primitive object={backdrop.mesh} />
}

/** Marks what the studio made its own (a clone's userData goes with it, so the look's copies of ours count too). */
const STUDIO = 'studio'
const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'sheenColorMap',
  'sheenRoughnessMap',
] as const
/** The cards of hair and lashes (a body's own, and a borrowed style's), cut out a little lower than the game does: alpha to coverage softens what the lower cut lets through. */
const CARDS = /(_opacity|:hair-cards)$/
const CARD_ALPHA_TEST = 0.3
const CARD_ROUGHNESS = 0.9
const CARD_REFLECTION = 0.25
/** Rocketbox's eyeball bones (not the lids' `…EyeBlinkTop`): what they hold is the eyes. */
const EYE_BONE = /Eye$/
/** The eyes' roughness, wet enough for the lights to catch in them (Rocketbox paints them as dull as skin). */
const EYE_ROUGHNESS = 0.16

const ownTextures = new WeakMap<Texture, Texture>()
const ownMaterials = new WeakMap<Material, Material>()
const glossed = new WeakMap<Texture, Texture>()

const isOwn = (thing: { userData: Record<string, unknown> }) => thing.userData[STUDIO] === true

/** The studio's copy of a texture — the game's own is drei's, shared — sharpened at a slant. */
function ownTexture(texture: Texture, anisotropy: number): Texture {
  if (isOwn(texture)) return texture
  let own = ownTextures.get(texture)
  if (!own) {
    own = texture.clone()
    own.anisotropy = anisotropy
    own.userData[STUDIO] = true
    ownTextures.set(texture, own)
  }
  return own
}

/**
 * A copy of a head's roughness texture with its eyes (the triangles its
 * eyeball bones hold) made glossy; the texture itself where that can't be
 * worked out.
 */
function glossyEyes(texture: Texture, mesh: SkinnedMesh): Texture {
  const done = glossed.get(texture)
  if (done) return done
  const image = texture.image as (CanvasImageSource & { width: number; height: number }) | null
  const { geometry } = mesh
  const uv = geometry.getAttribute('uv')
  const joints = geometry.getAttribute('skinIndex')
  const weights = geometry.getAttribute('skinWeight')
  const eyes = new Set<number>()
  mesh.skeleton.bones.forEach((bone, index) => {
    if (EYE_BONE.test(bone.name)) eyes.add(index)
  })
  if (
    !(image?.width && uv && joints && weights && eyes.size) ||
    typeof OffscreenCanvas === 'undefined'
  )
    return texture
  const held = (i: number) => {
    let weight = 0
    for (let k = 0; k < joints.itemSize; k++)
      if (eyes.has(joints.getComponent(i, k))) weight += weights.getComponent(i, k)
    return weight >= 0.5
  }
  const { width, height } = image
  const mask = new OffscreenCanvas(width, height).getContext('2d')
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!(mask && context)) return texture
  mask.fillStyle = '#fff'
  mask.beginPath()
  const index = geometry.index
  const count = index ? index.count : uv.count
  let found = false
  for (let t = 0; t + 2 < count; t += 3) {
    const corners = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k))
    if (!corners.every(held)) continue
    found = true
    corners.forEach((i, k) => {
      const x = uv.getX(i) * width
      const y = uv.getY(i) * height
      if (k === 0) mask.moveTo(x, y)
      else mask.lineTo(x, y)
    })
    mask.closePath()
  }
  if (!found) return texture
  mask.fill()
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, width, height)
  const covered = mask.getImageData(0, 0, width, height).data
  const gloss = EYE_ROUGHNESS * 255
  for (let p = 0; p < covered.length; p += 4) {
    const share = covered[p + 3]! / 255
    // Roughness is the green channel (glTF's metallic-roughness packing).
    if (share > 0) pixels.data[p + 1] = pixels.data[p + 1]! * (1 - share) + gloss * share
  }
  context.putImageData(pixels, 0, 0)
  const own = texture.clone()
  own.source = new Source(canvas.transferToImageBitmap())
  own.userData[STUDIO] = true
  own.needsUpdate = true
  glossed.set(texture, own)
  return own
}

/** Tunes a material the studio owns for the close-up: sharp textures, soft-edged hair, glossy eyes. */
function tune(material: Material, mesh: Mesh, anisotropy: number) {
  const slots = material as unknown as Record<string, Texture | null | undefined>
  for (const slot of TEXTURE_SLOTS) {
    const texture = slots[slot]
    if (texture?.isTexture) slots[slot] = ownTexture(texture, anisotropy)
  }
  if (material.alphaTest > 0) material.alphaToCoverage = true
  if (CARDS.test(material.name)) {
    material.alphaTest = CARD_ALPHA_TEST
    // Cards lying over the scalp are seen edge on, where the studio room's
    // reflection would grey them over in bands.
    const standard = material as MeshStandardMaterial
    if (standard.isMeshStandardMaterial) {
      standard.roughness = Math.max(standard.roughness, CARD_ROUGHNESS)
      standard.envMapIntensity = CARD_REFLECTION
    }
  }
  const roughness = slots.roughnessMap
  if (/_head$/.test(material.name) && roughness && (mesh as SkinnedMesh).isSkinnedMesh) {
    const glossy = glossyEyes(roughness, mesh as SkinnedMesh)
    slots.roughnessMap = glossy
    if (slots.metalnessMap === roughness) slots.metalnessMap = glossy
  }
  material.userData[STUDIO] = true
  material.needsUpdate = true
}

/**
 * Makes the body's materials the studio's own, tuned: drei's, which the
 * game shares, are swapped for tuned copies (once each) before the look
 * first copies them in turn, so the look's dressed copies carry the tuning.
 */
function takeOwnership(model: Object3D, anisotropy: number) {
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const material = mesh.material as Material
    if (isOwn(material)) return
    let copy = ownMaterials.get(material)
    if (!copy) {
      copy = material.clone()
      tune(copy, mesh, anisotropy)
      ownMaterials.set(material, copy)
    }
    mesh.material = copy
  })
}

/**
 * Keeps them so as the look and the hair change them: a shared material
 * put back gets its copy again, and any other new one — the copy of its
 * own a borrowed hairstyle makes — is tuned where it is.
 */
function keepOwnership(model: Object3D, anisotropy: number) {
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const material = mesh.material as Material
    if (isOwn(material)) return
    const copy = ownMaterials.get(material)
    if (copy) mesh.material = copy
    else tune(material, mesh, anisotropy)
  })
}

/**
 * The character: idling, playing the emote being previewed, or holding
 * still facing the camera (studio-pose.ts); its model is put in the
 * state for the camera and the handles to go by, and it turns with the
 * turntable.
 */
function StudioAvatar({
  avatarId,
  look,
  state,
  onCueEnd,
}: {
  avatarId: string
  look: AvatarLook
  state: StageState
  onCueEnd: () => void
}) {
  const { avatar, model, clips } = useAvatarBody(avatarId)
  const anisotropy = useThree((three) => (three.gl as unknown as WebGPURenderer).getMaxAnisotropy())
  const camera = useThree((three) => three.camera)
  // Before the look sees the body (its effects run after this render).
  useMemo(() => takeOwnership(model, anisotropy), [model, anisotropy])
  useAvatarLook(model, look, avatar.id)
  useEffect(() => {
    const shown = state.model
    shown.current = model
    return () => {
      if (shown.current === model) shown.current = null
    }
  }, [model, state])
  const emoteClips = useEmoteClips(avatar, true)
  const groupRef = useRef<Group>(null)
  const endRef = useRef(onCueEnd)
  endRef.current = onCueEnd

  const mixer = useMemo(() => new AnimationMixer(model), [model])
  const layer = useMemo(() => new EmoteLayer(mixer), [mixer])
  const pose = useMemo(() => new StudioPose(model, mixer, layer), [model, mixer, layer])
  useEffect(() => layer.setClips(emoteClips), [layer, emoteClips])
  useEffect(() => {
    pose.setIdle(clips.find((clip) => clip.name === 'idle') ?? null)
    return () => pose.dispose()
  }, [clips, pose])

  useFrame((_, delta) => {
    keepOwnership(model, anisotropy)
    const group = groupRef.current
    if (group) {
      group.rotation.y += (state.yaw - group.rotation.y) * (1 - Math.exp(-TURN_RESPONSE * delta))
      state.turned = group.rotation.y
    }
    const live = state.pose === 'live'
    const finished = pose.update(delta, {
      still: !live || state.board.drag !== null,
      cue: live ? state.cue : null,
      camera: camera.position,
      yaw: state.turned,
    })
    if (finished) endRef.current()
  })

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  )
}

/**
 * The ring round the disc: steel blue at 55 % over the disc, as WebGL blended
 * it in display colours. The frame blends in linear light before it is tone
 * mapped, so the ring is drawn solid in the colour that blend showed.
 */
const RING = untonedColor('#3c5a73')
/** The faint white halo on the floor past the disc, 5 % white over the backdrop in WebGL's blend: as much in a linear one. */
const HALO_OPACITY = 0.015

/** A dark disc the character stands on, ringed in steel blue. */
function Platform({ state }: { state: StageState }) {
  const ref = useRef<Group>(null)
  useEffect(() => {
    const { rig } = state
    rig.platform = ref.current
    return () => {
      rig.platform = null
    }
  }, [state])
  return (
    <group ref={ref} rotation-x={-Math.PI / 2}>
      <mesh receiveShadow>
        <circleGeometry args={[PLATFORM_RADIUS, 96]} />
        <meshStandardMaterial color="#16191e" roughness={0.55} />
      </mesh>
      <mesh position-z={0.001}>
        <ringGeometry args={[PLATFORM_RADIUS, 0.975, 128]} />
        <meshBasicMaterial color={RING} />
      </mesh>
      <mesh position-z={0.0005}>
        <ringGeometry args={[1.05, 1.9, 128]} />
        <meshBasicMaterial color="#ffffff" opacity={HALO_OPACITY} transparent />
      </mesh>
    </group>
  )
}

/** The soft shadow under the feet (studio-contact-shadow.ts): shown for the whole and upper body (and kept for the AI's whole-body shot). */
function FloorShadow({ state, shown }: { state: StageState; shown: boolean }) {
  const shadow = useMemo(() => new ContactShadow(), [])
  useEffect(() => {
    const { rig } = state
    rig.contact = shadow
    return () => {
      if (rig.contact === shadow) rig.contact = null
      shadow.dispose()
    }
  }, [shadow, state])
  return <primitive object={shadow.group} visible={shown} />
}

/** Hands the capture the renderer, the scene and the live camera. */
function RigBridge({ state }: { state: StageState }) {
  const gl = useThree((three) => three.gl)
  const scene = useThree((three) => three.scene)
  const camera = useThree((three) => three.camera)
  const size = useThree((three) => three.size)
  useEffect(() => {
    const { rig } = state
    rig.gl = gl as unknown as WebGPURenderer
    rig.scene = scene
    rig.camera = camera as PerspectiveCamera
    rig.size = { width: size.width, height: size.height }
  }, [state, gl, scene, camera, size.width, size.height])
  return null
}

/**
 * Draws the frame, last: the handles' projector runs after the pose (at
 * priority 1), and a frame callback with a priority takes the drawing over
 * from the canvas.
 */
function FrameRender({ state }: { state: StageState }) {
  useFrame(
    ({ gl, scene, camera }) => drawStage(gl as unknown as WebGPURenderer, scene, camera, state.rig),
    2,
  )
  return null
}

/** The filter's overlays over the canvas (not over the handles or the chrome), centred on the free room. */
function FilterOverlays({
  filter,
  insets,
  box,
}: {
  filter: StudioFilterId
  insets: StageInsets
  box: { width: number; height: number }
}) {
  const { overlays } = STUDIO_FILTER[filter]
  if (overlays.length === 0) return null
  const freeWidth = Math.max(1, box.width - insets.left - insets.right)
  const freeHeight = Math.max(1, box.height - insets.top - insets.bottom)
  const centre = {
    width: box.width,
    height: box.height,
    cx: insets.left + freeWidth / 2,
    cy: insets.top + freeHeight / 2,
  }
  const grain = overlays.some((overlay) => overlay.kind === 'grain') ? grainDataUrl() : null
  return (
    <>
      {overlays.map((overlay) => (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          key={`${filter}-${overlay.kind}`}
          style={{
            background: overlayBackground(overlay, centre, grain),
            mixBlendMode: overlayBlend(overlay),
            opacity: overlay.kind === 'grain' ? overlay.opacity : undefined,
          }}
        />
      ))}
    </>
  )
}

/** A gesture on the stage: turning the turntable, dragging a handle, or pinching to zoom. */
type Gesture =
  | { kind: 'turn'; pointerId: number; x: number; yaw: number; moved: boolean }
  | { kind: 'sculpt'; pointerId: number; x: number; y: number }
  | { kind: 'pinch'; distance: number; zoom: number }

/** The camera's lens when the canvas starts (the rig eases it from there). */
const CAMERA = { fov: LENS.full.fov, near: 0.05, far: 50, position: [0, 1, 4] as const }

/**
 * The studio's 3D stage, full-bleed under the studio's chrome: the
 * character on a lit turntable, framed by `focus` in the free room the
 * chrome leaves (`insets`), idling or held still, with the face's handles
 * over it when `sculpt` is on, and the photo filter. It owns every gesture
 * on the stage (turning, zooming, sculpting, its keys); it never changes
 * the look, only tells of sculpting through `onSculpt`.
 */
export function StudioStage({
  ref,
  avatarId,
  look,
  focus,
  insets,
  pose,
  cue,
  onCueEnd,
  filter,
  sculpt,
  onSculpt,
  onHandleHover,
  onViewChange,
}: StudioStageProps) {
  const stature = findAvatar(avatarId).hip * HEIGHT_PER_HIP
  const [board] = useState(createHandleBoard)
  // Made once; the props are copied in below on every render.
  const [state] = useState<StageState>(() => ({
    focus,
    insets,
    pose,
    cue,
    scale: 1,
    zoom: 1,
    yaw: 0,
    turned: 0,
    sign: 1,
    told: 'front',
    view: { x: 0, y: 1, half: 1 },
    held: null,
    model: { current: null },
    board,
    rig: {
      gl: null,
      scene: null,
      camera: null,
      size: { width: 1, height: 1 },
      view: { x: 0, y: 1, half: 1 },
      aimLights: () => {},
      setBackdropWindow: () => {},
      backdrop: null,
      platform: null,
      contact: null,
    },
  }))
  state.rig.view = state.view
  if (state.focus !== focus) state.zoom = 1
  state.focus = focus
  state.insets = insets
  state.pose = pose
  state.cue = cue
  state.scale = bodyHeightScale(look.body)
  const target = useFaceTarget(avatarId)
  board.sculpt = sculpt
  board.target = target

  const callbacks = useRef({ onSculpt, onHandleHover, onViewChange })
  callbacks.current = { onSculpt, onHandleHover, onViewChange }
  board.onSculpt = (event) => callbacks.current.onSculpt(event)
  board.onHover = (handle) => callbacks.current.onHandleHover(handle)

  const tell = useCallback(
    (view: StageView) => {
      if (state.told === view) return
      state.told = view
      callbacks.current.onViewChange(view)
    },
    [state],
  )
  const setView = useCallback(
    (view: Exclude<StageView, 'free'>) => {
      const next = viewTurn(view, state.told, state.yaw, state.sign)
      state.yaw = next.yaw
      state.sign = next.sign
      tell(view)
    },
    [state, tell],
  )
  const frame = useCallback(() => {
    state.zoom = 1
  }, [state])

  useImperativeHandle(
    ref,
    (): StudioStageApi => ({
      setView,
      frame,
      capture: (request) => {
        const model = state.model.current
        if (!(model && state.rig.gl)) {
          return Promise.reject(new Error('capture: the character has not loaded'))
        }
        try {
          return request.kind === 'ai'
            ? captureAiShot(state.rig, request.framing, model, stature, state.scale)
            : captureSnapshot(state.rig, request.filter, state.insets)
        } catch (error) {
          return Promise.reject(error)
        }
      },
    }),
    [setView, frame, state, stature],
  )

  // A handle in hand is put back when the handles go (another tab, the UI
  // hidden), the character changes or the stage closes.
  useEffect(() => {
    if (!sculpt) dropHandle(board, false)
  }, [sculpt, board])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new character lets go of the old face's handle
  useEffect(() => () => dropHandle(board, false), [board, avatarId])

  const container = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 1, height: 1 })
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : cappedDpr(window.innerWidth, window.innerHeight),
  )
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect()
      setBox({ width, height })
      setDpr(cappedDpr(width, height))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const setCursor = (cursor: string) => {
    if (container.current) container.current.style.cursor = cursor
  }
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = container.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const finishTurn = (moved: boolean) => {
    setHandleState(board, { turning: false })
    if (!moved) return
    const rest = snapTurn(state.yaw)
    state.yaw = rest.yaw
    tell(rest.view)
  }
  /** Ends the gesture under way: a sculpt kept (`commit`) or put back, a turn come to rest. */
  const endGesture = (commit: boolean) => {
    const current = gesture.current
    gesture.current = null
    if (current?.kind === 'sculpt') dropHandle(board, commit)
    else if (current?.kind === 'turn') finishTurn(current.moved)
    setCursor('grab')
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const element = event.currentTarget
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    element.setPointerCapture(event.pointerId)
    if (pointers.current.size >= 2) {
      endGesture(false)
      const [a, b] = [...pointers.current.values()]
      gesture.current = {
        kind: 'pinch',
        distance: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
        zoom: state.zoom,
      }
      return
    }
    const at = local(event)
    const hit = hitHandle(board, at, event.pointerType)
    if (hit && grabHandle(board, hit, { ...at, id: event.pointerId })) {
      gesture.current = {
        kind: 'sculpt',
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      }
      hoverHandle(board, null)
      setCursor('grabbing')
      return
    }
    gesture.current = {
      kind: 'turn',
      pointerId: event.pointerId,
      x: event.clientX,
      yaw: state.yaw,
      moved: false,
    }
    hoverHandle(board, null)
    setHandleState(board, { turning: true })
    setCursor('grabbing')
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    const current = gesture.current
    if (current?.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (a && b) {
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        state.zoom = clampZoom(state.focus, (current.zoom * current.distance) / distance)
      }
      return
    }
    if (current?.kind === 'sculpt' && current.pointerId === event.pointerId) {
      const drag = board.drag
      if (!drag) return
      const dx = event.clientX - current.x
      const dy = event.clientY - current.y
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      const depth = event.altKey || Boolean(board.sculpt?.depth)
      dragHandle(board, pointerMove(dx, dy, depth), { x: drag.x + dx, y: drag.y + dy })
      return
    }
    if (current?.kind === 'turn' && current.pointerId === event.pointerId) {
      const dx = event.clientX - current.x
      if (Math.abs(dx) > DRAG_THRESHOLD) current.moved = true
      state.yaw = current.yaw + dx * TURN_PER_PIXEL
      return
    }
    if (!current && event.pointerType !== 'touch') {
      const hit = hitHandle(board, local(event), event.pointerType)
      hoverHandle(board, hit)
      setCursor(hit ? 'pointer' : 'grab')
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    const current = gesture.current
    if (current?.kind === 'pinch') {
      if (pointers.current.size < 2) gesture.current = null
      return
    }
    if (current && current.pointerId === event.pointerId) endGesture(true)
  }

  const onPointerGone = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    const current = gesture.current
    if (current?.kind === 'pinch') {
      if (pointers.current.size < 2) gesture.current = null
      return
    }
    if (current && current.pointerId === event.pointerId) endGesture(false)
  }

  // The wheel zooms (and a trackpad's pinch, which comes as a wheel with
  // Ctrl, must not zoom the page): a listener that may prevent the default.
  useEffect(() => {
    const element = container.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      state.zoom = clampZoom(state.focus, state.zoom * Math.exp(event.deltaY * WHEEL_ZOOM))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [state])

  // The stage's keys and the handles' (studio-wide keys are the studio's):
  // listened for before anything else gets them, and kept from the rest
  // once used.
  useEffect(() => {
    const used = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const onKey = (event: KeyboardEvent) => {
      const root = container.current
      if (!root) return
      if (event.key === 'Escape' && gesture.current?.kind === 'sculpt') {
        const { pointerId } = gesture.current
        gesture.current = null
        dropHandle(board, false)
        if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId)
        root.style.cursor = 'grab'
        used(event)
        return
      }
      const target = event.target as Node | null
      if (!(target && root.contains(target))) return
      if (target !== root) {
        if (handleKey(board, event)) used(event)
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          state.yaw += event.key === 'ArrowRight' ? TURN_STEP : -TURN_STEP
          const rest = snapTurn(state.yaw)
          state.yaw = rest.yaw
          tell(rest.view)
          break
        }
        case '+':
        case '=':
          state.zoom = clampZoom(state.focus, state.zoom / KEY_ZOOM)
          break
        case '-':
        case '_':
          state.zoom = clampZoom(state.focus, state.zoom * KEY_ZOOM)
          break
        case 'Home':
          setView('front')
          break
        default:
          return
      }
      used(event)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [board, state, tell, setView])

  const renderer = useStudioRenderer()
  const css = STUDIO_FILTER[filter].css
  return (
    <div
      aria-label="캐릭터 미리보기. 화살표로 돌리고, +와 -로 확대해요"
      aria-roledescription="캐릭터 무대"
      className="absolute inset-0 cursor-grab touch-none outline-none focus-visible:outline-2 focus-visible:outline-sky-400 focus-visible:outline-offset-[-4px]"
      onDoubleClick={(event) => {
        if (!hitHandle(board, local(event), 'mouse')) frame()
      }}
      onLostPointerCapture={onPointerGone}
      onPointerCancel={onPointerGone}
      onPointerDown={onPointerDown}
      onPointerLeave={() => {
        if (!gesture.current) hoverHandle(board, null)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      ref={container}
      role="application"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: an application widget, one tab stop: its keys turn and zoom the stage
      tabIndex={0}
    >
      <Canvas
        camera={CAMERA}
        dpr={dpr}
        gl={renderer}
        onCreated={({ gl }) => {
          gl.toneMapping = NeutralToneMapping
          gl.toneMappingExposure = 1
        }}
        shadows="percentage"
        style={css === 'none' ? undefined : { filter: css }}
      >
        <Backdrop state={state} />
        <StudioEnvironment />
        <StudioLights state={state} />
        <Platform state={state} />
        <FloorShadow shown={!HEAD_FOCUS.has(focus)} state={state} />
        <Suspense fallback={null}>
          <StudioAvatar avatarId={avatarId} look={look} onCueEnd={onCueEnd} state={state} />
        </Suspense>
        <CameraRig state={state} stature={stature} />
        <HandleProjector board={board} model={state.model} />
        <RigBridge state={state} />
        <FrameRender state={state} />
      </Canvas>
      <FilterOverlays box={box} filter={filter} insets={insets} />
      <FaceHandles board={board} sculpt={sculpt} />
    </div>
  )
}
