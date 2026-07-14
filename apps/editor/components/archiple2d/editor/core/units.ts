// @ts-nocheck
/**
 * 좌표/단위/스냅/표기 시스템
 *
 * 핵심 원칙:
 * 1. 내부 로직은 항상 mm 단위
 * 2. 화면 렌더링 시에만 mm → px 변환
 * 3. 스냅은 옵션, mm 좌표에만 적용
 * 4. px 기반 상태 저장 금지
 */

// ============================================
// 타입 정의
// ============================================

/**
 * mm 단위 좌표 (world space)
 * 내부 로직에서 사용하는 절대 좌표
 */
export interface PointMM {
  x: number; // mm
  y: number; // mm
}

/**
 * px 단위 좌표 (screen space)
 * Canvas 렌더링에만 사용
 */
export interface PointPX {
  x: number; // px
  y: number; // px
}

/**
 * 뷰포트 상태
 * Zoom과 Pan을 제어
 */
export interface ViewportState {
  scalePxPerMm: number; // px per 1mm (예: 0.1 = 1mm당 0.1px)
  offsetX: number; // 화면 이동 X (px)
  offsetY: number; // 화면 이동 Y (px)
  canvasWidth: number; // Canvas 너비 (px)
  canvasHeight: number; // Canvas 높이 (px)
}

/**
 * 스냅 설정
 */
export interface SnapConfig {
  enabled: boolean;
  stepMm: number; // 스냅 간격 (mm) - 예: 10, 50, 100
}

// ============================================
// 좌표 변환 함수
// ============================================

/**
 * World(mm) → Screen(px) 변환
 *
 * @param p - mm 단위 좌표
 * @param viewport - 뷰포트 상태
 * @returns px 단위 화면 좌표
 */
export function worldToScreen(p: PointMM, viewport: ViewportState): PointPX {
  const { scalePxPerMm, offsetX, offsetY, canvasWidth, canvasHeight } = viewport;

  // 1. mm → px 변환
  const pxX = p.x * scalePxPerMm;
  const pxY = p.y * scalePxPerMm;

  // 2. 화면 중앙 기준으로 offset 적용
  const screenX = pxX + offsetX + canvasWidth / 2;
  const screenY = pxY + offsetY + canvasHeight / 2;

  return { x: screenX, y: screenY };
}

/**
 * Screen(px) → World(mm) 변환
 *
 * @param p - px 단위 화면 좌표
 * @param viewport - 뷰포트 상태
 * @returns mm 단위 world 좌표
 */
export function screenToWorld(p: PointPX, viewport: ViewportState): PointMM {
  const { scalePxPerMm, offsetX, offsetY, canvasWidth, canvasHeight } = viewport;

  // 1. 화면 중앙 기준으로 역변환
  const pxX = p.x - offsetX - canvasWidth / 2;
  const pxY = p.y - offsetY - canvasHeight / 2;

  // 2. px → mm 변환
  const worldX = pxX / scalePxPerMm;
  const worldY = pxY / scalePxPerMm;

  return { x: worldX, y: worldY };
}

// ============================================
// 스냅 함수
// ============================================

/**
 * mm 좌표에 스냅 적용
 * 명시적으로만 호출해야 함
 *
 * @param valueMm - mm 단위 값
 * @param snapStepMm - 스냅 간격 (mm)
 * @returns 스냅된 mm 값
 */
export function applySnap(valueMm: number, snapStepMm: number): number {
  if (snapStepMm <= 0) return valueMm;
  return Math.round(valueMm / snapStepMm) * snapStepMm;
}

/**
 * PointMM에 스냅 적용
 *
 * @param p - mm 단위 좌표
 * @param config - 스냅 설정
 * @returns 스냅된 mm 좌표
 */
export function snapPoint(p: PointMM, config: SnapConfig): PointMM {
  if (!config.enabled || config.stepMm <= 0) {
    return p;
  }

  return {
    x: applySnap(p.x, config.stepMm),
    y: applySnap(p.y, config.stepMm),
  };
}

// ============================================
// 치수 표기 함수
// ============================================

/**
 * mm 길이를 텍스트로 포맷
 *
 * @param lengthMm - mm 단위 길이
 * @returns 포맷된 문자열 (예: "4800 mm")
 */
export function formatLengthMm(lengthMm: number): string {
  return `${lengthMm.toFixed(0)} mm`;
}

/**
 * mm 길이를 cm로 포맷
 *
 * @param lengthMm - mm 단위 길이
 * @returns 포맷된 문자열 (예: "480.0 cm")
 */
export function formatLengthCm(lengthMm: number): string {
  const lengthCm = lengthMm / 10;
  return `${lengthCm.toFixed(1)} cm`;
}

/**
 * mm 길이를 m로 포맷
 *
 * @param lengthMm - mm 단위 길이
 * @returns 포맷된 문자열 (예: "4.8 m")
 */
export function formatLengthM(lengthMm: number): string {
  const lengthM = lengthMm / 1000;
  return `${lengthM.toFixed(2)} m`;
}

// ============================================
// 기하 계산 함수 (mm 단위)
// ============================================

