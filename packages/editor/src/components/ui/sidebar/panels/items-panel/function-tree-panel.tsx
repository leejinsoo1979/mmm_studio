'use client'

import type { AssetInput } from '@pascal-app/core'
import { Funnel } from 'lucide-react'
import NextImage from 'next/image'
import { type ReactNode, useMemo, useState } from 'react'
import { cn } from '../../../../../lib/utils'
import { CatalogIconRow } from '../../../item-catalog/catalog-icon-row'
import {
  CATALOG_BAND_ACTION,
  CatalogSearchBand,
} from '../../../item-catalog/catalog-search-band'
import { CATALOG_SCROLL, CatalogEmpty, CatalogSection } from '../../../item-catalog/catalog-section'
import { ItemCatalog } from '../../../item-catalog/item-catalog'
import { Popover, PopoverContent, PopoverTrigger } from '../../../primitives/popover'
import { resolveAssetSnapTarget } from '../../../snap-target-badge'
import type { ItemsPanelCustomCategory } from '.'

/** A function-axis taxonomy node, assembled into a tree by the embedder. */
export type FunctionTreeNode = {
  slug: string
  name: string
  /** Outline glyph for the room row; falls back to `iconUrl`. */
  icon?: ReactNode
  iconUrl?: string | null
  children: FunctionTreeNode[]
}

const SOURCE_CHIPS: Array<{ id: NonNullable<AssetInput['source']>; label: string }> = [
  { id: 'library', label: '라이브러리' },
  { id: 'community', label: '커뮤니티' },
  { id: 'mine', label: '내 것' },
]

type Placement = 'floor' | 'wall' | 'ceiling'

const PLACEMENTS: Array<{ id: Placement; label: string }> = [
  { id: 'floor', label: '바닥' },
  { id: 'wall', label: '벽' },
  { id: 'ceiling', label: '천장' },
]

function itemPlacement(item: AssetInput): Placement {
  const target = resolveAssetSnapTarget(item.attachTo)
  return target === 'wall' || target === 'ceiling' ? target : 'floor'
}

/** Every slug at or below `node`, so a non-leaf selection matches descendants. */
function descendantSlugs(node: FunctionTreeNode): Set<string> {
  const out = new Set<string>()
  const walk = (n: FunctionTreeNode) => {
    out.add(n.slug)
    for (const child of n.children) walk(child)
  }
  walk(node)
  return out
}

function itemFunctionSlugs(item: AssetInput): string[] {
  if (item.functionTags && item.functionTags.length > 0) return item.functionTags
  return item.category ? [item.category] : []
}

function RootIcon({ node }: { node: FunctionTreeNode }) {
  if (node.icon) return <>{node.icon}</>
  if (node.iconUrl)
    return (
      <NextImage
        alt=""
        className="size-5 object-contain"
        height={20}
        src={node.iconUrl}
        width={20}
      />
    )
  return <span className="font-semibold text-[10px]">{node.name.slice(0, 2)}</span>
}

/**
 * DB-driven hierarchical Items browse, laid out like inZOI's furniture tab:
 * the frosted search band, one icon row of rooms (roots), then one scroll of
 * sub-category sections, each a header bar over a 4-up grid. Searching
 * collapses the list to a flat result grid. The funnel narrows by placement
 * (floor / wall / ceiling); Library / Community / Mine by source.
 */
