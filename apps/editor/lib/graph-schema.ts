import { AnyNode } from '@pascal-app/core/schema'
import { CabinetNode, CountertopNode } from '@pascal-app/nodes/cabinet/schema'
import { z } from 'zod'

/**
 * Node kinds whose schema lives outside core's hand-maintained `AnyNode`
 * union. Without them a scene holding one of these kinds fails validation
 * and every autosave is rejected.
 */
const REGISTRY_NODE_SCHEMAS: Record<string, z.ZodType> = {
  cabinet: CabinetNode,
  countertop: CountertopNode,
}

/**
 * Validates a SceneGraph at an untrusted API boundary. Re-runs
 * `AnyNode.safeParse` on every node, which enforces the `AssetUrl`
 * allowlist in core (closes the Phase 3 SSRF / arbitrary-URL risk on
 * scan/guide/item/material fields).
 *
 * Shared between `POST /api/scenes` and `PUT /api/scenes/[id]` so neither
 * route can silently accept malicious URLs via the `graph` payload.
 *
 * Phase 8 P4 found the POST bypass; Phase 10 A2 found the PUT bypass.
 */
/**
 * `LevelNode.children` only lists core id shapes, so a level holding a
 * cabinet would fail. Validate the level with those children set aside —
 * each of them is still validated as a node in its own right below.
 */
function withoutRegistryChildren(node: unknown, nodes: Record<string, unknown>): unknown {
  const children = (node as { children?: unknown } | null)?.children
  if (!Array.isArray(children)) return node
  const kept = children.filter((childId) => {
    const child = typeof childId === 'string' ? nodes[childId] : undefined
    const childType = (child as { type?: unknown } | undefined)?.type
    return !(typeof childType === 'string' && childType in REGISTRY_NODE_SCHEMAS)
  })
  return kept.length === children.length ? node : { ...(node as object), children: kept }
}

export const apiGraphSchema = z
  .object({
    nodes: z.record(z.string(), z.unknown()),
    rootNodeIds: z.array(z.string()),
    collections: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    for (const [nodeId, node] of Object.entries(value.nodes)) {
      const type = (node as { type?: unknown } | null)?.type
      const schema = (typeof type === 'string' && REGISTRY_NODE_SCHEMAS[type]) || AnyNode
      const res = schema.safeParse(withoutRegistryChildren(node, value.nodes))
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', nodeId, ...issue.path],
            message: issue.message,
          })
        }
      }
    }
  })
