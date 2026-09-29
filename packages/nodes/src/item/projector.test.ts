import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, sceneRegistry } from '@pascal-app/core'
import {
  BackSide,
  BoxGeometry,
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
import { aimProjection } from './projector'

const scene = new Scene()

function register(type: string, id: string, mesh: Mesh) {
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
  const projection = aimProjection(raycaster, width, aspect, screenUp)
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

  test('a picture taller than the wall is centred on its height', () => {
    register('wall', 'wall_a', wall())
    const { projection } = aimFrom(new Vector3(0, 2, 5), new Vector3(0, 2, 0), 5, 1)
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
})
