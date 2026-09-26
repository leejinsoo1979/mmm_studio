'use client'

import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import type { Group, Material } from 'three'
import { buildCountertopGeometry } from './countertop-geometry'
import { buildCabinetGeometry } from './geometry'
import type { CabinetNode, CountertopNode } from './schema'

/**
 * Translucent placement ghost. Built with the real geometry builder, then
 * every material is cloned (never mutate the builder's materials) and made
 * see-through; raycasting is disabled so the cursor ray reaches the grid.
 */
function useGhost(built: Group) {
  useEffect(() => {
    const cloned: Material[] = []
    built.traverse((obj) => {
      ;(obj as unknown as { raycast: () => void }).raycast = () => {}
      const mesh = obj as { material?: Material | Material[] }
      if (!mesh.material) return
      const ghost = (mat: Material): Material => {
        const c = mat.clone()
        c.transparent = true
        c.opacity = 0.5
        c.depthWrite = false
        cloned.push(c)
        return c
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(ghost) : ghost(mesh.material)
    })
    return () => {
      for (const c of cloned) c.dispose()
      built.traverse((obj) => {
        ;(obj as { geometry?: { dispose: () => void } }).geometry?.dispose()
      })
    }
  }, [built])
}

export function CabinetPreview({ node }: { node: CabinetNode }) {
  const shading = useViewer((s) => s.shading)
  const built = useMemo(() => buildCabinetGeometry(node, undefined, shading), [node, shading])
  useGhost(built)
  return <primitive object={built} />
}

export function CountertopPreview({ node }: { node: CountertopNode }) {
  const shading = useViewer((s) => s.shading)
  const built = useMemo(() => buildCountertopGeometry(node, undefined, shading), [node, shading])
  useGhost(built)
  return <primitive object={built} />
}

export default CabinetPreview
