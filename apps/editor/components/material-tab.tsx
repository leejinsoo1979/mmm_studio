'use client'

import { MaterialPaintPanel, useEditor } from '@pascal-app/editor'
import { Paintbrush } from 'lucide-react'
import { useEffect } from 'react'

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
    <div className="flex h-full flex-col bg-sidebar text-foreground">
      <div className="border-border border-b px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#7779ff]/15 text-[#8f91ff]">
            <Paintbrush className="h-5 w-5" />
          </span>
          <div>
            <p className="text-muted-foreground text-[10px] uppercase tracking-[0.16em]">
              Surface editor
            </p>
            <h1 className="font-bold text-3xl tracking-[-0.03em]">Material</h1>
          </div>
        </div>
        <p className="mt-3 text-muted-foreground text-xs leading-5">
          Choose a material, then paint a surface in the scene.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="rounded-xl border border-border bg-card p-3">
          <MaterialPaintPanel />
        </div>
      </div>
    </div>
  )
}
