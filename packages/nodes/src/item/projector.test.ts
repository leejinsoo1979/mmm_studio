import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, sceneRegistry } from '@pascal-app/core'
import {
  BackSide,
  BoxGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three'
import { aimProjection, conformToPart, fitPlacedProjection, pictureGeometry } from './projector'

const scene = new Scene()

function register(type: string, id: string, mesh: Mesh | InstancedMesh) {
  scene.add(mesh)
  scene.updateMatrixWorld(true)
  sceneRegistry.nodes.set(id as AnyNodeId, mesh)
  sceneRegistry.byType[type]?.add(id)
}

afterEach(() => {
  scene.clear()
  sceneRegistry.clear()
})

/** Aims from a camera at `eye` looking at `target`, as the walkthrough's centre ray does. */
function aimFrom(eye: Vector3, target: Vector3, width = 2, aspect = 16 / 9) {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100)
  camera.position.copy(eye)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  const raycaster = new Raycaster()
  raycaster.setFromCamera(new Vector2(0, 0), camera)
  const screenUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
  const screenRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
  const projection = aimProjection(raycaster, width, aspect, screenUp)?.projection ?? null
  if (!projection) return { projection, pictureUp: null, pictureRight: null, screenUp, screenRight }
  const turn = new Quaternion().fromArray(projection.quaternion)
  return {
    projection,
    pictureUp: new Vector3(0, 1, 0).applyQuaternion(turn),
    pictureRight: new Vector3(1, 0, 0).applyQuaternion(turn),
    screenUp,
    screenRight,
  }
}

/** A wall 5 m long, 2.7 m high, 0.2 m thick, along x at z = 0. */
const wall = () => {
  const mesh = new Mesh(new BoxGeometry(5, 2.7, 0.2), new MeshBasicMaterial())
  mesh.position.set(0, 1.35, 0)
  return mesh
}

describe('aimProjection', () => {
  test('on a wall the picture stands upright, facing the thrower, just off the surface', () => {
    register('wall', 'wall_a', wall())
    const { projection, pictureUp, pictureRight, screenRight } = aimFrom(
      new Vector3(0, 1.5, 5),
      new Vector3(0, 1.5, 0),
    )
    expect(projection).not.toBeNull()
    expect(projection?.position[2]).toBeCloseTo(0.106, 3)
    expect(projection?.position[1]).toBeCloseTo(1.5, 3)
    expect(pictureUp?.y).toBeCloseTo(1, 5)
    expect(pictureRight?.dot(screenRight)).toBeGreaterThan(0.99)
  })

  test("a picture aimed near a wall's end slides back onto the wall", () => {
    register('wall', 'wall_a', wall())
    const { projection } = aimFrom(new Vector3(2.3, 1.5, 5), new Vector3(2.3, 1.5, 0), 2)
    // The wall ends at x = 2.5: a 2 m picture is centred 1 m in from it.
    expect(projection?.position[0]).toBeCloseTo(1.5, 3)
  })

  test('a picture larger than the wall shrinks to fill it, centred', () => {
    register('wall', 'wall_a', wall())
    const { projection } = aimFrom(new Vector3(0, 2, 5), new Vector3(0, 2, 0), 5, 1)
    // A square picture 5 m across on a 2.7 m high wall: 2.7 m square.
    expect(projection?.width).toBeCloseTo(2.7, 3)
    expect(projection?.position[1]).toBeCloseTo(1.35, 3)
  })

  test('on a floor the picture reads upright from where it was thrown', () => {
    const floor = new Mesh(new PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new MeshBasicMaterial())
    register('slab', 'slab_a', floor)
    const { projection, pictureUp, pictureRight, screenUp, screenRight } = aimFrom(
      new Vector3(0, 1.6, 3),
      new Vector3(0, 0, 0),
    )
    expect(projection?.position[1]).toBeCloseTo(0.006, 4)
    expect(pictureUp?.dot(screenUp)).toBeGreaterThan(0)
    expect(pictureRight?.dot(screenRight)).toBeGreaterThan(0.99)
  })

  test('on a ceiling the picture reads upright too (not turned over)', () => {
    // As the ceiling renderer builds it: facing up, drawn (and hit) from below.
    const ceiling = new Mesh(
      new PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ side: BackSide }),
    )
    ceiling.position.y = 2.7
    register('ceiling', 'ceiling_a', ceiling)
    const { projection, pictureUp, pictureRight, screenUp, screenRight } = aimFrom(
      new Vector3(0, 1.6, 2),
      new Vector3(0, 2.7, 0),
    )
    expect(projection?.position[1]).toBeCloseTo(2.694, 4)
    expect(pictureUp?.dot(screenUp)).toBeGreaterThan(0)
    expect(pictureRight?.dot(screenRight)).toBeGreaterThan(0.99)
  })

  test("an opening's invisible hit box doesn't catch the picture", () => {
    register('wall', 'wall_a', wall())
    const hitbox = new Mesh(new BoxGeometry(1, 2, 0.3), new MeshBasicMaterial({ visible: false }))
    hitbox.position.set(0, 1, 1)
    register('wall', 'door_a', hitbox)
    const { projection } = aimFrom(new Vector3(0, 1, 5), new Vector3(0, 1, 0))
    expect(projection?.position[2]).toBeCloseTo(0.106, 3)
  })

  test('nothing in the aim: no projection', () => {
    register('wall', 'wall_a', wall())
    expect(aimFrom(new Vector3(0, 1.5, 5), new Vector3(0, 1.5, 20)).projection).toBeNull()
  })

  test('an elevator in front of the wall takes the picture (its instance placed right)', () => {
    register('wall', 'wall_a', wall())
    const cab = new InstancedMesh(new BoxGeometry(1.5, 2.2, 1.5), new MeshBasicMaterial(), 1)
    cab.setMatrixAt(0, new Matrix4().makeTranslation(0, 1.1, 1.5))
    register('elevator', 'elevator_a', cab)
    const { projection, pictureRight, screenRight } = aimFrom(
      new Vector3(0, 1.2, 6),
      new Vector3(0, 1.2, 0),
      1,
    )
    // The cab's front face is at z = 2.25.
    expect(projection?.position[2]).toBeCloseTo(2.256, 3)
    expect(pictureRight?.dot(screenRight)).toBeGreaterThan(0.99)
  })
})

