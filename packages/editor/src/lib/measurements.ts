export type LinearUnit = 'metric' | 'imperial' | 'millimeter' | 'centimeter'

const METERS_PER_FOOT = 0.3048
const FEET_PER_METER = 1 / METERS_PER_FOOT
const MILLIMETERS_PER_METER = 1000
const METERS_PER_MILLIMETER = 1 / MILLIMETERS_PER_METER
const CENTIMETERS_PER_METER = 100
const METERS_PER_CENTIMETER = 1 / CENTIMETERS_PER_METER

type LinearControlValueOptions = {
  minMeters?: number
  maxMeters?: number
}

export function metersToLinearUnit(meters: number, unit: LinearUnit): number {
  if (unit === 'imperial') return meters * FEET_PER_METER
  if (unit === 'centimeter') return meters * CENTIMETERS_PER_METER
  return meters * MILLIMETERS_PER_METER
}

export function linearUnitToMeters(value: number, unit: LinearUnit): number {
  if (unit === 'imperial') return value * METERS_PER_FOOT
  if (unit === 'centimeter') return value * METERS_PER_CENTIMETER
  return value * METERS_PER_MILLIMETER
}

export function linearControlValueToMeters(
  value: number,
  unit: LinearUnit,
  options: LinearControlValueOptions = {},
): number {
  const meters = linearUnitToMeters(value, unit)
  const minMeters = options.minMeters ?? Number.NEGATIVE_INFINITY
  const maxMeters = options.maxMeters ?? Number.POSITIVE_INFINITY

  return Math.min(Math.max(meters, minMeters), maxMeters)
}

export function getLinearUnitLabel(unit: LinearUnit): string {
  if (unit === 'imperial') return 'ft'
  if (unit === 'centimeter') return 'cm'
  return 'mm'
}

const SQUARE_FEET_PER_SQUARE_METER = FEET_PER_METER * FEET_PER_METER
const SQUARE_MILLIMETERS_PER_SQUARE_METER = MILLIMETERS_PER_METER * MILLIMETERS_PER_METER
const SQUARE_CENTIMETERS_PER_SQUARE_METER = CENTIMETERS_PER_METER * CENTIMETERS_PER_METER

export function squareMetersToAreaUnit(squareMeters: number, unit: LinearUnit): number {
  if (unit === 'imperial') return squareMeters * SQUARE_FEET_PER_SQUARE_METER
  if (unit === 'centimeter') return squareMeters * SQUARE_CENTIMETERS_PER_SQUARE_METER
  return squareMeters * SQUARE_MILLIMETERS_PER_SQUARE_METER
}

export function getAreaUnitLabel(unit: LinearUnit): string {
  if (unit === 'imperial') return 'ft²'
  if (unit === 'centimeter') return 'cm²'
  return 'mm²'
}

export function formatAreaLabel(
  squareMeters: number,
  unit: LinearUnit,
  fractionDigits = 1,
): string {
  return `${squareMetersToAreaUnit(squareMeters, unit).toFixed(fractionDigits)}${getAreaUnitLabel(unit)}`
}

export function formatLinearMeasurement(meters: number, unit: LinearUnit): string {
  if (!Number.isFinite(meters)) return '--'

  const absoluteMeters = Math.abs(meters)

  if (unit === 'imperial') {
    const feet = metersToLinearUnit(absoluteMeters, unit)
    let wholeFeet = Math.floor(feet)
    let inches = Math.round((feet - wholeFeet) * 12)
    if (inches === 12) {
      wholeFeet += 1
      inches = 0
    }

    const sign = meters < 0 && (wholeFeet !== 0 || inches !== 0) ? '-' : ''

    return `${sign}${wholeFeet}'${inches}"`
  }

  if (unit === 'centimeter') {
    const roundedCentimeters = Math.round(metersToLinearUnit(absoluteMeters, unit) * 10) / 10
    const sign = meters < 0 && roundedCentimeters !== 0 ? '-' : ''
    return `${sign}${roundedCentimeters}cm`
  }

  const roundedMillimeters = Math.round(metersToLinearUnit(absoluteMeters, unit))
  const sign = meters < 0 && roundedMillimeters !== 0 ? '-' : ''

  return `${sign}${roundedMillimeters}mm`
}
