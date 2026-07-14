// @ts-nocheck
/**
 * 3D Mesh types for Babylon.js integration
 */
export interface MeshData {
  id: string;
  type: MeshType;
  vertices: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  uvs: Float32Array;
  material?: MaterialData;
}

export const MeshType = {
  WALL: 'wall',
  FLOOR: 'floor',
  CEILING: 'ceiling',
  DOOR: 'door',
  WINDOW: 'window',
  FURNITURE: 'furniture',
} as const;

export type MeshType = typeof MeshType[keyof typeof MeshType];

export interface MaterialData {
  id: string;
  name: string;
  diffuseColor: [number, number, number];
  specularColor: [number, number, number];
  emissiveColor: [number, number, number];
  ambientColor: [number, number, number];
  roughness: number;
  metallic: number;
  textureUrl?: string;
  normalMapUrl?: string;
}

export interface Transform3D {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}
