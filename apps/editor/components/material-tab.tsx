'use client'

import { CATALOG_SCROLL, MaterialPaintPanel, useEditor } from '@pascal-app/editor'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

export function MaterialTab() {
  useEffect(() => {
    const editor = useEditor.getState()
    editor.setPhase('structure')
    editor.setStructureLayer('elements')
    editor.setTool(null)
    editor.setMode('material-paint')

    return () => {
      if (useEditor.getState().mode === 'material-paint') {
        useEditor.getState().setMode('select')
      }
    }
  }, [])

  return (
    <div className="flex h-full flex-col text-foreground">
      <div className={cn(CATALOG_SCROLL, 'px-2.5 pt-2.5 pb-3')}>
        <div className="rounded-[10px] bg-[var(--panel-card,#f3f3f3)] p-3 text-[var(--panel-card-fg,#333)]">
          <MaterialPaintPanel />
        </div>
      </div>
    </div>
  )
}
