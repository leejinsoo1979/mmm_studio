import {
  BackSide,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three'
import {
  Fn,
  interleavedGradientNoise,
  reference,
  renderGroup,
  screenCoordinate,
  texture,
  vogelDiskSample,
} from 'three/tsl'

/**
 * The studio's lighting, as it was ('classic') and in 실사 ('real'): a
 * dark room whose softboxes stand where the lights shine from, so a face
 * keeps its shape and each eye catches one light; the key light a little
 * stronger and the fill brighter against it; and the key's shadow cast
 * close to the surface (the face shading itself under the nose, brows and
 * hair) with a soft, smooth edge.
 */

/** Where each light shines from (towards the aim), seen from the camera: right, up, towards it. */
export const KEY_FROM = new Vector3(0.62, 0.62, 0.58).normalize()
export const FILL_FROM = new Vector3(-0.8, 0.12, 0.6).normalize()
export const RIM_FROM = new Vector3(-0.8, 0.28, -0.53).normalize()
export const KICK_FROM = new Vector3(0.82, 0.18, -0.55).normalize()

export type StudioMode = 'classic' | 'real'

export type StudioLighting = {
  /** The lights' intensities. */
  key: number
  fill: number
  rim: number
  kick: number
  /** The room lighting and showing in the character: three's studio room, or the softboxes'. */
  environment: 'room' | 'softboxes'
  environmentIntensity: number
  /** The key's shadow: its depth bias, how far (m) along the normal it is looked up, and whether its edge is the soft 32-tap one. */
  shadowBias: number
  normalBias: number
  softShadow: boolean
  /** The platform's disc: under the darker softbox room, a lighter grey keeps it from going black. */
  disc: string
}

export const STUDIO_LIGHTING: Record<StudioMode, StudioLighting> = {
  classic: {
    key: 2.6,
    fill: 0.55,
    rim: 3,
    kick: 1.4,
    environment: 'room',
    environmentIntensity: 0.35,
    shadowBias: -0.0003,
    normalBias: 0.012,
    softShadow: false,
    disc: '#16191e',
  },
  real: {
    key: 3,
    fill: 0.7,
    rim: 2.6,
    kick: 1.2,
    environment: 'softboxes',
    environmentIntensity: 0.6,
    shadowBias: -0.0001,
    normalBias: 0.003,
    softShadow: true,
    disc: '#3a4048',
  },
}

/** A softbox: where it stands (towards it from the aim), its size (m), how bright and what tint. */
type Softbox = { from: Vector3; width: number; height: number; glow: number; tint: string }

/** How far from the room's middle the softboxes stand (m). */
const SOFTBOX_DISTANCE = 4

export const SOFTBOXES: readonly Softbox[] = [
  { from: KEY_FROM, width: 1.8, height: 1.8, glow: 9, tint: '#fff0df' },
  { from: FILL_FROM, width: 2.6, height: 2, glow: 1.6, tint: '#dbe6ff' },
  { from: RIM_FROM, width: 0.45, height: 3, glow: 9, tint: '#eef4ff' },
  { from: KICK_FROM, width: 0.45, height: 2.4, glow: 5, tint: '#fff3e6' },
  // A dim one overhead.
  { from: new Vector3(0, 1, 0.15).normalize(), width: 3, height: 3, glow: 1.2, tint: '#ffffff' },
]

/** How bright the room's walls and floor are (linear), well under the softboxes. */
const WALLS = 0.02
const FLOOR = 0.035

/**
 * The dark room with the softboxes, to make the studio's environment
 * from (PMREM). Its geometries and materials are the caller's to dispose
 * (disposeRoom) once it is made.
 */
export function softboxRoom(): Scene {
  const room = new Scene()
  room.add(
    new Mesh(
      new SphereGeometry(8, 32, 16),
      new MeshBasicMaterial({ color: new Color().setScalar(WALLS), side: BackSide }),
    ),
  )
  for (const { from, width, height, glow, tint } of SOFTBOXES) {
    const panel = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ color: new Color(tint).multiplyScalar(glow), side: DoubleSide }),
    )
    panel.position.copy(from).multiplyScalar(SOFTBOX_DISTANCE)
    panel.lookAt(0, 0, 0)
    room.add(panel)
  }
  const floor = new Mesh(
    new PlaneGeometry(16, 16),
    new MeshBasicMaterial({ color: new Color().setScalar(FLOOR) }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -1.2
  room.add(floor)
  return room
}

export function disposeRoom(room: Scene) {
  room.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    ;(mesh.material as MeshBasicMaterial).dispose()
  })
}

const SOFT_TAPS = 32

/**
 * The key's soft shadow edge: percentage-closer filtering over 32 taps of a
 * Vogel disk turned by a per-pixel noise, as three's own PCF does with 5,
 * which at the studio's radii shows as grain. As wide as the shadow's
 * `radius` (in shadow-map texels).
 */
export const softShadowFilter = Fn(({ depthTexture, shadowCoord, shadow }: any) => {
  const mapSize = (reference('mapSize', 'vec2', shadow) as any).setGroup(renderGroup)
  const radius = (reference('radius', 'float', shadow) as any).setGroup(renderGroup)
  const reach = radius.div(mapSize.x)
  const turn = interleavedGradientNoise(screenCoordinate.xy).mul(Math.PI * 2)
  const disk = vogelDiskSample as unknown as (index: number, count: number, turn: unknown) => any
  let lit: any = null
  for (let i = 0; i < SOFT_TAPS; i++) {
    const at = shadowCoord.xy.add(disk(i, SOFT_TAPS, turn).mul(reach))
    const tap = texture(depthTexture, at).compare(shadowCoord.z)
    lit = lit ? lit.add(tap) : tap
  }
  return lit.div(SOFT_TAPS)
})
