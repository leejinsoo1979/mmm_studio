import { describe, expect, test } from 'bun:test'
import {
  formatAreaLabel,
  formatLinearMeasurement,
  getAreaUnitLabel,
  getLinearUnitLabel,
  linearControlValueToMeters,
  linearUnitToMeters,
  metersToLinearUnit,
  squareMetersToAreaUnit,
} from './measurements'

describe('linear measurements', () => {
  test('formats metric measurements in millimeters', () => {
    expect(formatLinearMeasurement(3, 'metric')).toBe('3000mm')
    expect(formatLinearMeasurement(3.456, 'metric')).toBe('3456mm')
  })

  test('formats millimeter measurements', () => {
    expect(formatLinearMeasurement(1, 'millimeter')).toBe('1000mm')
    expect(formatLinearMeasurement(0.1234, 'millimeter')).toBe('123mm')
  })

  test('formats centimeter measurements', () => {
    expect(formatLinearMeasurement(1, 'centimeter')).toBe('100cm')
    expect(formatLinearMeasurement(0.1234, 'centimeter')).toBe('12.3cm')
  })

  test('formats imperial measurements as feet and inches', () => {
    expect(formatLinearMeasurement(3.048, 'imperial')).toBe(`10'0"`)
    expect(formatLinearMeasurement(3.2004, 'imperial')).toBe(`10'6"`)
  })

  test('carries rounded 12 inches into the next foot', () => {
    expect(formatLinearMeasurement(3.047, 'imperial')).toBe(`10'0"`)
  })

  test('returns a placeholder for non-finite measurements', () => {
    expect(formatLinearMeasurement(NaN, 'imperial')).toBe('--')
    expect(formatLinearMeasurement(Infinity, 'imperial')).toBe('--')
    expect(formatLinearMeasurement(NaN, 'metric')).toBe('--')
    expect(formatLinearMeasurement(NaN, 'millimeter')).toBe('--')
    expect(formatLinearMeasurement(NaN, 'centimeter')).toBe('--')
  })

  test('formats zero measurements', () => {
    expect(formatLinearMeasurement(0, 'imperial')).toBe(`0'0"`)
    expect(formatLinearMeasurement(0, 'metric')).toBe('0mm')
    expect(formatLinearMeasurement(0, 'millimeter')).toBe('0mm')
    expect(formatLinearMeasurement(0, 'centimeter')).toBe('0cm')
  })

  test('formats sub-foot imperial measurements', () => {
    expect(formatLinearMeasurement(0.1524, 'imperial')).toBe(`0'6"`)
  })

  test('formats negative measurements with a sign', () => {
    expect(formatLinearMeasurement(-0.1524, 'imperial')).toBe(`-0'6"`)
    expect(formatLinearMeasurement(-0.1524, 'metric')).toBe('-152mm')
    expect(formatLinearMeasurement(-0.1524, 'millimeter')).toBe('-152mm')
    expect(formatLinearMeasurement(-0.1524, 'centimeter')).toBe('-15.2cm')
  })

  test('converts between meters and the active linear unit', () => {
    expect(metersToLinearUnit(0, 'imperial')).toBe(0)
    expect(linearUnitToMeters(0, 'imperial')).toBe(0)

    expect(metersToLinearUnit(1, 'metric')).toBe(1000)
    expect(linearUnitToMeters(1000, 'metric')).toBe(1)

    expect(metersToLinearUnit(0.3048, 'imperial')).toBeCloseTo(1)
    expect(linearUnitToMeters(1, 'imperial')).toBeCloseTo(0.3048)

    expect(metersToLinearUnit(1, 'millimeter')).toBe(1000)
    expect(linearUnitToMeters(1000, 'millimeter')).toBe(1)

    expect(metersToLinearUnit(1, 'centimeter')).toBe(100)
    expect(linearUnitToMeters(100, 'centimeter')).toBe(1)
  })

  test('converts numeric control input back to meters for wall panel edits', () => {
    expect(linearControlValueToMeters(10, 'imperial')).toBeCloseTo(3.048)
    expect(linearControlValueToMeters(0.5, 'imperial')).toBeCloseTo(0.1524)
    expect(linearControlValueToMeters(-1, 'imperial')).toBeCloseTo(-0.3048)
    expect(linearControlValueToMeters(3500, 'metric')).toBe(3.5)
    expect(linearControlValueToMeters(2500, 'millimeter')).toBe(2.5)
    expect(linearControlValueToMeters(250, 'centimeter')).toBe(2.5)
  })

  test('clamps numeric control input after converting to meters', () => {
    expect(linearControlValueToMeters(0.1, 'imperial', { minMeters: 0.1 })).toBe(0.1)
    expect(linearControlValueToMeters(0.3, 'imperial', { minMeters: 0.1 })).toBe(0.1)
    expect(linearControlValueToMeters(19.7, 'imperial', { maxMeters: 6 })).toBe(6)
    expect(linearControlValueToMeters(200, 'metric', { minMeters: 0.1 })).toBe(0.2)
    expect(linearControlValueToMeters(200, 'metric', { maxMeters: 0.15 })).toBe(0.15)
  })

  test('returns the display label for numeric controls', () => {
    expect(getLinearUnitLabel('metric')).toBe('mm')
    expect(getLinearUnitLabel('imperial')).toBe('ft')
    expect(getLinearUnitLabel('millimeter')).toBe('mm')
    expect(getLinearUnitLabel('centimeter')).toBe('cm')
  })
})

describe('area measurements', () => {
  test('converts square meters to the active area unit', () => {
    expect(squareMetersToAreaUnit(0, 'imperial')).toBe(0)
    expect(squareMetersToAreaUnit(12.5, 'metric')).toBe(12_500_000)
    expect(squareMetersToAreaUnit(1, 'imperial')).toBeCloseTo(10.7639)
    expect(squareMetersToAreaUnit(1, 'millimeter')).toBe(1_000_000)
    expect(squareMetersToAreaUnit(1, 'centimeter')).toBe(10_000)
  })

  test('returns the display label for area readouts', () => {
    expect(getAreaUnitLabel('metric')).toBe('mm²')
    expect(getAreaUnitLabel('imperial')).toBe('ft²')
    expect(getAreaUnitLabel('millimeter')).toBe('mm²')
    expect(getAreaUnitLabel('centimeter')).toBe('cm²')
  })

  test('formats an area label with value and unit', () => {
    expect(formatAreaLabel(12.34, 'metric')).toBe('12340000.0mm²')
    expect(formatAreaLabel(1, 'imperial')).toBe('10.8ft²')
    expect(formatAreaLabel(1, 'millimeter')).toBe('1000000.0mm²')
    expect(formatAreaLabel(1, 'centimeter')).toBe('10000.0cm²')
    expect(formatAreaLabel(12.34, 'metric', 2)).toBe('12340000.00mm²')
  })
})
