'use client'

import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { getLinearUnitLabel, linearUnitToMeters, metersToLinearUnit } from './measurements'

/**
 * Shared display/storage conversion for numeric property controls so that
 * every length input honors the metric/imperial toggle identically.
 *
 * Values are always STORED in the field's own unit (meters for `unit === 'm'`).
 * Meter fields are DISPLAYED (and edited) in the active viewer length unit;
 * otherwise the conversions are the identity, so non-length units (`'°'`,
 * `'%'`, `'in'`, `''`, …) behave exactly as before.
 *
 * Used by both `SliderControl` and `MetricControl` — keep the two in sync via
 * this single source of truth.
 */
export function useLinearDisplay(unit: string, precision: number) {
  const viewerUnit = useViewer((state) => state.unit)
  const isImperial = viewerUnit === 'imperial' && unit === 'm'
  const isMillimeter = (viewerUnit === 'millimeter' || viewerUnit === 'metric') && unit === 'm'
  const activeLinearUnit =
    unit === 'm' && viewerUnit !== 'metric' ? viewerUnit : isImperial ? 'imperial' : 'millimeter'
  const isConvertedLength = unit === 'm'
  const displayUnit = isConvertedLength ? getLinearUnitLabel(activeLinearUnit) : unit

  const toDisplay = useCallback(
    (stored: number) => (isConvertedLength ? metersToLinearUnit(stored, activeLinearUnit) : stored),
    [activeLinearUnit, isConvertedLength],
  )
  const toStored = useCallback(
    (display: number) =>
      isConvertedLength ? linearUnitToMeters(display, activeLinearUnit) : display,
    [activeLinearUnit, isConvertedLength],
  )
  // Round a stored value so it lands on a clean number of DISPLAY-unit digits.
  const roundStored = useCallback(
    (stored: number) => toStored(Number.parseFloat(toDisplay(stored).toFixed(precision))),
    [toDisplay, toStored, precision],
  )

  return { isImperial, isMillimeter, displayUnit, toDisplay, toStored, roundStored }
}
