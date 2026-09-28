type Dimensions = readonly number[] | null | undefined

const toMm = (m: number) => Math.round(m * 1000)

/** Short card line: footprint `W×D` in mm, from `[w, h, d]` metres. */
export function formatCatalogSize(dimensions: Dimensions): string | undefined {
  if (!dimensions || dimensions.length < 3) return undefined
  const [w, , d] = dimensions
  if (!(Number.isFinite(w) && Number.isFinite(d))) return undefined
  return `${toMm(w!)}×${toMm(d!)}`
}

/** Hover-card line: `W×H×D mm`, from `[w, h, d]` metres. */
export function formatCatalogSizeFull(dimensions: Dimensions): string | undefined {
  if (!dimensions || dimensions.length < 3) return undefined
  if (!dimensions.every(Number.isFinite)) return undefined
  return `${dimensions.slice(0, 3).map(toMm).join('×')} mm`
}
