import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, useScene } from '@pascal-app/core'
import { Box3, type Object3D, Vector3 } from 'three'
import { isCabinetOpen, newCabinetHasDoor, setAllCabinetDoors, useCabinetDoors } from '../doors'
import { buildCabinetParts } from '../engine/parts'
import { buildCabinetGeometry, partCenter } from '../geometry'
import { CabinetNode } from '../schema'

type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

const cabinet = (extra: Partial<CabinetNode> = {}) =>
  CabinetNode.parse({
    widthMm: 900,
    interior: {
      id: 'root',
      kind: 'split',
      axis: 'y',
      sizesMm: [null, 400],
      children: [
        { id: 'low', kind: 'leaf', content: { type: 'drawers', count: 2, style: 'external' } },
        {
          id: 'high',
          kind: 'leaf',
          content: { type: 'shelves', count: 1, kind: 'dowel' },
          front: { type: 'door', leaves: '1', hinge: 'left' },
        },
      ],
    },
    ...extra,
  })

const roles = (node: CabinetNode) => buildCabinetParts(node).parts.map((p) => p.role)

describe('cabinet doors (mmmcraft 도어설치)', () => {
  test('without doors hung, door leaves are neither built nor cut; drawer fronts stay', () => {
    expect(roles(cabinet())).toContain('door')
    const bare = roles(cabinet({ hasDoor: false }))
    expect(bare).not.toContain('door')
    expect(bare).toContain('drawer-front')
  })

  test('a hinged leaf hangs from its hinge edge and swings out of the front', () => {
    const node = cabinet()
    const door = buildCabinetParts(node).parts.find((p) => p.role === 'door')!
    const group = buildCabinetGeometry(node)
    const pivot = group.getObjectByName(`cabinet-door-pivot-${door.id}`) as Object3D
    expect(pivot.userData.cabinetDoorHinge).toBe('left')
    const mesh = group.getObjectByName(`cabinet-door-${door.id}`) as Object3D
    group.updateMatrixWorld(true)
    const closed = mesh.getWorldPosition(new Vector3()).toArray()
    for (const [i, v] of partCenter(node, door).entries()) expect(closed[i]).toBeCloseTo(v, 6)

    const frontZ = new Box3().setFromObject(mesh).max.z
    pivot.rotation.y = -Math.PI / 2
    group.updateMatrixWorld(true)
    const open = new Box3().setFromObject(mesh)
    // Pivoting mid-leaf: the free edge comes forward by the leaf width less
    // half the thickness, and the leaf stays at the hinge edge.
    const half = door.box.d / 2000
    expect(open.max.z - frontZ).toBeCloseTo(door.box.w / 1000 - half, 6)
    expect(open.min.x).toBeCloseTo((door.box.x - node.widthMm / 2) / 1000 - half, 6)
  })
})

describe('도어설치 / 도어제거', () => {
  beforeEach(() => {
    useScene.setState({ nodes: {} })
    useCabinetDoors.setState({ installIntent: false, open: false, cabinetOpen: {} })
  })

  const put = (...nodes: CabinetNode[]) =>
    useScene.setState({
      nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) as unknown as Record<string, AnyNode>,
    })
  const hung = () =>
    Object.values(useScene.getState().nodes).map((n) => (n as unknown as CabinetNode).hasDoor)

  test('new cabinets come bare until doors are hung, then with doors', () => {
    expect(newCabinetHasDoor()).toBe(false)
    put(cabinet({ hasDoor: false }), cabinet({ hasDoor: false }))
    expect(newCabinetHasDoor()).toBe(false)

    setAllCabinetDoors(true)
    expect(hung()).toEqual([true, true])
    expect(newCabinetHasDoor()).toBe(true)

    useCabinetDoors.getState().setOpen(true)
    setAllCabinetDoors(false)
    expect(hung()).toEqual([false, false])
    expect(newCabinetHasDoor()).toBe(false)
    expect(useCabinetDoors.getState().open).toBe(false)
  })

  test('a scene that already has doors hung gives new cabinets doors', () => {
    put(cabinet())
    expect(newCabinetHasDoor()).toBe(true)
  })

  test('one cabinet opens on its own; open-all / close-all takes over again', () => {
    const [a, b] = [cabinet(), cabinet()]
    put(a, b)
    const { toggleCabinet, setOpen } = useCabinetDoors.getState()
    toggleCabinet(a.id)
    expect([isCabinetOpen(a.id), isCabinetOpen(b.id)]).toEqual([true, false])
    setOpen(true)
    toggleCabinet(b.id)
    expect([isCabinetOpen(a.id), isCabinetOpen(b.id)]).toEqual([true, false])
    setOpen(false)
    expect([isCabinetOpen(a.id), isCabinetOpen(b.id)]).toEqual([false, false])
  })
})
