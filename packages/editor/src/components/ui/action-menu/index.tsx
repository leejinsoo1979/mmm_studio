'use client'

import { useViewer } from '@pascal-app/viewer'
import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TooltipProvider } from './../../../components/ui/primitives/tooltip'
import { useIsMobile } from './../../../hooks/use-mobile'
import { useReducedMotion } from './../../../hooks/use-reduced-motion'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { useUiHidden } from './../../../store/use-ui-hidden'
import { useSidebarStore } from '../primitives/sidebar'
import { ControlModes } from './control-modes'
import { InzoiToolbar } from './inzoi-toolbar'
import { SecondaryToggles } from './view-toggles'

// Mobile bottom offset matches the viewer's overlap behind the sheet's
// rounded corners (SHEET_OVERLAP_PX in editor-layout-mobile) so the menu sits
// just above that strip instead of inside it.
const MOBILE_BOTTOM_OFFSET = 24

/** Gap kept between the bar and the build panel / the top-right cluster. */
const DESKTOP_GAP = 16
/** Narrow screens shrink the bar to fit between the two, down to this scale. */
const MIN_DESKTOP_SCALE = 0.6

type DesktopPlacement = { center: number; scale: number }

/**
 * inZOI centres the bar on the screen. It slides right just far enough to clear
 * the floating build panel, and shrinks rather than run under the day / night
 * slider when the room between the two runs out.
 */
function placeDesktopBar(bar: HTMLElement, width: number): DesktopPlacement {
  const viewport = window.innerWidth
  const inset =
    Number.parseFloat(getComputedStyle(bar).getPropertyValue('--viewer-left-inset')) || 0
  const right = document.querySelector('[data-toolbar-right]')?.getBoundingClientRect().left
  const lo = inset + DESKTOP_GAP
  const hi = (right ?? viewport) - DESKTOP_GAP
  const scale = Math.max(MIN_DESKTOP_SCALE, Math.min(1, (hi - lo) / width))
  const half = (width * scale) / 2
  const center = Math.max(lo + half, Math.min(viewport / 2, hi - half))
  return { center, scale }
}

export function ActionMenu({ className }: { className?: string }) {
  const isMobile = useIsMobile()
  const hasSelectionOnMobile = useViewer((s) => isMobile && s.selection.selectedIds.length > 0)
  const hasReferenceOnMobile = useEditor((s) => isMobile && Boolean(s.selectedReferenceId))
  const CONTEXTUAL_TABS = new Set(['ai', 'items', 'studio'])
  const isContextualPanelOnMobile = useEditor(
    (s) => isMobile && CONTEXTUAL_TABS.has(s.activeSidebarPanel),
  )
  const reducedMotion = useReducedMotion()
  const barRef = useRef<HTMLDivElement>(null)
  const [barWidth, setBarWidth] = useState<number | null>(null)
  const [placement, setPlacement] = useState<DesktopPlacement | null>(null)
  // The panel's width and visibility move the bar's left bound.
  const sidebarWidth = useSidebarStore((s) => s.width)
  const sidebarCollapsed = useSidebarStore((s) => s.isCollapsed)
  const panelAside = useUiHidden((s) => s.hidden || s.customizing)

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBarWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the panel state moves the left bound read from the layout's CSS
  useLayoutEffect(() => {
    const el = barRef.current
    if (isMobile || !el || !barWidth) return
    const place = () => setPlacement(placeDesktopBar(el, barWidth))
    place()
    const right = document.querySelector('[data-toolbar-right]')
    const observer = new ResizeObserver(place)
    if (right) observer.observe(right)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [isMobile, barWidth, sidebarWidth, sidebarCollapsed, panelAside])

  // The hint line under the scene lines up with the bar.
  useEffect(() => {
    if (!placement) return
    const root = document.documentElement
    root.style.setProperty('--hud-center-x', `${placement.center}px`)
    return () => {
      root.style.removeProperty('--hud-center-x')
    }
  }, [placement])

  // On mobile, defer the bottom rail to the selection bar when something
  // is selected — the contextual actions take priority over mode controls.
  // Also hide on Chat / Items / Studio tabs; those are contextual workflows
  // (composing / picking furniture / generating renders) where the build
  // menu is irrelevant.
  if (hasSelectionOnMobile || hasReferenceOnMobile || isContextualPanelOnMobile) return null

  const transition = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, bounce: 0.2, duration: 0.4 }

  return (
    <TooltipProvider>
      <motion.div
        className={cn(
          'z-50 -translate-x-1/2',
          // inZOI keeps the build tools in a bar at the top centre.
          isMobile ? 'absolute left-1/2 origin-bottom scale-90' : 'fixed top-3 origin-top',
          isMobile && 'rounded-2xl border border-border bg-background/90 shadow-2xl backdrop-blur-md',
          'transition-colors duration-200 ease-out',
          className,
        )}
        data-hud-avoid
        layout
        ref={barRef}
        style={
          isMobile
            ? { bottom: MOBILE_BOTTOM_OFFSET }
            : {
                left: placement ? placement.center : '50%',
                scale: placement && placement.scale < 1 ? placement.scale : undefined,
                visibility: placement ? undefined : 'hidden',
              }
        }
        transition={transition}
      >
        {isMobile ? (
          <div className="flex flex-col items-stretch gap-0.5 px-2 py-1.5">
            {/* Row 1: control modes only */}
            <div className="flex items-center justify-center gap-1">
              <ControlModes />
            </div>
            {/* Row 2: secondary toggles (orbit + top view hidden) */}
            <div className="flex items-center justify-center gap-1 border-border/50 border-t pt-1">
              <SecondaryToggles />
            </div>
          </div>
        ) : (
          <InzoiToolbar />
        )}
      </motion.div>
    </TooltipProvider>
  )
}
