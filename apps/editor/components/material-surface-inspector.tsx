'use client'

import {
  generateSceneMaterialId,
  getMaterialPresetByRef,
  getSceneMaterialIdFromRef,
  type MaterialProperties,
  type MaterialSchema,
  nodeRegistry,
  type SceneMaterialId,
  sceneRegistry,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Material, Mesh, Texture, Vector2 } from 'three'

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

type RenderedMaterial = Material & {
  aoMap?: Texture | null
  aoMapIntensity?: number
  displacementMap?: Texture | null
  displacementScale?: number
  color?: { getHexString: () => string }
  emissive?: { getHexString: () => string }
  emissiveMap?: Texture | null
  emissiveIntensity?: number
  map?: Texture | null
  metalness?: number
  metalnessMap?: Texture | null
  normalMap?: Texture | null
  normalScale?: Vector2
  opacity?: number
  roughness?: number
  roughnessMap?: Texture | null
  side?: number
  transparent?: boolean
}

function renderedTextureUrl(texture: Texture | null | undefined): string | undefined {
  if (!texture) return undefined
  const source = texture.source?.data as
    | { currentSrc?: unknown; src?: unknown }
    | string
    | undefined
  if (typeof source === 'string' && source) return source
  if (source && typeof source === 'object') {
    if (typeof source.currentSrc === 'string' && source.currentSrc) return source.currentSrc
    if (typeof source.src === 'string' && source.src) return source.src
  }
  const cacheKey = texture.userData.pascalTextureCacheKey
  if (typeof cacheKey !== 'string') return undefined
  const match = cacheKey.match(
    /^(.*)-[-\d.]+-[-\d.]+-[-\d.]+-(?:Repeat|ClampToEdge|MirroredRepeat)-(?:Repeat|ClampToEdge|MirroredRepeat)-(?:true|false)-(?:map|normalMap|roughnessMap|metalnessMap|displacementMap|aoMap|bumpMap|alphaMap|lightMap|emissiveMap)$/,
  )
  return match?.[1]
}

const MATERIAL_TABS = ['일반', '색상', '맵', '범프', '반사', '거칠기', '고급'] as const

function InspectorSlider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  const progress = ((value - min) / (max - min)) * 100
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_64px] items-center gap-3 py-2.5">
      <span className="text-[#b5b5b5] text-xs">{label}</span>
      <input
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[#7567ff] [&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-[#7567ff] [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        style={{
          background: `linear-gradient(to right, #7567ff 0%, #7567ff ${progress}%, #393939 ${progress}%, #393939 100%)`,
        }}
        type="range"
        value={value}
      />
      <input
        className="h-8 w-full rounded-md border border-white/5 bg-[#242424] px-2 text-right text-[#aaa] text-xs outline-none focus:border-[#7567ff]/60"
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
        }}
        step={step}
        type="number"
        value={Number(value.toFixed(step < 0.01 ? 3 : 2))}
      />
    </div>
  )
}

