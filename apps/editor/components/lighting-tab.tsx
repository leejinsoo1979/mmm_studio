'use client'

import { triggerSFX, useEditor } from '@pascal-app/editor'
import { Circle, Flashlight, RectangleHorizontal } from 'lucide-react'

const LIGHTS = [
  { kind: 'point', label: 'Point Light', detail: 'Omnidirectional bulb', icon: Circle },
  { kind: 'spot', label: 'Spot Light', detail: 'Focused cone light', icon: Flashlight },
  {
    kind: 'area',
    label: 'Area Light',
    detail: 'Soft rectangular light',
    icon: RectangleHorizontal,
  },
] as const

export function LightingTab() {
  const activeTool = useEditor((state) => state.tool)
  const activeKind = useEditor((state) =>
    state.tool === 'light'
      ? ((state.toolDefaults.light as { kind?: string } | undefined)?.kind ?? null)
      : null,
  )

  const activate = (kind: (typeof LIGHTS)[number]['kind']) => {
    const editor = useEditor.getState()
    editor.setPhase('furnish')
    editor.setCatalogCategory(null)
    editor.setToolDefaults('light', { kind, height: kind === 'area' ? 2.2 : 2.4 })
    editor.setMode('build')
    editor.setTool('light')
    triggerSFX('sfx:menu-click')
  }

  return (
    <div className="flex h-full flex-col bg-[#1b1b1b] text-[#efefef]">
      <div className="border-[#343434] border-b px-6 py-6">
        <p className="text-[#8a8a8a] text-[10px] uppercase tracking-[0.16em]">Real-time</p>
        <h1 className="mt-1 font-bold text-3xl tracking-[-0.03em]">Lighting</h1>
        <p className="mt-2 text-[#9b9b9b] text-xs leading-5">
          Choose a light, then click the floor to place it.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4">
        {LIGHTS.map((light) => {
          const Icon = light.icon
          const selected = activeTool === 'light' && activeKind === light.kind
          return (
            <button
              className={`group rounded-xl border p-4 text-left transition ${selected ? 'border-[#7779ff] bg-[#7779ff]/12' : 'border-[#383838] bg-[#222] hover:border-[#555] hover:bg-[#282828]'}`}
              key={light.kind}
              onClick={() => activate(light.kind)}
              type="button"
            >
              <span
                className={`grid h-10 w-10 place-items-center rounded-lg ${selected ? 'bg-[#7779ff] text-white' : 'bg-[#303030] text-[#d4d4d4]'}`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="mt-3 block font-semibold text-sm">{light.label}</span>
              <span className="mt-1 block text-[#858585] text-[11px]">{light.detail}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-auto border-[#343434] border-t p-4 text-[#777] text-[11px] leading-5">
        Select a placed light to edit intensity, color, range, cone, size, and shadows.
      </div>
    </div>
  )
}
