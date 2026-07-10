'use client'

import {
  generateSceneMaterialId,
  getMaterialPresetByRef,
  getSceneMaterialIdFromRef,
  type MaterialSchema,
  nodeRegistry,
  type SceneMaterialId,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { MaterialPropertiesEditor, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { SlidersHorizontal, X } from 'lucide-react'
import { createPortal } from 'react-dom'

function materialFromLibraryRef(ref: string): MaterialSchema | null {
  const preset = getMaterialPresetByRef(ref)
  if (!preset) return null
  const props = preset.mapProperties
  const maps = preset.maps

  return {
    preset: 'custom',
    properties: {
      color: props.color,
      roughness: props.roughness,
      metalness: props.metalness,
      emissiveColor: props.emissiveColor,
      emissiveIntensity: props.emissiveIntensity,
      opacity: props.opacity,
      transparent: props.transparent,
      side: props.side === 1 ? 'back' : props.side === 2 ? 'double' : 'front',
    },
    ...(maps.albedoMap
      ? {
          texture: {
            url: maps.albedoMap,
            normalUrl: maps.normalMap,
            roughnessUrl: maps.roughnessMap,
            metalnessUrl: maps.metalnessMap,
            emissiveUrl: maps.emissiveMap,
            displacementUrl: maps.displacementMap,
            aoUrl: maps.aoMap,
            repeat: [props.repeatX, props.repeatY] as [number, number],
            rotation: props.rotation,
            normalScale: (props.normalScaleX + props.normalScaleY) / 2,
            displacementScale: props.displacementScale,
            aoIntensity: props.aoMapIntensity,
          },
        }
      : {}),
  }
}

export function MaterialSurfaceInspector() {
  const target = useEditor((state) => state.selectedMaterialTarget)
  const activeMaterial = useEditor((state) => state.activePaintMaterial)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const sceneMaterials = useScene((state) => state.materials)
  const selectedNode = useScene((state) => (target ? state.nodes[target.nodeId] : undefined))

  if (!target || selectedIds.length !== 1 || selectedIds[0] !== target.nodeId || !selectedNode) {
    return null
  }

  const materialRef = activeMaterial?.materialPreset
  const sceneMaterialId = getSceneMaterialIdFromRef(materialRef) as SceneMaterialId | null
  const sceneMaterial = sceneMaterialId ? sceneMaterials[sceneMaterialId] : undefined
  const libraryMaterial = materialRef?.startsWith('library:')
    ? materialFromLibraryRef(materialRef)
    : null
  const editableMaterial = sceneMaterial?.material ?? activeMaterial?.material ?? libraryMaterial

  const assignMaterialRef = (nextRef: string) => {
    const paint = nodeRegistry.get(selectedNode.type)?.capabilities?.paint
    if (!paint) return
    const args = {
      node: selectedNode,
      role: target.role,
      material: undefined,
      materialPreset: nextRef,
    }
    if (paint.commit) paint.commit(args)
    else useScene.getState().updateNode(selectedNode.id, paint.buildPatch(args) as never)
  }

  const makeEditable = () => {
    if (!editableMaterial) return
    const id = generateSceneMaterialId()
    useScene.getState().addSceneMaterial({
      id,
      name: `${selectedNode.name ?? selectedNode.type} material`,
      material: structuredClone(editableMaterial),
    })
    const nextRef = toSceneMaterialRef(id)
    assignMaterialRef(nextRef)
    useEditor.getState().setActivePaintMaterial({
      materialPreset: nextRef,
      sourceTarget: activeMaterial?.sourceTarget ?? 'item',
    })
  }

  return createPortal(
    <aside className="fixed top-16 right-4 bottom-4 z-[70] flex w-[360px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#191919]/95 text-[#efefef] shadow-2xl backdrop-blur-xl">
      <header className="flex items-center justify-between border-white/10 border-b px-5 py-4">
        <div>
          <p className="text-[#858585] text-[10px] uppercase tracking-[0.16em]">Surface editor</p>
          <h2 className="mt-1 font-semibold text-lg">Material properties</h2>
        </div>
        <button
          aria-label="Close material properties"
          className="grid h-9 w-9 place-items-center rounded-lg text-[#aaa] transition hover:bg-white/10 hover:text-white"
          onClick={() => useEditor.getState().setSelectedMaterialTarget(null)}
          type="button"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="border-white/10 border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className="h-12 w-12 shrink-0 rounded-full border border-white/15 shadow-inner"
            style={{ backgroundColor: editableMaterial?.properties?.color ?? '#777777' }}
          />
          <div className="min-w-0">
            <p className="truncate font-medium">
              {sceneMaterial?.name ?? selectedNode.name ?? 'Material'}
            </p>
            <p className="mt-0.5 text-[#858585] text-xs">
              {selectedNode.type} · {target.role}
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {sceneMaterial && sceneMaterialId ? (
          <MaterialPropertiesEditor
            onChange={(material) =>
              useScene.getState().updateSceneMaterial(sceneMaterialId, { material })
            }
            value={sceneMaterial.material}
          />
        ) : editableMaterial ? (
          <div className="space-y-4">
            <p className="text-[#999] text-sm leading-6">
              라이브러리 재질을 편집 가능한 장면 재질로 복제하면 이 표면의 러프니스, 메탈릭,
              이미시브와 텍스처 매핑을 조절할 수 있습니다.
            </p>
            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#6f63ff] px-4 py-3 font-medium text-sm transition hover:bg-[#7c72ff]"
              onClick={makeEditable}
              type="button"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Make material editable
            </button>
          </div>
        ) : (
          <p className="text-[#888] text-sm">이 표면에 적용된 재질이 없습니다.</p>
        )}
      </div>
    </aside>,
    document.body,
  )
}