export function FunctionTreePanel({
  functionTree,
  items,
  onSearchChange,
  searchResults,
  leadingTile,
  emptyState,
  customCategories = [],
  showSourceFilter = true,
  renderHero,
}: {
  functionTree: FunctionTreeNode[]
  items?: AssetInput[]
  onSearchChange?: (query: string) => void
  searchResults?: AssetInput[] | null
  leadingTile?: React.ReactNode
  emptyState?: React.ReactNode
  /** Host-owned tabs after the tree roots, rendering their own content. */
  customCategories?: ItemsPanelCustomCategory[]
  /** Library / Community / Mine chips; off shows every source. */
  showSourceFilter?: boolean
  /** Illustration band between the room row and the catalogue. */
  renderHero?: (room: { slug: string; name: string }) => ReactNode
}) {
  const [activeRootSlug, setActiveRootSlug] = useState<string | null>(
    functionTree[0]?.slug ?? null,
  )
  const [activeCustomId, setActiveCustomId] = useState<string | null>(null)
  const [activeSource, setActiveSource] = useState<AssetInput['source'] | null>(
    showSourceFilter ? 'library' : null,
  )
  const [placement, setPlacement] = useState<Placement | null>(null)
  const activeCustom = customCategories.find((category) => category.id === activeCustomId)
  const [search, setSearch] = useState('')

  const isServerSearch = onSearchChange !== undefined
  const isSearchPending = isServerSearch && search.length > 0 && searchResults === null

  const activeRoot = functionTree.find((n) => n.slug === activeRootSlug) ?? functionTree[0]

  const matchesFilters = (item: AssetInput) => {
    if (placement && itemPlacement(item) !== placement) return false
    if (!activeSource) return true
    const itemSource = item.source ?? 'library'
    if (activeSource === 'mine') return itemSource === 'mine'
    if (activeSource === 'library') return itemSource === 'library'
    if (activeSource === 'community') {
      if (itemSource === 'community') return true
      if (itemSource === 'mine') return !item.isDraft
      return false
    }
    return true
  }

  const treeItems = useMemo(() => {
    const base = items ?? []
    if (!activeRoot) return base.filter(matchesFilters)
    const slugs = descendantSlugs(activeRoot)
    return base.filter(
      (item) => matchesFilters(item) && itemFunctionSlugs(item).some((s) => slugs.has(s)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, activeRoot, activeSource, placement])

  // One section per child of the room; items under the room but in no child
  // close the list as 기타.
  const sections = useMemo(() => {
    if (!activeRoot || activeRoot.children.length === 0) {
      return activeRoot && treeItems.length > 0
        ? [{ slug: activeRoot.slug, name: activeRoot.name, items: treeItems }]
        : []
    }
    const placed = new Set<AssetInput>()
    const out = activeRoot.children.map((child) => {
      const slugs = descendantSlugs(child)
      const childItems = treeItems.filter((item) =>
        itemFunctionSlugs(item).some((s) => slugs.has(s)),
      )
      for (const item of childItems) placed.add(item)
      return { slug: child.slug, name: child.name, items: childItems }
    })
    const rest = treeItems.filter((item) => !placed.has(item))
    if (rest.length > 0) out.push({ slug: `${activeRoot.slug}.__rest`, name: '기타', items: rest })
    return out.filter((section) => section.items.length > 0)
  }, [activeRoot, treeItems])

  // Without a server search the query filters the whole catalog locally, by
  // name, tags and the tree node names the item sits under.
  const nodeNames = useMemo(() => {
    const names = new Map<string, string>()
    const walk = (node: FunctionTreeNode, parent: string) => {
      const name = `${parent} ${node.name}`.trim()
      names.set(node.slug, name)
      for (const child of node.children) walk(child, name)
    }
    for (const root of functionTree) walk(root, '')
    return names
  }, [functionTree])
  const localSearchItems = useMemo(() => {
    if (isServerSearch || !search.trim()) return null
    const query = search.trim().toLowerCase()
    return (items ?? []).filter((item) => {
      if (!matchesFilters(item)) return false
      const haystack = [
        item.name,
        ...(item.tags ?? []),
        ...itemFunctionSlugs(item).map((slug) => nodeNames.get(slug) ?? ''),
      ]
      return haystack.some((text) => text.toLowerCase().includes(query))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServerSearch, search, items, nodeNames, activeSource, placement])

  const searchItems = useMemo(() => {
    if (!(isServerSearch && search && searchResults)) return null
    return searchResults.filter(matchesFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServerSearch, search, searchResults, activeSource, placement])

  function changeSearch(value: string) {
    if (value) setActiveCustomId(null)
    setSearch(value)
    onSearchChange?.(value)
  }

  function selectRow(id: string) {
    if (customCategories.some((category) => category.id === id)) {
      setActiveCustomId(id)
      return
    }
    setActiveCustomId(null)
    setActiveRootSlug(id)
    changeSearch('')
  }

  const rowItems = [
    ...functionTree.map((root) => ({
      id: root.slug,
      label: root.name,
      icon: <RootIcon node={root} />,
    })),
    ...customCategories.map((category) => ({
      id: category.id,
      label: category.label,
      icon: category.icon ?? (
        <NextImage
          alt=""
          className="size-5 object-contain"
          height={20}
          src={category.iconSrc ?? ''}
          width={20}
        />
      ),
    })),
  ]

  const sourceChips = showSourceFilter ? (
    <div className="flex rounded-full bg-white/60 p-0.5 dark:bg-white/10">
      {SOURCE_CHIPS.map((chip) => {
        const isActive = activeSource === chip.id
        return (
          <button
            className={cn(
              'rounded-full px-2 py-0.5 font-medium text-[10px] transition-colors',
              isActive
                ? 'bg-white text-[#5aa0e0] shadow-sm dark:bg-white/20 dark:text-sky-200'
                : 'text-[#555] hover:text-[#222] dark:text-neutral-300',
            )}
            key={chip.id}
            onClick={() => setActiveSource(isActive ? null : chip.id)}
            type="button"
          >
            {chip.label}
          </button>
        )
      })}
    </div>
  ) : undefined

  const placementFilter = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="배치 위치 필터"
          aria-pressed={placement !== null}
          className={cn(CATALOG_BAND_ACTION, placement && 'bg-[#8ec3f2] drop-shadow-none')}
          type="button"
        >
          <Funnel />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-40 rounded-xl border-0 bg-white p-1.5 text-neutral-800 shadow-[0_10px_36px_rgba(0,0,0,0.25)] dark:bg-neutral-900 dark:text-neutral-100"
        side="right"
        sideOffset={14}
      >
        <div className="px-2 pt-1 pb-1.5 font-semibold text-[11px] text-neutral-500">
          배치 위치
        </div>
        {[{ id: null, label: '전체' } as const, ...PLACEMENTS].map((option) => (
          <button
            className={cn(
              'flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
              placement === option.id
                ? 'bg-[#e3f1fc] font-semibold text-[#3d8fd6] dark:bg-sky-400/20 dark:text-sky-200'
                : 'hover:bg-neutral-100 dark:hover:bg-white/10',
            )}
            key={option.id ?? 'all'}
            onClick={() => setPlacement(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )

  const renderGrid = (list: AssetInput[] | undefined, withLeading: boolean) => (
    <ItemCatalog
      category={'furnish' as never}
      emptyState={emptyState}
      leadingTile={withLeading ? leadingTile : undefined}
      overrideItems={list}
    />
  )

  const placementLabel = PLACEMENTS.find((option) => option.id === placement)?.label
  const emptyLine = (text: string) => (emptyState ? null : <CatalogEmpty>{text}</CatalogEmpty>)
  const searchList = isServerSearch ? (searchItems ?? undefined) : (localSearchItems ?? [])

  return (
    <div className="flex h-full flex-col">
      <CatalogSearchBand
        actions={placementFilter}
        left={sourceChips}
        onChange={changeSearch}
        value={search}
      />

      <CatalogIconRow
        activeId={activeCustom ? activeCustom.id : search ? null : (activeRoot?.slug ?? null)}
        items={rowItems}
        onSelect={selectRow}
      />

      {renderHero &&
        !search &&
        (activeCustom
          ? renderHero({ slug: activeCustom.id, name: activeCustom.label })
          : activeRoot && renderHero({ slug: activeRoot.slug, name: activeRoot.name }))}

      {activeCustom ? (
        <div className={CATALOG_SCROLL}>{activeCustom.content}</div>
      ) : (
        <div className={cn(CATALOG_SCROLL, 'pb-3')}>
          {isSearchPending ? (
            <div className="flex h-full items-center justify-center">
              <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
            </div>
          ) : isServerSearch && search && searchResults?.length === 0 ? (
            (emptyState ?? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
                &ldquo;{search}&rdquo; 검색 결과가 없습니다
              </div>
            ))
          ) : search ? (
            <>
              <div className="px-2.5 pt-2">{renderGrid(searchList, true)}</div>
              {searchList?.length === 0 && emptyLine(`‘${search.trim()}’ 검색 결과가 없습니다`)}
            </>
          ) : sections.length === 0 ? (
            <>
              <div className="px-2.5 pt-2">{renderGrid([], true)}</div>
              {emptyLine(
                placementLabel
                  ? `${activeRoot?.name ?? '여기'}에는 ${placementLabel}에 놓는 사물이 없습니다`
                  : '아직 사물이 없습니다',
              )}
            </>
          ) : (
            <>
              {sections.map((section) => (
                <CatalogSection grid={false} key={section.slug} title={section.name}>
                  {renderGrid(section.items, false)}
                </CatalogSection>
              ))}
              {/* The host's tile (GLB import) closes the room instead of sitting
                  among its first kind's items. */}
              {leadingTile && <CatalogSection title="가져오기">{leadingTile}</CatalogSection>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
