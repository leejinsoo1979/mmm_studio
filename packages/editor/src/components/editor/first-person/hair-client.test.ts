import { describe, expect, test } from 'bun:test'
import { Bone, Matrix4, Raycaster, Skeleton, Vector3 } from 'three'
import type { BaseInput, BaseResult } from './hair-base'
import {
  HairClient,
  type HairPort,
  hairMesh,
  ribbonGeometry,
  rootsGeometry,
  showShells,
} from './hair-client'
import type { HairBuild, HairReply, HairRequest, RibbonArrays } from './hair-grow'
import { CORE_COVERAGE, newHairValues } from './hair-material'

/** One strip of `points` points, two vertices each, as a build lays it out. */
function strip(points: number): RibbonArrays {
  const n = points * 2
  const index = new Uint32Array((points - 1) * 6)
  for (let k = 0; k < points - 1; k++)
    index.set(
      [0, 1, 2, 1, 3, 2].map((v) => v + k * 2),
      k * 6,
    )
  const skinIndex = new Uint16Array(n * 4).fill(3)
  const skinWeight = new Float32Array(n * 4)
  for (let v = 0; v < n; v++) skinWeight[v * 4] = 1
  return {
    position: Float32Array.from({ length: n * 3 }, (_, i) => (i % 3 === 1 ? -i * 0.001 : 0)),
    normal: new Float32Array(n * 3).fill(1),
    tangent: new Float32Array(n * 4).fill(1),
    uv: new Float32Array(n * 2),
    hairData: new Float32Array(n * 4),
    hairShape: new Float32Array(n * 4),
    skinIndex,
    skinWeight,
    index,
  }
}

function roots(): BaseResult['roots'] {
  return {
    position: new Float32Array(12),
    normal: new Float32Array(12),
    scalpDir: new Float32Array(16),
    comb: new Float32Array(12),
    skinIndex: new Uint16Array(16),
    skinWeight: new Float32Array(16),
    index: Uint32Array.from([0, 1, 2, 1, 3, 2, 0, 2, 3]),
    srcVertex: new Uint32Array(4),
    height: new Float32Array(4),
    grows: new Float32Array(4),
    shellStart: 6,
  }
}

describe('ribbonGeometry', () => {
  test("lays a build's strips out with the one fixed layout, uv2 the very attribute uv is", () => {
    const g = ribbonGeometry(strip(5))
    const layout = Object.fromEntries(
      Object.entries(g.attributes).map(([name, a]) => [
        name,
        [a.itemSize, a.array.constructor.name],
      ]),
    )
    expect(layout).toEqual({
      position: [3, 'Float32Array'],
      normal: [3, 'Float32Array'],
      tangent: [4, 'Float32Array'],
      uv: [2, 'Float32Array'],
      uv2: [2, 'Float32Array'],
      hairData: [4, 'Float32Array'],
      hairShape: [4, 'Float32Array'],
      skinIndex: [4, 'Uint16Array'],
      skinWeight: [4, 'Float32Array'],
    })
    expect(g.attributes.uv2).toBe(g.attributes.uv)
    expect(g.index!.array).toBeInstanceOf(Uint32Array)
    expect(g.boundingSphere).not.toBeNull()
  })
})

describe('rootsGeometry', () => {
  test('draws the undercut shells only when asked', () => {
    const g = rootsGeometry(roots())
    expect(g.drawRange.count).toBe(6)
    showShells(g, true)
    expect(g.drawRange.count).toBe(Number.POSITIVE_INFINITY)
    showShells(g, false)
    expect(g.drawRange.count).toBe(6)
    expect(Object.keys(g.attributes).sort()).toEqual(
      ['comb', 'grows', 'normal', 'position', 'scalpDir', 'skinIndex', 'skinWeight'].sort(),
    )
  })
})

describe('hairMesh', () => {
  const bones = [0, 1, 2, 3].map(() => new Bone())
  const skeleton = new Skeleton(bones)
  const values = newHairValues()
  const HEAD = 2

  test('is unpickable, drawn after the head, and carries the shared values', () => {
    const mesh = hairMesh(
      'inner',
      ribbonGeometry(strip(4)),
      skeleton,
      new Matrix4(),
      HEAD,
      values,
      true,
    )!
    expect(mesh.name).toBe('hair:inner')
    expect(mesh.renderOrder).toBe(2)
    expect(mesh.castShadow).toBe(true)
    expect(mesh.userData.hair).toBe(values)
    // The head bone as given, not the bone the first vertex leans on (3 here).
    expect(mesh.userData.hairBone).toBe(HEAD)
    const hits: unknown[] = []
    mesh.updateMatrixWorld()
    new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1)).intersectObject(
      mesh,
      false,
      hits as never,
    )
    expect(hits).toEqual([])
  })

  test("draws the outer strips' solid cores only in the studio, and never casts strays or roots", () => {
    const geometry = ribbonGeometry(strip(4))
    expect(
      hairMesh('outer', geometry, skeleton, new Matrix4(), HEAD, values, true)!.userData.hairCore,
    ).toBe(CORE_COVERAGE)
    expect(
      hairMesh('outer', geometry, skeleton, new Matrix4(), HEAD, values, false)!.userData.hairCore,
    ).toBe(0.02)
    expect(
      hairMesh('strays', geometry, skeleton, new Matrix4(), HEAD, values, true)!.castShadow,
    ).toBe(false)
    const root = hairMesh(
      'roots',
      rootsGeometry(roots()),
      skeleton,
      new Matrix4(),
      HEAD,
      values,
      true,
    )!
    expect(root.castShadow).toBe(false)
    expect(root.renderOrder).toBe(1)
    expect(
      hairMesh('soft', geometry, skeleton, new Matrix4(), HEAD, values, true)!.renderOrder,
    ).toBe(3)
  })

  test('makes no mesh for a geometry with nothing to draw', () => {
    const empty = ribbonGeometry({ ...strip(4), index: new Uint32Array(0) })
    expect(hairMesh('strays', empty, skeleton, new Matrix4(), HEAD, values, true)).toBeNull()
  })
})

