'use client'

import {
  type AnyNode,
  solveElectrical,
  useRegistry,
  useScene,
  type WireNode,
} from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import { CatmullRomCurve3, type Group, TubeGeometry, Vector3 } from 'three'
import { arcPoints, circuitColor, wireEnds } from './route'

/** 3D run: up from the first device into the ceiling void, along the plan
 *  arc at `height`, down to the second device. Glows while live. */
export default function WireRenderer({ node }: { node: WireNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'wire', ref)
  const handlers = useNodeEvents(node as never, 'wire' as never)
  const from = useScene((s) => s.nodes[node.from.nodeId as AnyNode['id']])
  const to = useScene((s) => s.nodes[node.to.nodeId as AnyNode['id']])
  const energized = useScene((s) => solveElectrical(s.nodes).wires.get(node.id)?.energized ?? false)
  const color = useScene((s) => {
    const state = solveElectrical(s.nodes)
    return circuitColor(state, state.wires.get(node.id)?.circuitId ?? null)
  })
  const geometry = useMemo(() => {
    const nodes: Record<string, AnyNode | undefined> = {
      [node.from.nodeId]: from,
      [node.to.nodeId]: to,
    }
    const { a, b } = wireEnds(node, (id) => nodes[id])
    const y = (n: AnyNode | undefined) =>
      ((n as { position?: number[] } | undefined)?.position?.[1] ?? node.height) as number
    const plan = arcPoints(a, b)
    const points = [
      new Vector3(a[0], y(from), a[1]),
      ...plan.map(([x, z]) => new Vector3(x, node.height, z)),
      new Vector3(b[0], y(to), b[1]),
    ]
    return new TubeGeometry(new CatmullRomCurve3(points, false, 'catmullrom', 0.1), 64, 0.008, 6)
  }, [node, from, to])
  return (
    <group ref={ref} {...handlers}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={energized ? color : '#868e96'} toneMapped={false} />
      </mesh>
    </group>
  )
}
