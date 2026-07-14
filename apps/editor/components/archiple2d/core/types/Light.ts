// @ts-nocheck
export type LightType = 'point' | 'spot' | 'directional';

export interface Light {
  id: string;
  type: LightType;
  name: string;
  position: { x: number; y: number; z: number };
  intensity: number;
  color: { r: number; g: number; b: number };
  range?: number; // For point and spot lights
  angle?: number; // For spot lights (in degrees)
  direction?: { x: number; y: number; z: number }; // For directional and spot lights
  castShadows: boolean;
  enabled: boolean;
}

export const createDefaultLight = (type: LightType, position: { x: number; y: number; z: number }): Light => {
  const lightId = `light_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const defaults: Record<LightType, Partial<Light>> = {
    point: {
      name: 'Point Light',
      intensity: 1.0,
      color: { r: 255, g: 255, b: 255 },
      range: 10,
      castShadows: true,
    },
    spot: {
      name: 'Spot Light',
      intensity: 1.5,
      color: { r: 255, g: 255, b: 255 },
      range: 15,
      angle: 45,
      direction: { x: 0, y: -1, z: 0 },
      castShadows: true,
    },
    directional: {
      name: 'Directional Light',
      intensity: 1.0,
      color: { r: 255, g: 248, b: 220 },
      direction: { x: 0.5, y: -1, z: 0.5 },
      castShadows: true,
    },
  };

  return {
    id: lightId,
    type,
    position,
    enabled: true,
    ...defaults[type],
  } as Light;
};
