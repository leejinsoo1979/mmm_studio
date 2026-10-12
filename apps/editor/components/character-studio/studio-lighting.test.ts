import { describe, expect, test } from 'bun:test'
import { type Mesh, type MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three'
import { disposeRoom, KEY_FROM, SOFTBOXES, STUDIO_LIGHTING, softboxRoom } from './studio-lighting'

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
      disc: '#16191e',
    })
  })

  test('실사 casts the key shadow close to the surface, with the soft edge, under a softbox room', () => {
    const { classic, real } = STUDIO_LIGHTING
    expect(real.normalBias).toBeLessThan(classic.normalBias / 3)
    expect(real.softShadow).toBe(true)
    expect(real.environment).toBe('softboxes')
    expect(real.key).toBeGreaterThan(classic.key)
  })
})

describe('softboxRoom', () => {
  const room = softboxRoom()
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

  test('the softboxes far outshine the walls and floor', () => {
    const glow = (mesh: Mesh) => (mesh.material as MeshBasicMaterial).color.r
    const dimmest = Math.min(...panels.map(glow))
    const rest = room.children.filter((o) => !panels.includes(o as Mesh)) as Mesh[]
    expect(rest.length).toBeGreaterThan(0)
    for (const mesh of rest) expect(glow(mesh)).toBeLessThan(dimmest / 10)
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
