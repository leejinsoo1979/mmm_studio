import {
  getMaterialPresetByRef,
  getSceneMaterialIdFromRef,
  type MaterialSchema,
  type SceneMaterialId,
  useScene,
} from '@pascal-app/core'

export function customColorMaterial(hex: string, roughness = 0.5): MaterialSchema {
  return {
    preset: 'custom',
    properties: {
      color: hex,
      roughness,
      metalness: 0,
      opacity: 1,
      transparent: false,
      side: 'front',
    },
  }
}

/** A catalog finish as an editable schema, so its gloss / pattern can be tuned. */
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

/** The schema behind a slot value: a `scene:` / `library:` ref or a `#hex`. */
export function resolveSchema(ref: string | undefined): MaterialSchema | null {
  if (!ref) return null
  if (ref.startsWith('#')) return customColorMaterial(ref)
  const sceneId = getSceneMaterialIdFromRef(ref)
  if (sceneId) return useScene.getState().materials[sceneId as SceneMaterialId]?.material ?? null
  return materialFromLibraryRef(ref)
}

export function withColor(base: MaterialSchema | null, hex: string): MaterialSchema {
  if (!base) return customColorMaterial(hex)
  // A picked colour replaces the finish's texture, like inZOI's paint.
  const { texture: _texture, ...rest } = base
  return {
    ...rest,
    preset: 'custom',
    properties: { ...customColorMaterial(hex).properties!, ...base.properties, color: hex },
  }
}
