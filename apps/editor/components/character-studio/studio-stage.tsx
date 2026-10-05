'use client'

import {
  type AvatarLook,
  bodyHeightScale,
  type EmoteCue,
  EmoteLayer,
  findAvatar,
  useAvatarBody,
  useAvatarLook,
  useEmoteClips,
} from '@pascal-app/editor'
import { ContactShadows } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import {
  AnimationMixer,
  BufferGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  NeutralToneMapping,
  type Object3D,
  type PerspectiveCamera,
  PMREMGenerator,
  ShaderMaterial,
  type SkinnedMesh,
  Source,
  type Texture,
  Mesh as ThreeMesh,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { type HeadSpan, headFraming, headSpan, type Stage } from './head-frame'

export type CameraFocus = 'full' | 'upper' | 'hair' | 'face'

/**
 * Framing per focus, as fractions of the body's height: where the camera
 * looks and how much of the body the view holds top to bottom. The face
 * and hair are framed by the head itself (head-frame.ts); their entries are
 * only for until the body has loaded.
 */
const FRAMING: Record<CameraFocus, { look: number; span: number }> = {
  full: { look: 0.47, span: 1.55 },
  upper: { look: 0.76, span: 0.66 },
  hair: { look: 0.88, span: 0.4 },
  face: { look: 0.9, span: 0.22 },
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
}

/** The share of the room between the bars the face (crown to chin) fills, and the head with its hair. */
const FACE_FILL = 0.8
const HAIR_FILL = 0.85
/** How far below the chin the hair view reaches, in head heights: to the shoulders, where long hair falls. */
const HAIR_DROP = 0.75
/** How far (CSS px) the top bar and the camera controls reach in over the stage. */
const TOP_BAR = 72
const BOTTOM_BAR = 76

/** A Rocketbox body stands about 1.95 of its hip height tall. */
const HEIGHT_PER_HIP = 1.95
/**
 * How many times its own height the tallest look makes a body: the whole
 * body is framed for that, so it fits at any height and the 키 slider
 * shows as the body growing or shrinking on the stage.
 */
const TALLEST = bodyHeightScale({ height: 1, sliders: {} })
/** How far above what it looks at the camera stands, as a share of its distance: it looks a little down. */
const LOOK_DOWN = 0.04
/** How long (s) the camera takes, about, to ease from one framing to the next. */
const EASE_TIME = 0.45

/** Where the camera aims and how much it sees there: shared with the lights, which follow it. */
type View = { x: number; y: number; half: number }

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

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

/** The head with the hair below it to the shoulders. */
const withHair = (span: HeadSpan): HeadSpan => ({
  ...span,
  bottom: span.bottom - (span.top - span.bottom) * HAIR_DROP,
})

/**
 * Eases the camera to the focus's framing, straight in front of the body.
 * The face, hair and upper body go by where the head (and the hair or hat
 * over it) is in `model` each frame, so they stay framed whatever the
 * look's height, the head's size, the hairstyle or the clip — by `stature`
 * (the body's own height) times `scale` (the look's) until it has loaded.
 * The whole body goes by the tallest it can be. The aim, the view's size
 * and the lens all ease together, so a new step glides there.
 */
function CameraRig({
  focus,
  zoom,
  stature,
  scale,
  model,
  view,
}: {
  focus: CameraFocus
  zoom: number
  stature: number
  scale: number
  model: { current: Object3D | null }
  view: View
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera
  const size = useThree((state) => state.size)
  const springs = useMemo(
    () => ({ x: spring(), y: spring(), half: spring(), fov: spring(), started: false }),
    [],
  )
  useFrame((_, delta) => {
    const stage: Stage = {
      width: size.width,
      height: size.height,
      top: TOP_BAR,
      bottom: BOTTOM_BAR,
    }
    const head = focus !== 'full' && model.current ? headSpan(model.current) : null
    let target: View
    if ((focus === 'face' || focus === 'hair') && head) {
      target =
        focus === 'face'
          ? headFraming(head, stage, FACE_FILL)
          : headFraming(withHair(head), stage, HAIR_FILL)
    } else {
      const height = focus === 'full' ? stature * TALLEST : (head?.top ?? stature * scale)
      const { look, span } = FRAMING[focus]
      target = { x: 0, y: height * look, half: (height * span) / 2 }
    }
    const lens = LENS[focus]
    const zoomed = target.half * Math.min(lens.zoom[1], Math.max(lens.zoom[0], zoom))

    if (springs.started) {
      const step = Math.min(delta, 0.1)
      ease(springs.x, target.x, step)
      ease(springs.y, target.y, step)
      ease(springs.half, zoomed, step)
      ease(springs.fov, lens.fov, step)
    } else {
      springs.started = true
      springs.x.value = target.x
      springs.y.value = target.y
      springs.half.value = zoomed
      springs.fov.value = lens.fov
    }

    view.x = springs.x.value
    view.y = springs.y.value
    view.half = springs.half.value
    const fov = springs.fov.value
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    const distance = view.half / Math.tan(toRadians(fov) / 2)
    camera.position.set(view.x, view.y + distance * LOOK_DOWN, distance)
    camera.lookAt(view.x, view.y, 0)
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
 * against the backdrop. The key's shadow camera closes in on what the
 * view holds, so a close-up's shadows are as fine as the whole body's.
 */
function StudioLights({ view }: { view: View }) {
  const lights = useMemo(() => {
    const key = new DirectionalLight('#fff0df', 2.6)
    key.castShadow = true
    key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
    key.shadow.bias = -0.0003
    key.shadow.normalBias = 0.012
    const fill = new DirectionalLight('#dbe6ff', 0.55)
    const rim = new DirectionalLight('#eef4ff', 2.4)
    const kick = new DirectionalLight('#fff3e6', 1.1)
    return [
      { light: key, from: KEY_FROM },
      { light: fill, from: FILL_FROM },
      { light: rim, from: RIM_FROM },
      { light: kick, from: KICK_FROM },
    ]
  }, [])
  useFrame(() => {
    for (const { light, from } of lights) {
      light.target.position.set(view.x, view.y, 0)
      light.position.copy(light.target.position).addScaledVector(from, LIGHT_DISTANCE)
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
  })
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
const ENVIRONMENT_INTENSITY = 0.45

/** Soft image-based light from a studio room, made here (no picture to download). */
function StudioEnvironment() {
  const gl = useThree((state) => state.gl)
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

/**
 * The backdrop: the page's own gradient (character-studio.tsx's), drawn
 * where the stage is so the canvas can be opaque — which alpha to coverage
 * needs, or the hair's edges would let the page show through — without a
 * seam beside it; deepened a little round the stage's sides and floor so
 * the lit character stands out.
 */
const BACKDROP_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

const BACKDROP_FRAGMENT = /* glsl */ `
uniform vec2 buffer;
uniform vec4 rect;
uniform vec2 page;

const vec3 CENTRE = vec3(1.0);
const vec3 MIDDLE = vec3(241.0, 244.0, 248.0) / 255.0;
const vec3 EDGE = vec3(221.0, 228.0, 236.0) / 255.0;
const vec3 SHADE = vec3(0.72, 0.77, 0.84);

float noise(vec2 at) {
  return fract(52.9829189 * fract(dot(at, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 css = vec2(
    rect.x + gl_FragCoord.x / buffer.x * rect.z,
    rect.y + (1.0 - gl_FragCoord.y / buffer.y) * rect.w
  );
  // radial-gradient(ellipse at 62% 42%, …): an ellipse shaped as its
  // closest sides, grown to its farthest corner.
  vec2 centre = page * vec2(0.62, 0.42);
  vec2 closest = max(min(centre, page - centre), vec2(1.0));
  vec2 farthest = max(centre, page - centre);
  float t = length((css - centre) / (closest * length(farthest / closest)));
  vec3 colour = t < 0.38
    ? mix(CENTRE, MIDDLE, t / 0.38)
    : mix(MIDDLE, EDGE, clamp((t - 0.38) / 0.62, 0.0, 1.0));

  vec2 local = (css - rect.xy) / rect.zw;
  float round = length((local - vec2(0.5, 0.42)) * vec2(1.0, 1.15));
  float shade = smoothstep(0.42, 0.95, round) * 0.22;
  // Faded out towards the stage's left side, where the page goes on.
  shade *= rect.x > 0.5 ? smoothstep(0.0, 160.0, css.x - rect.x) : 1.0;
  colour = mix(colour, colour * SHADE, shade);

  gl_FragColor = vec4(colour + (noise(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}
`

function Backdrop() {
  const gl = useThree((state) => state.gl)
  const size = useThree((state) => state.size)
  const mesh = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    )
    const material = new ShaderMaterial({
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      uniforms: {
        buffer: { value: new Vector2(1, 1) },
        rect: { value: new Vector4(0, 0, 1, 1) },
        page: { value: new Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    })
    const backdrop = new ThreeMesh(geometry, material)
    backdrop.frustumCulled = false
    backdrop.renderOrder = -1000
    return backdrop
  }, [])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )
  useFrame(() => {
    const { uniforms } = mesh.material
    uniforms.buffer!.value.set(gl.domElement.width, gl.domElement.height)
    uniforms.rect!.value.set(size.left, size.top, size.width, size.height)
    uniforms.page!.value.set(window.innerWidth, window.innerHeight)
  })
  return <primitive object={mesh} />
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

/** The character, idling or playing `cue`; its model is put in `shown` for the camera to frame. */
function StudioAvatar({
  avatarId,
  look,
  cue,
  yaw,
  shown,
  onCueEnd,
}: {
  avatarId: string
  look: AvatarLook
  cue: EmoteCue | null
  yaw: { current: number }
  shown: { current: Object3D | null }
  onCueEnd: () => void
}) {
  const { avatar, model, clips } = useAvatarBody(avatarId)
  const anisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())
  // Before the look sees the body (its effects run after this render).
  useMemo(() => takeOwnership(model, anisotropy), [model, anisotropy])
  useAvatarLook(model, look, avatar.id)
  useEffect(() => {
    shown.current = model
    return () => {
      if (shown.current === model) shown.current = null
    }
  }, [model, shown])
  const emoteClips = useEmoteClips(avatar, true)
  const groupRef = useRef<Group>(null)
  const cueRef = useRef(cue)
  cueRef.current = cue
  const endRef = useRef(onCueEnd)
  endRef.current = onCueEnd

  const mixer = useMemo(() => new AnimationMixer(model), [model])
  const layer = useMemo(() => new EmoteLayer(mixer), [mixer])
  useEffect(() => layer.setClips(emoteClips), [layer, emoteClips])
  useEffect(() => {
    const idle = clips.find((clip) => clip.name === 'idle')
    if (!idle) return
    mixer.clipAction(idle).play()
    return () => {
      mixer.stopAllAction()
    }
  }, [clips, mixer])

  useFrame((_, delta) => {
    keepOwnership(model, anisotropy)
    const weight = layer.update(cueRef.current, false, delta)
    const idle = clips.find((clip) => clip.name === 'idle')
    if (idle) mixer.clipAction(idle).setEffectiveWeight(1 - weight)
    if (cueRef.current && layer.finished(cueRef.current)) endRef.current()
    mixer.update(delta)
    if (groupRef.current) {
      groupRef.current.rotation.y += (yaw.current - groupRef.current.rotation.y) * 0.25
    }
  })

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  )
}

/** A soft white disc the character stands on, ringed in light blue. */
function Platform() {
  return (
    <group rotation-x={-Math.PI / 2}>
      <mesh receiveShadow>
        <circleGeometry args={[0.95, 96]} />
        <meshStandardMaterial color="#f8f9fb" roughness={0.9} />
      </mesh>
      <mesh position-z={0.001}>
        <ringGeometry args={[0.95, 0.975, 128]} />
        <meshBasicMaterial color="#bcd6f2" toneMapped={false} />
      </mesh>
      <mesh position-z={0.0005}>
        <ringGeometry args={[1.05, 1.9, 128]} />
        <meshBasicMaterial color="#ffffff" opacity={0.35} toneMapped={false} transparent />
      </mesh>
    </group>
  )
}

/**
 * The studio's 3D view: the character on a lit turntable, idling or playing
 * the emote being previewed, framed by `focus`. Dragging turns it (via
 * `yaw`), the wheel zooms.
 */
export function StudioStage({
  avatarId,
  look,
  cue,
  focus,
  zoom,
  yaw,
  onCueEnd,
}: {
  avatarId: string
  look: AvatarLook
  cue: EmoteCue | null
  focus: CameraFocus
  zoom: number
  yaw: { current: number }
  onCueEnd: () => void
}) {
  const stature = findAvatar(avatarId).hip * HEIGHT_PER_HIP
  const model = useRef<Object3D | null>(null)
  const view = useMemo<View>(() => ({ x: 0, y: 1, half: 1 }), [])
  return (
    <Canvas
      camera={{ fov: LENS[focus].fov, near: 0.05, far: 50, position: [0, 1, 4] }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping
        gl.toneMappingExposure = 1
      }}
      shadows="percentage"
    >
      <Backdrop />
      <StudioEnvironment />
      <StudioLights view={view} />
      <Platform />
      {(focus === 'full' || focus === 'upper') && (
        <ContactShadows
          blur={2.4}
          color="#1b2533"
          far={1.2}
          opacity={0.5}
          position={[0, 0.003, 0]}
          resolution={512}
          scale={2.6}
        />
      )}
      <Suspense fallback={null}>
        <StudioAvatar
          avatarId={avatarId}
          cue={cue}
          look={look}
          onCueEnd={onCueEnd}
          shown={model}
          yaw={yaw}
        />
      </Suspense>
      <CameraRig
        focus={focus}
        model={model}
        scale={bodyHeightScale(look.body)}
        stature={stature}
        view={view}
        zoom={zoom}
      />
    </Canvas>
  )
}
