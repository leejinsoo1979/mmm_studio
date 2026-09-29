export const WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'fog'] as const
export type Weather = (typeof WEATHERS)[number]

/**
 * How each weather lights and fills the scene:
 *  - `sun`: share of the direct (shadow-casting) sunlight that gets through;
 *  - `fill`: share of the sky and fill light;
 *  - `overcast`: how far the sky colour greys over;
 *  - `fog`: exponential fog density (per metre);
 *  - `fall`: what comes down, if anything.
 */
export type WeatherLook = {
  sun: number
  fill: number
  overcast: number
  fog: number
  fall: 'rain' | 'snow' | null
}

export const WEATHER_LOOKS: Record<Weather, WeatherLook> = {
  clear: { sun: 1, fill: 1, overcast: 0, fog: 0, fall: null },
  cloudy: { sun: 0.3, fill: 0.85, overcast: 0.55, fog: 0.004, fall: null },
  rain: { sun: 0.12, fill: 0.7, overcast: 0.75, fog: 0.014, fall: 'rain' },
  snow: { sun: 0.35, fill: 0.95, overcast: 0.6, fog: 0.012, fall: 'snow' },
  fog: { sun: 0.3, fill: 0.9, overcast: 0.65, fog: 0.06, fall: null },
}

/** The grey an overcast sky turns towards. */
export const OVERCAST_SKY = '#a3abb5'