/**
 * 두 점 사이의 거리 계산 (mm)
 *
 * @param a - 시작점 (mm)
 * @param b - 끝점 (mm)
 * @returns 거리 (mm)
 */
export function distanceMm(a: PointMM, b: PointMM): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 벡터 길이 계산 (mm)
 */
export function vectorLengthMm(v: PointMM): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * 벡터 정규화
 */
export function normalizeVector(v: PointMM): PointMM {
  const len = vectorLengthMm(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * 벡터 덧셈
 */
export function addVectors(a: PointMM, b: PointMM): PointMM {
  return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * 벡터 뺄셈
 */
export function subtractVectors(a: PointMM, b: PointMM): PointMM {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * 벡터 스칼라 곱
 */
export function scaleVector(v: PointMM, scale: number): PointMM {
  return { x: v.x * scale, y: v.y * scale };
}

// ============================================
// Viewport 제어 함수
// ============================================

/**
 * 초기 뷰포트 생성
 *
 * @param canvasWidth - Canvas 너비 (px)
 * @param canvasHeight - Canvas 높이 (px)
 * @param initialScale - 초기 스케일 (px/mm) - 기본값 0.12
 * @returns 뷰포트 상태
 */
export function createViewport(
  canvasWidth: number,
  canvasHeight: number,
  initialScale: number = 0.12
): ViewportState {
  return {
    scalePxPerMm: initialScale,
    offsetX: 0,
    offsetY: 0,
    canvasWidth,
    canvasHeight,
  };
}

/**
 * 줌 적용 (스케일 변경)
 *
 * @param viewport - 현재 뷰포트
 * @param delta - 줌 변화량 (양수: 확대, 음수: 축소)
 * @param centerPx - 줌 중심점 (px) - 마우스 위치
 * @returns 새로운 뷰포트
 */
export function applyZoom(
  viewport: ViewportState,
  delta: number,
  centerPx?: PointPX
): ViewportState {
  const minScale = 0.05; // 최소 0.05 px/mm (1mm = 0.05px, 4800mm = 240px)
  const maxScale = 2.0; // 최대 2.0 px/mm (1mm = 2px, 4800mm = 9600px)

  const zoomFactor = 1 + delta;
  const newScale = Math.max(minScale, Math.min(maxScale, viewport.scalePxPerMm * zoomFactor));

  // 줌 중심점이 주어진 경우, 해당 점을 기준으로 줌
  if (centerPx) {
    // 1. 현재 마우스 위치의 World 좌표 계산
    const worldPos = screenToWorld(centerPx, viewport);

    // 2. 새로운 스케일 적용
    const newViewport = { ...viewport, scalePxPerMm: newScale };

    // 3. 줌 중심점 유지 공식:
    // Screen = World * Scale + Offset
    // Screen_new = Screen_old (마우스 위치 고정)
    // World * NewScale + NewOffset = World * OldScale + OldOffset
    // NewOffset = OldOffset - World * (NewScale - OldScale)

    const scaleDiff = newScale - viewport.scalePxPerMm;
    const dx = worldPos.x * scaleDiff;
    const dy = worldPos.y * scaleDiff;

    return {
      ...newViewport,
      offsetX: viewport.offsetX - dx,
      offsetY: viewport.offsetY - dy,
    };
  }

  return { ...viewport, scalePxPerMm: newScale };
}

/**
 * 팬 적용 (화면 이동)
 *
 * @param viewport - 현재 뷰포트
 * @param dxPx - X 이동량 (px)
 * @param dyPx - Y 이동량 (px)
 * @returns 새로운 뷰포트
 */
export function applyPan(
  viewport: ViewportState,
  dxPx: number,
  dyPx: number
): ViewportState {
  return {
    ...viewport,
    offsetX: viewport.offsetX + dxPx,
    offsetY: viewport.offsetY + dyPx,
  };
}

/**
 * 뷰포트 리셋
 */
export function resetViewport(viewport: ViewportState): ViewportState {
  return {
    ...viewport,
    scalePxPerMm: 0.12,
    offsetX: 0,
    offsetY: 0,
  };
}

// ============================================
// 검증 함수
// ============================================

/**
 * mm 값이 유효한 범위인지 검증
 *
 * @param valueMm - mm 값
 * @param min - 최소값 (mm)
 * @param max - 최대값 (mm)
 * @returns 유효 여부
 */
export function isValidMm(valueMm: number, min: number = 0, max: number = 100000): boolean {
  return !isNaN(valueMm) && isFinite(valueMm) && valueMm >= min && valueMm <= max;
}

/**
 * 방 크기가 유효한지 검증
 *
 * @param lengthMm - 길이 (mm)
 * @returns 유효 여부
 */
export function isValidRoomSize(lengthMm: number): boolean {
  const MIN_ROOM_SIZE_MM = 100; // 최소 10cm
  const MAX_ROOM_SIZE_MM = 20000; // 최대 20m
  return isValidMm(lengthMm, MIN_ROOM_SIZE_MM, MAX_ROOM_SIZE_MM);
}
