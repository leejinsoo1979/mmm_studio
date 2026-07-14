// @ts-nocheck
export const DEG2RAD = Math.PI / 180;

export function guid(): string {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function removeValue<T>(array: T[], value: T): void {
  const idx = array.indexOf(value);
  if (idx >= 0) array.splice(idx, 1);
}

export function closestPointOnLine(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { x: number; y: number } {
  const a = x - x1;
  const b = y - y1;
  const c = x2 - x1;
  const d = y2 - y1;

  const dot = a * c + b * d;
  const lenSq = c * c + d * d;
  const param = lenSq ? dot / lenSq : -1;

  let xx: number;
  let yy: number;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * c;
    yy = y1 + param * d;
  }

  return { x: xx, y: yy };
}

export function pointDistanceFromLine(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const pt = closestPointOnLine(x, y, x1, y1, x2, y2);
  return distance(x, y, pt.x, pt.y);
}

export function angle(x1: number, y1: number, x2: number, y2: number): number {
  const dot = x1 * x2 + y1 * y2;
  const det = x1 * y2 - y1 * x2;
  return -Math.atan2(det, dot);
}

export function angle2pi(x1: number, y1: number, x2: number, y2: number): number {
  let theta = angle(x1, y1, x2, y2);
  if (theta < 0) theta += 2 * Math.PI;
  return theta;
}

export function map<T, R>(arr: T[], fn: (value: T) => R): R[] {
  return Array.prototype.map.call(arr, fn) as R[];
}

export function lineLineIntersect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number
): boolean {
  const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
  };

  const p1 = { x: x1, y: y1 };
  const p2 = { x: x2, y: y2 };
  const p3 = { x: x3, y: y3 };
  const p4 = { x: x4, y: y4 };

  return ccw(p1.x, p1.y, p3.x, p3.y, p4.x, p4.y) !== ccw(p2.x, p2.y, p3.x, p3.y, p4.x, p4.y) &&
    ccw(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y) !== ccw(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
}

export function cycle<T>(arr: T[], shift: number): T[] {
  const result = arr.slice(shift);
  result.push(...arr.slice(0, shift));
  return result;
}

export function removeIf<T>(arr: T[], predicate: (item: T) => boolean): T[] {
  return arr.filter(item => !predicate(item));
}

export function isClockwise(corners: { x: number; y: number }[]): boolean {
  let sum = 0;
  for (let i = 0; i < corners.length; i++) {
    const c1 = corners[i];
    const c2 = corners[(i + 1) % corners.length];
    if (!(c1 && c2)) continue;
    sum += (c2.x - c1.x) * (c2.y + c1.y);
  }
  return sum > 0;
}

export function hasValue<T>(arr: T[], value: T): boolean {
  return arr.includes(value);
}
