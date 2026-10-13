// The bench's cameras: clean photos as the studio's 3D capture asks for them, photos perturbed as a
// person with a webcam or a phone takes them (fixed seed per head), the turntable clip of the webcam
// path, and the shots its skin comparisons are drawn with.

export type Light = 'soft' | 'hard'

export type ShotSpec = {
  yaw: number
  pitch: number
  roll: number
  width: number
  height: number
  /** Focal length (pixels). */
  focal: number
  /** How much of the image's height the head (chin to crown, 24 cm) fills. */
  fill: number
  /** Where the eyes land off the image's centre (pixels). */
  shift: [number, number]
  light: Light
  /** A small expression, 0–1. */
  expression: number
  format: 'png' | 'jpeg'
  quality?: number
}

export const SLOTS = ['front', 'left45', 'right45', 'left90', 'right90'] as const
export type Slot = (typeof SLOTS)[number]
export const SLOT_YAW: Record<Slot, number> = { front: 0, left45: 45, right45: -45, left90: 90, right90: -90 }

/** A 70° diagonal field of view: what phones and webcams mostly have (the fit's own default). */
export const defaultFocal = (width: number, height: number) =>
  Math.hypot(width, height) / 2 / Math.tan((35 * Math.PI) / 180)

/** A 35 mm-equivalent focal length in pixels on an image (by its diagonal). */
export const focalFromMm = (mm: number, width: number, height: number) =>
  (mm / Math.hypot(36, 24)) * Math.hypot(width, height)

const CLEAN = { width: 768, height: 1024 }
/** The clean photos' distance: 0.5 m from the eyes. */
const CLEAN_FILL = (defaultFocal(CLEAN.width, CLEAN.height) * 0.24) / (0.5 * CLEAN.height)

export function cleanShot(yaw: number, pitch: number, light: Light = 'soft'): ShotSpec {
  return {
    yaw,
    pitch,
    roll: 0,
    ...CLEAN,
    focal: defaultFocal(CLEAN.width, CLEAN.height),
    fill: CLEAN_FILL,
    shift: [0, 0],
    light,
    expression: 0,
    format: 'png',
  }
}

/** The front photo the truth's landmarks are lifted from (straight on, soft light). */
export const referenceShot = () => cleanShot(0, 0)

/** The five clean photos (G1), each turned exactly as the capture asks, the chin up 2°. */
export const cleanShots = () => SLOTS.map((slot) => cleanShot(SLOT_YAW[slot], 2))

/** Seeded uniform numbers (mulberry32). */
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * The five photos as a person takes them (G2): each turn off by up to ±10°,
 * the head nodded up to ±6° and leant up to ±4°, one camera of 26–60 mm
 * equivalent at 1280 × 720 framing the head loosely, JPEG at quality 75, a
 * small expression in each, under a hard side light.
 */
export function perturbedShots(seed: number): ShotSpec[] {
  const next = random(seed)
  const u = (a: number, b: number) => a + (b - a) * next()
  const width = 1280
  const height = 720
  const focal = focalFromMm(u(26, 60), width, height)
  const fill = u(0.42, 0.55)
  return SLOTS.map((slot) => ({
    yaw: SLOT_YAW[slot] + u(-10, 10),
    pitch: u(-6, 6),
    roll: u(-4, 4),
    width,
    height,
    focal,
    fill,
    shift: [u(-60, 60), u(-40, 40)] as [number, number],
    light: 'hard' as const,
    expression: u(0.2, 0.6),
    format: 'jpeg' as const,
    quality: 0.75,
  }))
}

/** Where the skin is compared: the truth and the avatar at three turns, under one light. */
export const skinShots = (light: Light) => [0, 35, -35].map((yaw) => cleanShot(yaw, 0, light))

/**
 * The turntable clip of the webcam path (30 frames a second): straight on,
 * a turn to the left with holds at 45° and 90°, back, the same to the right,
 * and back, with a little nod and lean throughout.
 */
export function turntable(): { yaw: number; pitch: number; roll: number }[] {
  const keys: [number, number][] = [
    [0, 0],
    [1.6, 0],
    [2.6, 45],
    [4.4, 45],
    [5.4, 90],
    [7.2, 90],
    [8.6, 0],
    [9.4, 0],
    [10.4, -45],
    [12.2, -45],
    [13.2, -90],
    [15.0, -90],
    [16.4, 0],
    [17.0, 0],
  ]
  const frames: { yaw: number; pitch: number; roll: number }[] = []
  for (let f = 0; f < 17 * 30; f++) {
    const t = f / 30
    let k = 0
    while (k < keys.length - 2 && keys[k + 1]![0] <= t) k++
    const [t0, y0] = keys[k]!
    const [t1, y1] = keys[k + 1]!
    const s = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
    const eased = s * s * (3 - 2 * s)
    frames.push({
      yaw: y0 + (y1 - y0) * eased,
      pitch: 1.5 * Math.sin(t * 1.3),
      roll: 1 * Math.sin(t * 0.9 + 1),
    })
  }
  return frames
}
