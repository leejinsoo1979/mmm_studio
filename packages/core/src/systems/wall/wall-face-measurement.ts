import type { WallNode } from '../../schema'
import { isCurvedWall } from './wall-curve'
import { getWallPlanFootprint } from './wall-footprint'
import type { Point2D, WallMiterData } from './wall-mitering'

/**
 * Face-line extraction for wall measurements. Room dimensions are read on
 * the wall's INNER face (내경 / clear dimension) — the convention floor
 * plans use — so the number a user drags with the rectangle-room tool is
 * the number the persistent labels show back.
 */

export type WallFaceLine = {
  start: Point2D
  end: Point2D
}

function pointMatchesWallPlanPoint(point: Point2D | undefined, planPoint: [number, number]) {
  if (!point) return false
  return Math.abs(point.x - planPoint[0]) < 1e-6 && Math.abs(point.y - planPoint[1]) < 1e-6
}

/** Both mitered long faces of a straight wall, or null for curved walls. */
export function getWallFaceLines(
  wall: WallNode,
  miterData: WallMiterData,
): { left: WallFaceLine; right: WallFaceLine } | null {
  if (isCurvedWall(wall)) return null

  const footprint = getWallPlanFootprint(wall, miterData)
  if (footprint.length < 4) return null

  const startRight = footprint[0]
  const endRight = footprint[1]
  const hasEndCenterPoint = pointMatchesWallPlanPoint(footprint[2], wall.end)
  const endLeft = footprint[hasEndCenterPoint ? 3 : 2]
  const lastPoint = footprint[footprint.length - 1]
  const hasStartCenterPoint = pointMatchesWallPlanPoint(lastPoint, wall.start)
  const startLeft = footprint[hasStartCenterPoint ? footprint.length - 2 : footprint.length - 1]

  if (!(startRight && endRight && endLeft && startLeft)) return null

  return {
    left: { start: startLeft, end: endLeft },
    right: { start: startRight, end: endRight },
  }
}

function getLineMidpoint(line: WallFaceLine): Point2D {
  return {
    x: (line.start.x + line.end.x) / 2,
    y: (line.start.y + line.end.y) / 2,
  }
}

/** Plan-space bbox centre of a wall set — cheap "where the rooms are" anchor. */
export function getLevelWallsPlanCenter(levelWalls: readonly WallNode[]): Point2D {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const candidateWall of levelWalls) {
    minX = Math.min(minX, candidateWall.start[0], candidateWall.end[0])
    maxX = Math.max(maxX, candidateWall.start[0], candidateWall.end[0])
    minY = Math.min(minY, candidateWall.start[1], candidateWall.end[1])
    maxY = Math.max(maxY, candidateWall.start[1], candidateWall.end[1])
  }

  return {
    x: minX === Number.POSITIVE_INFINITY ? 0 : (minX + maxX) / 2,
    y: minY === Number.POSITIVE_INFINITY ? 0 : (minY + maxY) / 2,
  }
}

/**
 * The wall's INNER face line (내경 측정 기준): the mitered face toward the
 * room. Explicit exterior tagging wins; otherwise the face nearer the level
 * centre is taken as inner. Null for curved walls (no straight face line).
 */
export function getWallInnerFaceLine(
  wall: WallNode,
  miterData: WallMiterData,
  levelWalls: readonly WallNode[],
): WallFaceLine | null {
  const faceLines = getWallFaceLines(wall, miterData)
  if (!faceLines) return null

  // `left` is the front-side face — when the front is tagged exterior the
  // inner face is the opposite (right) one, and vice versa.
  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') {
    return faceLines.right
  }
  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') {
    return faceLines.left
  }

  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return null

  const wallMidpoint = {
    x: (wall.start[0] + wall.end[0]) / 2,
    y: (wall.start[1] + wall.end[1]) / 2,
  }
  const levelCenter = getLevelWallsPlanCenter(levelWalls)
  const normal = { x: -dy / length, y: dx / length }
  const fromCenter = {
    x: wallMidpoint.x - levelCenter.x,
    y: wallMidpoint.y - levelCenter.y,
  }
  const outwardNormal =
    fromCenter.x * normal.x + fromCenter.y * normal.y >= 0 ? normal : { x: -normal.x, y: -normal.y }
  const rightMidpoint = getLineMidpoint(faceLines.right)
  const leftMidpoint = getLineMidpoint(faceLines.left)
  const rightScore =
    (rightMidpoint.x - wallMidpoint.x) * outwardNormal.x +
    (rightMidpoint.y - wallMidpoint.y) * outwardNormal.y
  const leftScore =
    (leftMidpoint.x - wallMidpoint.x) * outwardNormal.x +
    (leftMidpoint.y - wallMidpoint.y) * outwardNormal.y

  // Inner = the face scoring LOWER along the outward normal.
  return rightScore >= leftScore ? faceLines.left : faceLines.right
}
