'use client'

import type { MaterialCatalogItem } from '@pascal-app/core'
import { useState } from 'react'
import { MaterialSphere } from './material-sphere'

export type MaterialSection = { title: string; materials: MaterialCatalogItem[] }

/**
 * The finishes, one category at a time so the card stays compact: category
 * names in the column's title row, lit spheres in a 7-wide grid below (three
 * rows show, the fourth peeks to hint at scrolling).
 */
export function MaterialColumn({
  sections,
  partLabel,
  isSelected,
  onHover,
  onLeave,
  onApply,
  emptyText,
}: {
  sections: MaterialSection[]
  partLabel: string
  isSelected: (material: MaterialCatalogItem) => boolean
  onHover: (material: MaterialCatalogItem, el: HTMLElement) => void
  onLeave: () => void
  onApply: (material: MaterialCatalogItem) => void
  emptyText?: string
}) {
  const [tab, setTab] = useState<string | null>(null)
  const active = sections.find((s) => s.title === tab) ?? sections[0]

  return (
    <div className="flex w-[272px] shrink-0 flex-col px-3 pt-2.5 pb-2">
      <div className="no-scrollbar mb-1.5 flex h-[14px] items-center gap-2.5 overflow-x-auto">
        {sections.map((section) => (
          <button
            aria-pressed={section === active}
            className={`shrink-0 text-[11px] leading-[14px] transition-colors ${
              section === active
                ? 'font-semibold text-[#333] dark:text-neutral-100'
                : 'text-[#9a9a9a] hover:text-[#555] dark:text-neutral-500 dark:hover:text-neutral-300'
            }`}
            key={section.title}
            onClick={() => {
              onLeave()
              setTab(section.title)
            }}
            type="button"
          >
            {section.title}
          </button>
        ))}
      </div>
      {active ? (
        <div className="grid h-[104px] grid-cols-7 content-start gap-x-[7px] gap-y-2 overflow-y-auto p-1 [scrollbar-color:#c8c8c8_transparent] [scrollbar-width:thin]">
          {active.materials.map((material) => (
            <button
              aria-label={`${partLabel} ${material.label}`}
              className="grid place-items-center rounded-full transition-[filter] hover:brightness-105"
              key={material.id}
              onClick={() => onApply(material)}
              onMouseEnter={(e) => onHover(material, e.currentTarget)}
              onMouseLeave={onLeave}
              type="button"
            >
              <MaterialSphere material={material} selected={isSelected(material)} size={26} />
            </button>
          ))}
        </div>
      ) : (
        <span className="text-[10.5px] text-neutral-500">{emptyText}</span>
      )}
    </div>
  )
}