function InspectorMaterialEditor({
  value,
  onChange,
  activeTab,
}: {
  value: MaterialSchema
  onChange: (value: MaterialSchema) => void
  activeTab: (typeof MATERIAL_TABS)[number]
}) {
  const initialValue = useRef(structuredClone(value))
  const properties: MaterialProperties = value.properties ?? {
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  }
  const update = (patch: Partial<MaterialProperties>) =>
    onChange({ ...value, preset: 'custom', properties: { ...properties, ...patch } })
  const updateTexture = (patch: Partial<NonNullable<MaterialSchema['texture']>>) => {
    if (!value.texture) return
    onChange({ ...value, preset: 'custom', texture: { ...value.texture, ...patch } })
  }

  const colorControl = (label: string, field: 'color' | 'emissiveColor', fallback: string) => {
    const color = properties[field] ?? fallback
    return (
      <div className="mb-3 flex items-center justify-between border-white/8 border-b pb-3">
        <span className="text-[#b5b5b5] text-xs">{label}</span>
        <div className="flex items-center gap-2">
          <input
            className="h-8 w-8 cursor-pointer rounded-md border border-white/10 bg-transparent p-0"
            onChange={(event) => update({ [field]: event.target.value })}
            type="color"
            value={color}
          />
          <input
            className="h-8 w-24 rounded-md border border-white/5 bg-[#242424] px-2 text-[#aaa] text-xs uppercase outline-none"
            onChange={(event) => update({ [field]: event.target.value })}
            value={color}
          />
        </div>
      </div>
    )
  }

  const mapField = (
    label: string,
    field: 'url' | 'normalUrl' | 'roughnessUrl' | 'metalnessUrl' | 'emissiveUrl' | 'aoUrl',
  ) => (
    <label className="mb-3 block text-[#b5b5b5] text-xs">
      <span className="mb-1.5 block">{label}</span>
      <input
        className="h-9 w-full rounded-md border border-white/5 bg-[#242424] px-3 text-[#aaa] text-xs outline-none focus:border-[#7567ff]/60"
        disabled={!value.texture}
        onChange={(event) => updateTexture({ [field]: event.target.value || undefined })}
        placeholder={value.texture ? 'Texture URL' : 'Base Color 맵을 먼저 적용하세요'}
        value={value.texture?.[field] ?? ''}
      />
    </label>
  )

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        {(activeTab === '일반' || activeTab === '맵') && value.texture?.url ? (
          <div className="mb-3 flex items-center justify-between border-white/8 border-b pb-3">
            <span className="text-[#b5b5b5] text-xs">Base Color</span>
            <div className="flex min-w-0 items-center gap-2 rounded-md bg-[#242424] p-1.5 pr-3">
              <span
                className="h-8 w-10 shrink-0 rounded bg-cover bg-center"
                style={{ backgroundImage: `url("${value.texture.url}")` }}
              />
              <span className="max-w-36 truncate text-[#999] text-[11px]">
                {value.texture.url.split('/').pop()}
              </span>
            </div>
          </div>
        ) : null}
        {activeTab === '일반' ? (
          <>
            {colorControl('Tint', 'color', '#ffffff')}
            <InspectorSlider
              label="러프니스"
              onChange={(roughness) => update({ roughness })}
              value={properties.roughness}
            />
            <InspectorSlider
              label="메탈릭"
              onChange={(metalness) => update({ metalness })}
              value={properties.metalness}
            />
          </>
        ) : null}
        {activeTab === '색상' ? (
          <>
            {colorControl('기본 색상', 'color', '#ffffff')}
            {colorControl('이미시브 색상', 'emissiveColor', '#000000')}
            <InspectorSlider
              label="이미시브 강도"
              max={20}
              onChange={(emissiveIntensity) => update({ emissiveIntensity })}
              step={0.05}
              value={properties.emissiveIntensity ?? 0}
            />
          </>
        ) : null}
        {activeTab === '맵' ? (
          <>
            {mapField('Base Color', 'url')}
            {mapField('Normal', 'normalUrl')}
            {mapField('Roughness', 'roughnessUrl')}
            {mapField('Metallic', 'metalnessUrl')}
            {mapField('Emissive', 'emissiveUrl')}
            {mapField('AO', 'aoUrl')}
          </>
        ) : null}
        {activeTab === '범프' ? (
          <>
            <InspectorSlider
              label="노멀 강도"
              max={5}
              onChange={(normalScale) => updateTexture({ normalScale })}
              value={value.texture?.normalScale ?? 1}
            />
            <InspectorSlider
              label="변위 강도"
              max={2}
              onChange={(displacementScale) => updateTexture({ displacementScale })}
              value={value.texture?.displacementScale ?? 0}
            />
          </>
        ) : null}
        {activeTab === '반사' ? (
          <>
            <InspectorSlider
              label="메탈릭"
              onChange={(metalness) => update({ metalness })}
              value={properties.metalness}
            />
            <InspectorSlider
              label="클리어코트"
              onChange={(clearcoat) => update({ clearcoat })}
              value={properties.clearcoat ?? 0}
            />
            <InspectorSlider
              label="투과"
              onChange={(transmission) =>
                update({ transmission, transparent: transmission > 0 || properties.transparent })
              }
              value={properties.transmission ?? 0}
            />
            <InspectorSlider
              label="굴절률"
              max={2.333}
              min={1}
              onChange={(ior) => update({ ior })}
              value={properties.ior ?? 1.5}
            />
          </>
        ) : null}
        {activeTab === '거칠기' ? (
          <>
            <InspectorSlider
              label="러프니스"
              onChange={(roughness) => update({ roughness })}
              value={properties.roughness}
            />
            <InspectorSlider
              label="코트 거칠기"
              onChange={(clearcoatRoughness) => update({ clearcoatRoughness })}
              value={properties.clearcoatRoughness ?? 0}
            />
          </>
        ) : null}
        {activeTab === '고급' ? (
          <>
            <InspectorSlider
              label="불투명도"
              onChange={(opacity) =>
                update({ opacity, transparent: opacity < 1 || properties.transparent })
              }
              value={properties.opacity}
            />
            <InspectorSlider
              label="AO 강도"
              max={5}
              onChange={(aoIntensity) => updateTexture({ aoIntensity })}
              value={value.texture?.aoIntensity ?? 1}
            />
            {value.texture ? (
              <>
                <InspectorSlider
                  label="타일링 X"
                  max={20}
                  min={0.05}
                  onChange={(x) =>
                    onChange({
                      ...value,
                      texture: { ...value.texture!, repeat: [x, value.texture?.repeat?.[1] ?? x] },
                    })
                  }
                  step={0.05}
                  value={value.texture.repeat?.[0] ?? value.texture.scale ?? 1}
                />
                <InspectorSlider
                  label="타일링 Y"
                  max={20}
                  min={0.05}
                  onChange={(y) =>
                    onChange({
                      ...value,
                      texture: { ...value.texture!, repeat: [value.texture?.repeat?.[0] ?? y, y] },
                    })
                  }
                  step={0.05}
                  value={value.texture.repeat?.[1] ?? value.texture.scale ?? 1}
                />
                <InspectorSlider
                  label="회전"
                  max={6.283}
                  onChange={(rotation) => updateTexture({ rotation })}
                  step={0.01}
                  value={value.texture.rotation ?? 0}
                />
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <button
        className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-white/10 text-[#bbb] text-sm transition hover:bg-white/5 hover:text-white"
        onClick={() => onChange(structuredClone(initialValue.current))}
        type="button"
      >
        <RotateCcw className="h-4 w-4" />
        재질 속성 초기화
      </button>
    </div>
  )
}

function materialFromRenderedSurface(nodeId: string, role: string): MaterialSchema | null {
  const root = sceneRegistry.nodes.get(nodeId)
  if (!root) return null

  let fallback: RenderedMaterial | null = null
  let matched: RenderedMaterial | null = null
  root.traverse((object) => {
    if (matched) return
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const slotId = (mesh.userData as { slotId?: string | (string | null)[] }).slotId
    fallback ??= (materials[0] as RenderedMaterial | undefined) ?? null

    if (Array.isArray(slotId)) {
      const index = slotId.indexOf(role)
      if (index >= 0 && materials[index]) matched = materials[index] as RenderedMaterial
    } else if (slotId === role && materials[0]) {
      matched = materials[0] as RenderedMaterial
    }
  })

  const material = (matched as RenderedMaterial | null) ?? fallback
  if (!material) return null
  const albedoUrl = renderedTextureUrl(material.map)
  const normalUrl = renderedTextureUrl(material.normalMap)
  const roughnessUrl = renderedTextureUrl(material.roughnessMap)
  const metalnessUrl = renderedTextureUrl(material.metalnessMap)
  const emissiveUrl = renderedTextureUrl(material.emissiveMap)
  const displacementUrl = renderedTextureUrl(material.displacementMap)
  const aoUrl = renderedTextureUrl(material.aoMap)
  return {
    preset: 'custom',
    properties: {
      color: material.color ? `#${material.color.getHexString()}` : '#ffffff',
      roughness: material.roughness ?? 0.5,
      metalness: material.metalness ?? 0,
      emissiveColor: material.emissive ? `#${material.emissive.getHexString()}` : '#000000',
      emissiveIntensity: material.emissiveIntensity ?? 0,
      opacity: material.opacity ?? 1,
      transparent: material.transparent ?? false,
      side: material.side === 1 ? 'back' : material.side === 2 ? 'double' : 'front',
    },
    ...(albedoUrl
      ? {
          texture: {
            url: albedoUrl,
            normalUrl,
            roughnessUrl,
            metalnessUrl,
            emissiveUrl,
            displacementUrl,
            aoUrl,
            repeat: [material.map?.repeat.x ?? 1, material.map?.repeat.y ?? 1] as [number, number],
            rotation: material.map?.rotation ?? 0,
            normalScale: material.normalScale
              ? (material.normalScale.x + material.normalScale.y) / 2
              : 1,
            displacementScale: material.displacementScale ?? 0,
            aoIntensity: material.aoMapIntensity ?? 1,
          },
        }
      : {}),
  }
}

export function MaterialSurfaceInspector() {
  const [activeTab, setActiveTab] = useState<(typeof MATERIAL_TABS)[number]>('일반')
  const target = useEditor((state) => state.selectedMaterialTarget)
  const nodes = useScene((state) => state.nodes)
  const sceneMaterials = useScene((state) => state.materials)
  const selectedNode = useScene((state) => (target ? state.nodes[target.nodeId] : undefined))

  useEffect(() => {
    if (!target) return
    const viewer = useViewer.getState()
    viewer.setPreviewSelectedIds([])
    viewer.setHoveredId(null)
    viewer.setHoverHighlightMode('default')
    viewer.outliner.selectedObjects.length = 0
    viewer.outliner.hoveredObjects.length = 0
  }, [target])

  if (typeof document === 'undefined' || !target || !selectedNode) {
    return null
  }

  const slotRef = (selectedNode as { slots?: Record<string, string | undefined> }).slots?.[
    target.role
  ]
  const paintCapability = nodeRegistry.get(selectedNode.type)?.capabilities?.paint
  const effectiveSurface = paintCapability?.getEffectiveMaterial?.({
    node: selectedNode,
    role: target.role,
    nodes,
  })
  const materialRef = slotRef ?? effectiveSurface?.materialPreset
  const sceneMaterialId = getSceneMaterialIdFromRef(materialRef) as SceneMaterialId | null
  const sceneMaterial = sceneMaterialId ? sceneMaterials[sceneMaterialId] : undefined
  const libraryMaterial = materialRef?.startsWith('library:')
    ? materialFromLibraryRef(materialRef)
    : null
  const renderedMaterial = materialFromRenderedSurface(target.nodeId, target.role)
  const editableMaterial =
    sceneMaterial?.material ?? effectiveSurface?.material ?? libraryMaterial ?? renderedMaterial

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

  const updateMaterial = (material: MaterialSchema) => {
    if (sceneMaterial && sceneMaterialId) {
      useScene.getState().updateSceneMaterial(sceneMaterialId, { material })
      return
    }
    const id = generateSceneMaterialId()
    useScene.getState().addSceneMaterial({
      id,
      name: `${selectedNode.name ?? selectedNode.type} material`,
      material,
    })
    const nextRef = toSceneMaterialRef(id)
    assignMaterialRef(nextRef)
    useEditor.getState().setActivePaintMaterial({
      materialPreset: nextRef,
      sourceTarget: useEditor.getState().activePaintTarget,
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
            className="h-12 w-12 shrink-0 rounded-full border border-white/15 bg-cover bg-center shadow-inner"
            style={{
              backgroundColor: editableMaterial?.properties?.color ?? '#777777',
              backgroundImage: editableMaterial?.texture?.url
                ? `url("${editableMaterial.texture.url}")`
                : undefined,
            }}
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

      <nav
        className="flex shrink-0 overflow-x-auto border-white/10 border-b px-4"
        aria-label="Material properties"
      >
        {MATERIAL_TABS.map((tab) => (
          <button
            className={`relative h-11 shrink-0 px-2.5 text-xs transition ${activeTab === tab ? 'text-[#8175ff]' : 'text-[#888] hover:text-[#bbb]'}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab}
            {activeTab === tab ? (
              <span className="absolute right-2 bottom-0 left-2 h-0.5 bg-[#7567ff]" />
            ) : null}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {editableMaterial ? (
          <InspectorMaterialEditor
            activeTab={activeTab}
            key={`${target.nodeId}:${target.role}`}
            onChange={updateMaterial}
            value={editableMaterial}
          />
        ) : (
          <p className="text-[#888] text-sm">이 표면에 적용된 재질이 없습니다.</p>
        )}
      </div>
    </aside>,
    document.body,
  )
}
