'use client'

import { nodeRegistry, useScene } from '@pascal-app/core'
import { Camera } from 'lucide-react'

export function RuntimeConfigurator() {
  const groups = useScene((state) => state.experience.configurators)
  const cameras = useScene((state) => state.experience.cameras)

  const applyOption = (groupIndex: number, materialRef: string | undefined) => {
    if (!materialRef) return
    const group = useScene.getState().experience.configurators[groupIndex]
    if (!group) return
    const node =
      useScene.getState().nodes[
        group.target.nodeId as keyof ReturnType<typeof useScene.getState>['nodes']
      ]
    if (!node) return
    const paint = nodeRegistry.get(node.type)?.capabilities?.paint
    if (!paint) return
    const args = {
      node,
      role: group.target.role,
      material: undefined,
      materialPreset: materialRef,
    }
    if (paint.commit) paint.commit(args as never)
    else useScene.getState().updateNode(node.id, paint.buildPatch(args as never) as never)
  }

  if (groups.length === 0 && cameras.length === 0) return null

  return (
    <aside className="fixed top-6 right-6 z-50 w-72 overflow-hidden rounded-2xl border border-white/12 bg-[#171717]/92 text-white shadow-2xl backdrop-blur-xl">
      <header className="border-white/10 border-b px-5 py-4">
        <p className="text-white/45 text-[10px] uppercase tracking-[0.18em]">Configurator</p>
        <h2 className="mt-1 font-semibold text-lg">Customize this space</h2>
      </header>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
        {cameras.length > 0 && (
          <section>
            <h3 className="mb-2 font-medium text-sm">Views</h3>
            <div className="grid grid-cols-2 gap-2">
              {cameras.map((preset) => (
                <button
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-xs transition hover:border-[#8175ff] hover:bg-white/10"
                  key={preset.id}
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent('mmm-camera-apply', { detail: preset }))
                  }
                  type="button"
                >
                  <Camera className="h-4 w-4 shrink-0 text-white/55" />
                  <span className="truncate">{preset.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {groups.map((group, groupIndex) => (
          <section key={group.id}>
            <h3 className="mb-2 font-medium text-sm">{group.label}</h3>
            <div className="grid grid-cols-2 gap-2">
              {group.options.map((option) => (
                <button
                  className="overflow-hidden rounded-xl border border-white/10 bg-white/5 text-left transition hover:border-[#8175ff] hover:bg-white/10"
                  key={option.id}
                  onClick={() => applyOption(groupIndex, option.materialRef)}
                  type="button"
                >
                  {option.thumbnailUrl ? (
                    <span
                      className="block h-16 bg-cover bg-center"
                      style={{ backgroundImage: `url("${option.thumbnailUrl}")` }}
                    />
                  ) : null}
                  <span className="block truncate px-3 py-2 text-xs">{option.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}
