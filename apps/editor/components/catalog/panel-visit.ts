import { useEditor, useSidebarStore, useUiHidden } from '@pascal-app/editor'
import { useEffect } from 'react'

/**
 * The floating panel unmounts its tab while it steps aside (the customize
 * card, UI hidden, capture mode, a collapsed panel) although the user has not
 * left the tab.
 */
function panelSteppedAside(): boolean {
  const { hidden, customizing } = useUiHidden.getState()
  return (
    hidden ||
    customizing ||
    useEditor.getState().isCaptureMode ||
    useSidebarStore.getState().isCollapsed
  )
}

type Visit = { tab: string; leave?: () => void; mounted: number }

let visit: Visit | null = null

/**
 * Runs `enter` when the user opens the tab and `leave` when they switch away,
 * but not when the panel only steps aside and comes back: re-entering would
 * re-arm the tab's tool and drop the selection the user was working on.
 */
export function useTabVisit(tab: string, enter: () => void, leave?: () => void) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: one visit per mount
  useEffect(() => {
    if (visit?.tab === tab) {
      visit.mounted += 1
    } else {
      // The previous tab was left while the panel was stepped aside.
      visit?.leave?.()
      visit = { tab, leave, mounted: 1 }
      enter()
    }
    const current = visit
    return () => {
      current.mounted -= 1
      if (panelSteppedAside()) return
      // Decided a tick later: a remount of the same tab (React's dev
      // double-mount) is not a visit ending.
      setTimeout(() => {
        if (visit !== current || current.mounted > 0 || panelSteppedAside()) return
        visit = null
        leave?.()
      }, 0)
    }
  }, [])
}