/** A stand-in hair worker: what it was sent, and a way to answer. */
function fakeWorker() {
  const sent: HairRequest[] = []
  let terminated = false
  const port: HairPort = {
    postMessage: (message) => sent.push(message),
    onmessage: null,
    onerror: null,
    terminate: () => {
      terminated = true
    },
  }
  const answer = (reply: HairReply) => port.onmessage!({ data: reply } as MessageEvent<HairReply>)
  const crash = () => port.onerror!(new Event('error'))
  return { port, sent, answer, crash, terminated: () => terminated }
}

const input = (avatar: string) => ({ avatar }) as BaseInput
const base = {} as BaseResult
const build = { key: 'k' } as HairBuild

const grow = (slot: string, avatar: string, version = 0) => ({
  slot,
  avatar,
  cut: { style: 'bob' as const, length: 0, volume: 0, curl: 0, part: 0, fringe: 0.5 },
  tier: 'studio' as const,
  shape: { version, head: new Float32Array(3), body: null },
  priority: 0,
})

function listener() {
  const builds: string[] = []
  const errors: string[] = []
  return {
    builds,
    errors,
    listener: {
      build: (key: string) => builds.push(key),
      error: (message: string) => errors.push(message),
    },
  }
}

describe('HairClient', () => {
  test('starts its worker on first use and sends a head once, however often it is asked for', async () => {
    const worker = fakeWorker()
    let started = 0
    const client = new HairClient(() => {
      started++
      return worker.port
    })
    expect(started).toBe(0)
    const first = client.base('a', input('a'))
    expect(client.base('a', input('a'))).toBe(first)
    expect(started).toBe(1)
    expect(worker.sent.map((m) => m.kind)).toEqual(['base'])
    worker.answer({ kind: 'base', avatar: 'a', base })
    expect(await first).toBe(base)
  })

  test("routes each slot's builds to it, and nothing once it let go", () => {
    const worker = fakeWorker()
    const client = new HairClient(() => worker.port)
    const one = listener()
    const two = listener()
    client.grow(grow('s1', 'a'), one.listener)
    client.grow(grow('s2', 'a'), two.listener)
    worker.answer({ kind: 'grow', slot: 's2', key: 'k2', build })
    worker.answer({ kind: 'grow', slot: 's1', key: 'k1', build })
    expect(one.builds).toEqual(['k1'])
    expect(two.builds).toEqual(['k2'])
    client.cancel('s1')
    expect(worker.sent.at(-1)).toEqual({ kind: 'cancel', slot: 's1' })
    worker.answer({ kind: 'grow', slot: 's1', key: 'k3', build })
    expect(one.builds).toEqual(['k1'])
  })

  test("sends a head the worker let go again, then each of its slots' latest ask", () => {
    const worker = fakeWorker()
    const client = new HairClient(() => worker.port)
    void client.base('a', input('a'))
    const { listener: l } = listener()
    client.grow(grow('s1', 'a', 1), l)
    client.grow(grow('s1', 'a', 2), l)
    client.grow(grow('s2', 'b'), l)
    worker.sent.length = 0
    worker.answer({ kind: 'missing', avatar: 'a' })
    expect(worker.sent.map((m) => m.kind)).toEqual(['base', 'grow'])
    const again = worker.sent[1] as Extract<HairRequest, { kind: 'grow' }>
    expect(again.slot).toBe('s1')
    expect(again.shape.version).toBe(2)
  })

  test('tells a slot its grow failed, and a failed head is built again when asked for', async () => {
    const worker = fakeWorker()
    const client = new HairClient(() => worker.port)
    const failing = client.base('a', input('a'))
    const one = listener()
    client.grow(grow('s1', 'a'), one.listener)
    worker.answer({ kind: 'error', avatar: 'a', message: 'no skull' })
    await expect(failing).rejects.toThrow('no skull')
    worker.answer({ kind: 'error', slot: 's1', avatar: 'a', message: 'no skull' })
    expect(one.errors).toEqual(['no skull'])
    worker.sent.length = 0
    void client.base('a', input('a'))
    expect(worker.sent.map((m) => m.kind)).toEqual(['base'])
  })

  test('fails every head and slot when the worker stops, and every later ask at once', async () => {
    const worker = fakeWorker()
    const client = new HairClient(() => worker.port)
    const pending = client.base('a', input('a'))
    const one = listener()
    client.grow(grow('s1', 'a'), one.listener)
    worker.crash()
    expect(worker.terminated()).toBe(true)
    await expect(pending).rejects.toThrow()
    expect(one.errors).toHaveLength(1)
    await expect(client.base('b', input('b'))).rejects.toThrow()
    const two = listener()
    client.grow(grow('s2', 'b'), two.listener)
    await Promise.resolve()
    expect(two.errors).toHaveLength(1)
  })

  test('keeps characters on their own hair where no worker starts', async () => {
    const client = new HairClient(() => {
      throw new Error('no workers here')
    })
    await expect(client.base('a', input('a'))).rejects.toThrow('no workers here')
  })
})
