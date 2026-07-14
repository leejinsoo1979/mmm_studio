// @ts-nocheck
export type PlacementType = 'floor' | 'wall' | 'ceiling' | 'hosted'; // hosted: 테이블 위

export interface IAssetMetadata {
  id: string;
  name: string;
  category: string;
  modelUrl: string;     // .glb (Draco compressed)
  thumbnailUrl: string;

  // Ghost Mesh 생성을 위한 물리적 치수
  dimensions: {
    width: number;  // x
    height: number; // y
    depth: number;  // z
  };

  placementType: PlacementType;
  snapDistance: number; // 벽 자석 효과 거리
}

// 씬에 배치된 인스턴스 데이터
export interface IFurnitureInstance {
  uid: string;       // Scene 내 고유 ID
  assetId: string;   // 원본 에셋 ID
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // Quaternion 권장
  scale: { x: number; y: number; z: number };
}
