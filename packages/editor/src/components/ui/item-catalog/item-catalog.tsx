'use client'

import type { AssetInput } from '@pascal-app/core'
import { resolveCdnUrl, useViewer } from '@pascal-app/viewer'
import useEditor, { type CatalogCategory } from './../../../store/use-editor'
import { resolveAssetSnapTarget, SnapTargetBadge } from '../snap-target-badge'
import { CatalogCard } from './catalog-card'
import { formatCatalogSize, formatCatalogSizeFull } from './catalog-format'
import { CATALOG_ITEMS } from './catalog-items'
import { CATALOG_GRID } from './catalog-section'

export function ItemCatalog({
  category,
  items: itemsOverride,
  activePlacementTag = null,
  activeFunctionalTag = null,
  search = '',
  overrideItems,
  leadingTile,
  emptyState,
}: {
  category: CatalogCategory
  items?: AssetInput[]
  activePlacementTag?: string | null
  activeFunctionalTag?: string | null
  search?: string
  /** When set, bypasses all filtering and displays these items directly (used for server search results) */
  overrideItems?: AssetInput[]
  /** Rendered as the first grid cell, always visible when there are items. */
  leadingTile?: React.ReactNode
  /** Rendered when there are no items to show. Replaces the empty grid. */
  emptyState?: React.ReactNode
}) {
  const selectedItem = useEditor((state) => state.selectedItem)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const setSelectedItem = useEditor((state) => state.setSelectedItem)
  const setMode = useEditor((state) => state.setMode)
  const setTool = useEditor((state) => state.setTool)

  const sourceItems = itemsOverride ?? CATALOG_ITEMS
  // Server-provided results bypass all local filtering; otherwise filter by category/search/tags
  const filteredItems =
    overrideItems ??
    (() => {
      const categoryItems = search
        ? sourceItems
        : sourceItems.filter((item) => item.category === category)
      return categoryItems.filter((item) => {
        const tags = item.tags ?? []
        if (activePlacementTag && !tags.includes(activePlacementTag)) return false
        if (activeFunctionalTag && !tags.includes(activeFunctionalTag)) return false
        if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
        return true
      })
    })()

  if (filteredItems.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  const placing = mode === 'build' && tool === 'item'

  return (
    <div className={CATALOG_GRID}>
      {leadingTile}
      {filteredItems.map((item, index) => {
        const snapTarget = resolveAssetSnapTarget(item?.attachTo)
        const image = resolveCdnUrl(item.thumbnail)
        return (
          <CatalogCard
            active={placing && selectedItem?.src === item.src}
            badge={snapTarget ? <SnapTargetBadge size="tree" target={snapTarget} /> : undefined}
            hover={{ meta: formatCatalogSizeFull(item.dimensions) }}
            image={image}
            key={`${item.id}-${index}`}
            label={item.name}
            meta={formatCatalogSize(item.dimensions)}
            onClick={() => {
              // Drop the current selection before arming placement — keeping
              // it would route shortcuts (rotate & co) to both the ghost and
              // the selected node.
              useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
              setSelectedItem(item)
              setTool('item')
              setMode('build')
            }}
          />
        )
      })}
    </div>
  )
}
