import type { SlabNode } from '@pascal-app/core'

const AUTO_NAME = /^Room\s+(\d+)\s+Slab$/i

/** Space detection names rooms "Room N Slab"; show those as mmmcraft's "공간 N". */
export function roomDisplayName(node: Pick<SlabNode, 'name'>): string | undefined {
  const name = node.name?.trim()
  if (!name) return undefined
  const auto = AUTO_NAME.exec(name)
  return auto ? `공간 ${auto[1]}` : name
}
