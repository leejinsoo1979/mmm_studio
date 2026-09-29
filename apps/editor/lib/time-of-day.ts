import { useViewer } from '@pascal-app/viewer'

/** Theme shown for each part of the day; daytime keeps the user's theme. */
export function themeForTime(time: number): 'night' | 'twilight' | null {
  if (time < 5.5 || time >= 19.5) return 'night'
  if (time < 7 || time >= 18) return 'twilight'
  return null
}

/**
 * The light source for a slider time. At night the moon lights the scene from
 * the sun's opposite hour: the night theme already darkens the sky and tints
 * the light, and a sun below the horizon on top of it would leave the scene
 * pitch black.
 */
export function lightTimeFor(time: number): number {
  return themeForTime(time) === 'night' ? (time + 12) % 24 : time
}

let dayTheme = 'studio'
/** The time last picked on the slider, which the sun position can't tell apart at night. */
let sliderClock: number | null = null

const clockFor = (sunTime: number) =>
  sliderClock !== null && lightTimeFor(sliderClock) === sunTime ? sliderClock : sunTime

/** The clock the user set: the slider's own time while the moon stands in for the sun. */
export function useClock(): number {
  return clockFor(useViewer((s) => s.sunTime))
}

export const getClock = () => clockFor(useViewer.getState().sunTime)

export const formatClock = (time: number) => {
  const hh = Math.floor(time)
  const mm = Math.round((time - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Sets the time of day (a clock in hours): moves the sun (the moon's side at
 * night) and brings in the twilight / night themes after dusk, restoring the
 * daytime theme at dawn.
 */
export function setClock(time: number) {
  const viewer = useViewer.getState()
  if (
    !themeForTime(viewer.sunTime) &&
    viewer.sceneTheme !== 'night' &&
    viewer.sceneTheme !== 'twilight'
  )
    dayTheme = viewer.sceneTheme
  sliderClock = time
  viewer.setSunTime(lightTimeFor(time))
  viewer.setSceneTheme(themeForTime(time) ?? dayTheme)
}
