import { describe, expect, test } from 'bun:test'
import { type Mesh, type MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three'
import {
  disposeRoom,
  KEY_FROM,
  SOFTBOXES,
  type SoftboxRoom,
  STUDIO_LIGHTING,
  softboxRoom,
} from './studio-lighting'

const PORTRAIT_ROOM = STUDIO_LIGHTING.portrait.environment as SoftboxRoom

describe('STUDIO_LIGHTING', () => {
  test('classic is the studio as it always was', () => {
    expect(STUDIO_LIGHTING.classic).toEqual({
      key: 2.6,
      fill: 0.55,
      rim: 3,
      kick: 1.4,
      environment: 'room',
      environmentIntensity: 0.35,
      shadowBias: -0.0003,
      normalBias: 0.012,
      softShadow: false,
    })
  })

  test('portrait casts the key shadow close to the surface, with the soft edge, under a softbox room', () => {
    const { classic, portrait } = STUDIO_LIGHTING
    expect(portrait.normalBias).toBeLessThan(classic.normalBias / 2)
    expect(portrait.softShadow).toBe(true)
    expect(portrait.environment).not.toBe('room')
    expect(portrait.key).toBeGreaterThan(classic.key)
  })

  test("portrait still fills the face's shadow side, as the classic room does", () => {
    // A near-black room (walls 0.02 at 0.6) left pale faces 10-16 L* darker on that side.
    const { classic, portrait } = STUDIO_LIGHTING
    expect(portrait.fill).toBeGreaterThanOrEqual(classic.fill)
    expect(PORTRAIT_ROOM.walls * portrait.environmentIntensity).toBeGreaterThan(0.2)
  })
})

describe('softboxRoom', () => {
  const room = softboxRoom(PORTRAIT_ROOM)
  const panels = room.children.filter(
    (o) => (o as Mesh).geometry instanceof PlaneGeometry && o.position.length() > 2,
  ) as Mesh[]

  test('stands a softbox where each light shines from, facing the middle of the room', () => {
    expect(panels).toHaveLength(SOFTBOXES.length)
    const key = panels.find(
      (panel) => panel.position.clone().normalize().distanceTo(KEY_FROM) < 1e-6,
    )
    expect(key).toBeDefined()
    const facing = new Vector3(0, 0, 1).applyQuaternion(key!.quaternion)
    expect(facing.dot(KEY_FROM)).toBeCloseTo(-1)
  })

  test('the softboxes outshine the walls and floor, the key by far', () => {
    const glow = (mesh: Mesh) => (mesh.material as MeshBasicMaterial).color.r
    const dimmest = Math.min(...panels.map(glow))
    const key = panels.find(
      (panel) => panel.position.clone().normalize().distanceTo(KEY_FROM) < 1e-6,
    )
    const rest = room.children.filter((o) => !panels.includes(o as Mesh)) as Mesh[]
    expect(rest.length).toBeGreaterThan(0)
    for (const mesh of rest) {
      expect(glow(mesh)).toBeLessThan(dimmest / 2)
      expect(glow(mesh)).toBeLessThan(glow(key!) / 20)
    }
  })

  test('is disposed whole', () => {
    let disposed = 0
    room.traverse((o) => {
      const mesh = o as Mesh
      if (mesh.isMesh) mesh.geometry.addEventListener('dispose', () => disposed++)
    })
    disposeRoom(room)
    expect(disposed).toBe(room.children.length)
  })
})
