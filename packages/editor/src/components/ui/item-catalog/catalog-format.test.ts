import { describe, expect, test } from 'bun:test'
import { formatCatalogSize, formatCatalogSizeFull } from './catalog-format'

describe('formatCatalogSize', () => {
  test('returns the W×D footprint in rounded mm', () => {
    expect(formatCatalogSize([0.9, 2.1, 0.12])).toBe('900×120')
    expect(formatCatalogSize([1.2345, 0.5, 0.6789])).toBe('1235×679')
  })

  test('is undefined without usable dimensions', () => {
    expect(formatCatalogSize(undefined)).toBeUndefined()
    expect(formatCatalogSize(null)).toBeUndefined()
    expect(formatCatalogSize([1, 2])).toBeUndefined()
    expect(formatCatalogSize([Number.NaN, 1, 1])).toBeUndefined()
  })
})

describe('formatCatalogSizeFull', () => {
  test('returns W×H×D mm', () => {
    expect(formatCatalogSizeFull([0.9, 2.1, 0.12])).toBe('900×2100×120 mm')
  })

  test('is undefined without usable dimensions', () => {
    expect(formatCatalogSizeFull(undefined)).toBeUndefined()
    expect(formatCatalogSizeFull([1, Number.POSITIVE_INFINITY, 1])).toBeUndefined()
  })
})
