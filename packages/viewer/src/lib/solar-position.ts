import { MathUtils, Vector3 } from 'three/webgpu'

const DEFAULT_LATITUDE_DEGREES = 37.5

export type SolarPosition = {
  direction: Vector3
  elevation: number
  daylight: number
}

/** Approximate solar position for real-time architectural lighting. */
export function getSolarPosition(
  time: number,
  month: number,
  northOffset: number,
  latitude = DEFAULT_LATITUDE_DEGREES,
): SolarPosition {
  const dayOfYear = 15 + (Math.min(12, Math.max(1, month)) - 1) * 30.44
  const declination = MathUtils.degToRad(
    23.44 * Math.sin(MathUtils.degToRad((360 / 365) * (dayOfYear - 81))),
  )
  const lat = MathUtils.degToRad(latitude)
  const hourAngle = MathUtils.degToRad(15 * (Math.min(24, Math.max(0, time)) - 12))
  const elevation = Math.asin(
    Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
  )
  const azimuth =
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat),
    ) +
    Math.PI +
    MathUtils.degToRad(northOffset)
  const visibleElevation = Math.max(MathUtils.degToRad(2), elevation)
  const horizontal = Math.cos(visibleElevation)
  const direction = new Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(visibleElevation),
    Math.cos(azimuth) * horizontal,
  ).normalize()
  const daylight = MathUtils.smoothstep(elevation, MathUtils.degToRad(-6), MathUtils.degToRad(12))

  return { direction, elevation, daylight }
}
