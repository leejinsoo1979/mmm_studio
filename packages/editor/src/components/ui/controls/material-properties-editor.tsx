'use client'

import type { MaterialProperties, MaterialSchema } from '@pascal-app/core'
import { Input } from '../primitives/input'
import { SliderControl } from './slider-control'

const DEFAULT_MATERIAL_PROPERTIES: MaterialProperties = {
  color: '#ffffff',
  roughness: 0.5,
  metalness: 0,
  opacity: 1,
  transparent: false,
  side: 'front',
}

export function MaterialPropertiesEditor({
  value,
  onChange,
}: {
  value: MaterialSchema
  onChange: (next: MaterialSchema) => void
}) {
  const currentProps = value.properties ?? DEFAULT_MATERIAL_PROPERTIES

  const updateMaterial = (
    updates: Partial<MaterialProperties>,
    nextTransparent = currentProps.transparent,
  ) => {
    onChange({
      ...value,
      preset: value.preset ?? 'custom',
      properties: {
        ...currentProps,
        ...updates,
        transparent: nextTransparent,
      },
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          Color
        </label>
        <div className="flex items-center gap-2">
          <input
            className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0 [&::-moz-color-swatch]:rounded-[5px] [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
            onChange={(e) => updateMaterial({ color: e.target.value })}
            type="color"
            value={currentProps.color}
          />
          <Input
            onChange={(e) => updateMaterial({ color: e.target.value })}
            value={currentProps.color}
          />
        </div>
      </div>

      <SliderControl
        label="Roughness"
        max={1}
        min={0}
        onChange={(value) => updateMaterial({ roughness: value })}
        precision={2}
        step={0.01}
        value={currentProps.roughness}
      />

      <SliderControl
        label="Metalness"
        max={1}
        min={0}
        onChange={(value) => updateMaterial({ metalness: value })}
        precision={2}
        step={0.01}
        value={currentProps.metalness}
      />

      <div className="space-y-2 rounded-md border border-border/60 p-2.5">
        <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          Emission
        </label>
        <div className="flex items-center gap-2">
          <input
            className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0"
            onChange={(e) => updateMaterial({ emissiveColor: e.target.value })}
            type="color"
            value={currentProps.emissiveColor ?? '#000000'}
          />
          <Input
            onChange={(e) => updateMaterial({ emissiveColor: e.target.value })}
            value={currentProps.emissiveColor ?? '#000000'}
          />
        </div>
        <SliderControl
          label="Intensity"
          max={20}
          min={0}
          onChange={(value) => updateMaterial({ emissiveIntensity: value })}
          precision={2}
          step={0.05}
          value={currentProps.emissiveIntensity ?? 0}
        />
      </div>

      <div className="space-y-3 rounded-md border border-border/60 p-2.5">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          Physical
        </p>
        <SliderControl label="Clearcoat" max={1} min={0} onChange={(value) => updateMaterial({ clearcoat: value })} precision={2} step={0.01} value={currentProps.clearcoat ?? 0} />
        <SliderControl label="Coat roughness" max={1} min={0} onChange={(value) => updateMaterial({ clearcoatRoughness: value })} precision={2} step={0.01} value={currentProps.clearcoatRoughness ?? 0} />
        <SliderControl label="Transmission" max={1} min={0} onChange={(value) => updateMaterial({ transmission: value }, value > 0 || currentProps.transparent)} precision={2} step={0.01} value={currentProps.transmission ?? 0} />
        <SliderControl label="IOR" max={2.333} min={1} onChange={(value) => updateMaterial({ ior: value })} precision={3} step={0.01} value={currentProps.ior ?? 1.5} />
      </div>

      <SliderControl
        label="Opacity"
        max={1}
        min={0}
        onChange={(value) => updateMaterial({ opacity: value }, value < 1 || currentProps.transparent)}
        precision={2}
        step={0.01}
        value={currentProps.opacity}
      />

      <div className="space-y-2">
        <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          Side
        </label>
        <select
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          onChange={(e) =>
            updateMaterial({ side: e.target.value as 'front' | 'back' | 'double' })
          }
          value={currentProps.side}
        >
          <option value="front">Front</option>
          <option value="back">Back</option>
          <option value="double">Double</option>
        </select>
      </div>

      {value.texture ? (
        <div className="space-y-3 rounded-md border border-border/60 p-2.5">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
            Texture mapping
          </p>
          <SliderControl
            label="Scale X"
            max={20}
            min={0.05}
            onChange={(next) => onChange({ ...value, texture: { ...value.texture!, repeat: [next, value.texture?.repeat?.[1] ?? next] } })}
            precision={2}
            step={0.05}
            value={value.texture.repeat?.[0] ?? value.texture.scale ?? 1}
          />
          <SliderControl
            label="Scale Y"
            max={20}
            min={0.05}
            onChange={(next) => onChange({ ...value, texture: { ...value.texture!, repeat: [value.texture?.repeat?.[0] ?? next, next] } })}
            precision={2}
            step={0.05}
            value={value.texture.repeat?.[1] ?? value.texture.scale ?? 1}
          />
          <SliderControl label="Rotation" max={180} min={-180} onChange={(next) => onChange({ ...value, texture: { ...value.texture!, rotation: (next * Math.PI) / 180 } })} precision={0} step={1} unit="°" value={((value.texture.rotation ?? 0) * 180) / Math.PI} />
          <SliderControl label="Normal" max={4} min={0} onChange={(next) => onChange({ ...value, texture: { ...value.texture!, normalScale: next } })} precision={2} step={0.05} value={value.texture.normalScale ?? 1} />
          <SliderControl label="Displacement" max={0.5} min={-0.5} onChange={(next) => onChange({ ...value, texture: { ...value.texture!, displacementScale: next } })} precision={3} step={0.005} unit="m" value={value.texture.displacementScale ?? 0} />
          <SliderControl label="AO" max={4} min={0} onChange={(next) => onChange({ ...value, texture: { ...value.texture!, aoIntensity: next } })} precision={2} step={0.05} value={value.texture.aoIntensity ?? 1} />
        </div>
      ) : null}
    </div>
  )
}