describe('a picture on a curved part', () => {
  test('bends to the inside of a round wall instead of sinking into it', () => {
    // The inside of a round room, radius 3 m, seen from its middle.
    const round = new Mesh(
      new CylinderGeometry(3, 3, 2.7, 64, 1, true),
      new MeshBasicMaterial({ side: BackSide }),
    )
    round.position.y = 1.35
    register('wall', 'wall_round', round)
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100)
    camera.position.set(0, 1.5, 0)
    camera.lookAt(0, 1.5, -3)
    camera.updateMatrixWorld(true)
    const raycaster = new Raycaster()
    raycaster.setFromCamera(new Vector2(0, 0), camera)
    const width = 2
    const height = width / (16 / 9)
    const found = aimProjection(raycaster, width, 16 / 9, new Vector3(0, 1, 0))
    expect(found).not.toBeNull()
    if (!found) return
    const centre = new Vector3().fromArray(found.projection.position)
    const turn = new Quaternion().fromArray(found.projection.quaternion)
    const geometry = pictureGeometry(8)
    conformToPart(geometry, found.part, centre, turn, width, height)
    const positions = geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      const point = new Vector3(
        positions.getX(i) * width,
        positions.getY(i) * height,
        positions.getZ(i),
      )
        .applyQuaternion(turn)
        .add(centre)
      // Every point sits just in front of the curved surface: the gap inside the radius.
      expect(Math.hypot(point.x, point.z)).toBeCloseTo(3 - 0.006, 2)
    }
  })

  test('stays flat on a flat wall', () => {
    register('wall', 'wall_a', wall())
    const raycaster = new Raycaster(new Vector3(0, 1.5, 5), new Vector3(0, 0, -1))
    const found = aimProjection(raycaster, 2, 16 / 9, new Vector3(0, 1, 0))
    if (!found) throw new Error('no aim')
    const geometry = pictureGeometry(4)
    conformToPart(
      geometry,
      found.part,
      new Vector3().fromArray(found.projection.position),
      new Quaternion().fromArray(found.projection.quaternion),
      2,
      2 / (16 / 9),
    )
    const positions = geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) expect(positions.getZ(i)).toBe(0)
  })
})

describe('a placed picture', () => {
  test('grown past the wall end slides back on, and returns when shrunk', () => {
    register('wall', 'wall_a', wall())
    const raycaster = new Raycaster(new Vector3(1.5, 1.5, 5), new Vector3(0, 0, -1))
    const placed = aimProjection(raycaster, 2, 16 / 9, new Vector3(0, 1, 0))?.projection
    if (!placed) throw new Error('no aim')
    expect(placed.position[0]).toBeCloseTo(1.5, 3)
    const grown = fitPlacedProjection({ ...placed, width: 4 }, 4 / (16 / 9))
    // The wall ends at x = 2.5: a 4 m picture is centred 2 m in from it.
    expect(grown.centre.x).toBeCloseTo(0.5, 3)
    expect(grown.part).not.toBeNull()
    expect(fitPlacedProjection(placed, 2 / (16 / 9)).centre.x).toBeCloseTo(1.5, 3)
  })

  test('set wider than the wall it shows filling the wall, and keeps its set size', () => {
    register('wall', 'wall_a', wall())
    const raycaster = new Raycaster(new Vector3(1.5, 1.5, 5), new Vector3(0, 0, -1))
    const placed = aimProjection(raycaster, 2, 16 / 9, new Vector3(0, 1, 0))?.projection
    if (!placed) throw new Error('no aim')
    const huge = { ...placed, width: 10 }
    const fit = fitPlacedProjection(huge, 10 / (16 / 9))
    // 16:9 on a 5 m × 2.7 m wall: 4.8 m across (2.7 m high), slid in no further
    // than it has to from where it was aimed — its right edge at the wall end.
    expect(10 * fit.scale).toBeCloseTo(4.8, 3)
    expect(fit.centre.x + 2.4).toBeCloseTo(2.5, 3)
    expect(fit.centre.y).toBeCloseTo(1.35, 3)
    expect(huge.width).toBe(10)
  })

  test('with a taller page it stays within the wall height', () => {
    register('wall', 'wall_a', wall())
    const raycaster = new Raycaster(new Vector3(0, 2, 5), new Vector3(0, 0, -1))
    const placed = aimProjection(raycaster, 1.5, 16 / 9, new Vector3(0, 1, 0))?.projection
    if (!placed) throw new Error('no aim')
    // An A4 portrait page, 1.5 m across: 2.12 m tall, on a 2.7 m wall.
    const fit = fitPlacedProjection(placed, 1.5 * Math.SQRT2)
    expect(fit.centre.y + (1.5 * Math.SQRT2) / 2).toBeLessThanOrEqual(2.7 + 1e-6)
  })
})
