import { formatAreaLabel, type LinearUnit } from './../../../../../lib/measurements'

/**
 * Floor and lot areas in m² (ft² in imperial) whatever the length unit: the
 * mm / cm area units read as 8-digit numbers ('12000000.0mm²').
 */
export function formatFloorArea(squareMeters: number, unit: LinearUnit): string {
  return unit === 'imperial' ? formatAreaLabel(squareMeters, unit) : `${squareMeters.toFixed(1)}m²`
}
