import type { CaptureSlot } from './avatar-job'

/**
 * The 3D face capture's guide: the turns it walks the person through —
 * front, a ¾ turn and a full side view each way — and, frame by frame of
 * the camera, whether they are there yet, what to tell them, and which
 * frame to keep (the sharpest of a steady moment). The side views matter
 * most: only they show the profile (forehead, nose, lips, chin) that a
 * front photo can't.
 */

export type CaptureStep = {
  slot: Exclude<CaptureSlot, 'free'>
  /** The turn asked for (degrees, > 0 to the subject's left). */
  yaw: number
  label: string
  /** What to do, said while they aren't there yet. */
  prompt: string
}

export const CAPTURE_STEPS: readonly CaptureStep[] = [
  { slot: 'front', yaw: 0, label: '정면', prompt: '정면을 바라봐 주세요' },
  { slot: 'left45', yaw: 45, label: '왼쪽 45°', prompt: '왼쪽으로 고개를 반쯤 돌려 주세요' },
  {
    slot: 'left90',
    yaw: 90,
    label: '왼쪽 옆얼굴',
    prompt: '왼쪽으로 완전히 돌려 옆얼굴을 보여 주세요',
  },
  { slot: 'right45', yaw: -45, label: '오른쪽 45°', prompt: '오른쪽으로 고개를 반쯤 돌려 주세요' },
  {
    slot: 'right90',
    yaw: -90,
    label: '오른쪽 옆얼굴',
    prompt: '오른쪽으로 완전히 돌려 옆얼굴을 보여 주세요',
  },
]

/** What the page read from one camera frame. */
export type GuideFrame = {
  /** ms. */
  time: number
  /** MediaPipe's turn, nod and lean (degrees), null where it found no face. */
  yaw: number | null
  pitch: number | null
  roll: number | null
  /** The distance between the irises over the frame's width, null with no face. */
  eyes: number | null
  /** Whether the person fills enough of the frame (their mask), for side views. */
  person: boolean
  /** Where the person's outline's centre is (fractions of the frame), for holding still. */
  centre: [number, number] | null
  /** How sharp the face is (variance of the Laplacian over it). */
  sharpness: number
  /** How many faces MediaPipe found (more than one: someone else is in the photo). */
  faces?: number
  /** How lit the face is: its mean luma (0–255), null with no face. */
  exposure?: number | null
  /** The darker cheek's luma over the lighter one's, null with no face: well under 1, lit from one side. */
  balance?: number | null
  /** MediaPipe's blendshapes (0–1), null with no face: the more shut eye, the open jaw, the wider smile. */
  blink?: number | null
  jawOpen?: number | null
  smile?: number | null
}

export type GuideState = {
  step: number
  /** When the person got into position and held still (ms), null while they aren't. */
  since: number | null
  /** The sharpest frame of the steady moment so far (its time). */
  best: { time: number; sharpness: number } | null
  /** The last turn MediaPipe saw (degrees): which side a face too far turned for it is on. */
  lastYaw: number | null
  lastCentre: [number, number] | null
}

export const startGuide = (step = 0): GuideState => ({
  step,
  since: null,
  best: null,
  lastYaw: null,
  lastCentre: null,
})

/** How long (ms) the person holds a pose before its frame is taken. */
export const HOLD_MS = 700
/** Below this the face is too blurred to keep. */
export const MIN_SHARPNESS = 12

export type GuideAdvice = {
  state: GuideState
  /** What to show now. */
  message: string
  /** In position (and steady). */
  ready: boolean
  /** Take the frame kept as `state.best` now: the pose was held long enough. */
  take: boolean
}

/**
 * How MediaPipe's nod reads a face held level, looking into the lens (degrees): about 10° chin
 * down, give or take 4 from face to face (its average face leans back). Nods are judged from it.
 */
export const LEVEL_PITCH = -10
/** The ¾ view's turns (degrees, as MediaPipe reads them: within a few degrees of the real turn). */
const QUARTER_TURN = { least: 33, most: 60 }
/** Still read under this turn (degrees), a face has not turned to a full side view yet. */
const SIDE_TURN = 60

function placement(step: CaptureStep, frame: GuideFrame, lastYaw: number | null): string | null {
  const side = Math.sign(step.yaw)
  if (step.yaw === 0) {
    if (frame.yaw === null || frame.eyes === null)
      return '얼굴이 보이지 않아요. 화면 가운데에 얼굴을 맞춰 주세요'
    if (frame.eyes < 0.07) return '조금 더 가까이 와 주세요'
    if (frame.eyes > 0.28) return '조금 뒤로 물러나 주세요'
    if (Math.abs(frame.yaw) > 7) return '정면을 바라봐 주세요'
    if (Math.abs((frame.pitch ?? LEVEL_PITCH) - LEVEL_PITCH) > 10)
      return '고개를 숙이거나 들지 말고 정면을 봐 주세요'
    if (Math.abs(frame.roll ?? 0) > 8) return '고개를 똑바로 세워 주세요'
    return null
  }
  if (Math.abs(step.yaw) === 45) {
    if (frame.yaw === null) return step.prompt
    const turn = frame.yaw * side
    if (turn < QUARTER_TURN.least) return turn < 10 ? step.prompt : '조금 더 돌려 주세요'
    if (turn > QUARTER_TURN.most) return '너무 많이 돌렸어요. 조금 덜 돌려 주세요'
    if (Math.abs((frame.pitch ?? LEVEL_PITCH) - LEVEL_PITCH) > 12)
      return '고개를 숙이거나 들지 말아 주세요'
    return null
  }
  // A full side view: MediaPipe has (nearly) lost the face, last seen turning this way.
  if (!frame.person) return '화면 안에 머리와 어깨가 보이게 해 주세요'
  if (frame.yaw !== null && frame.yaw * side < SIDE_TURN) {
    return frame.yaw * side > 0 ? '조금 더 돌려 주세요. 코끝이 옆을 향하게요' : step.prompt
  }
  if (frame.yaw === null && !(lastYaw !== null && lastYaw * side > 35)) return step.prompt
  return null
}

/** Moves the guide on by one camera frame. */
export function guide(state: GuideState, frame: GuideFrame): GuideAdvice {
  const step = CAPTURE_STEPS[state.step]
  if (!step) return { state, message: '촬영이 끝났어요', ready: false, take: false }
  const lastYaw = frame.yaw ?? state.lastYaw
  const moved =
    frame.centre && state.lastCentre
      ? Math.hypot(frame.centre[0] - state.lastCentre[0], frame.centre[1] - state.lastCentre[1])
      : 0
  const next: GuideState = { ...state, lastYaw, lastCentre: frame.centre }
  const problem = placement(step, frame, state.lastYaw) ?? condition(step, frame)
  if (problem) {
    return {
      state: { ...next, since: null, best: null },
      message: problem,
      ready: false,
      take: false,
    }
  }
  // In position: hold still (the outline moving under 1.5 % of the frame between frames).
  if (moved > 0.015) {
    return {
      state: { ...next, since: null, best: null },
      message: '그대로 잠깐 멈춰 주세요',
      ready: false,
      take: false,
    }
  }
  const since = state.since ?? frame.time
  const best =
    frame.sharpness >= MIN_SHARPNESS && (!state.best || frame.sharpness > state.best.sharpness)
      ? { time: frame.time, sharpness: frame.sharpness }
      : state.best
  const held = frame.time - since >= HOLD_MS
  if (held && !best) {
    return {
      state: { ...next, since, best },
      message: '흔들렸어요. 밝은 곳에서 잠깐 멈춰 주세요',
      ready: true,
      take: false,
    }
  }
  return {
    state: { ...next, since, best },
    message: held ? '찍었어요' : '좋아요, 그대로 멈춰 주세요',
    ready: true,
    take: held && best !== null,
  }
}

/** A face's mean luma below which it is too dark to read, and above which it is burnt out. */
export const EXPOSURE = { least: 55, most: 235 }
/** The darker cheek's share of the lighter one's light under which the face is lit from one side. */
export const MIN_BALANCE = 0.75
/** Blendshape levels past which the eyes read as shut, the mouth as open, the face as smiling. */
export const EXPRESSION = { blink: 0.5, jawOpen: 0.2, smile: 0.4 }

/**
 * What else, with the pose right, would spoil the photo: someone else in it,
 * too little or too much light, light from one side (the front view, whose
 * light the skin is read under: its shading would stay in the skin), shut
 * eyes or an open or smiling mouth (the avatar's face is a neutral, shut
 * one; MediaPipe reads no expression on a full side view).
 */
function condition(step: CaptureStep, frame: GuideFrame): string | null {
  if ((frame.faces ?? 1) > 1) return '다른 사람이 함께 보여요. 혼자 화면에 나와 주세요'
  if (frame.exposure != null) {
    if (frame.exposure < EXPOSURE.least) return '너무 어두워요. 밝은 곳으로 가거나 불을 켜 주세요'
    if (frame.exposure > EXPOSURE.most) return '너무 밝아요. 얼굴에 바로 비치는 빛을 피해 주세요'
  }
  if (step.yaw === 0 && frame.balance != null && frame.balance < MIN_BALANCE) {
    return '얼굴 한쪽이 어두워요. 창문이나 조명을 정면으로 마주 봐 주세요'
  }
  if (Math.abs(step.yaw) < 90) {
    if ((frame.blink ?? 0) > EXPRESSION.blink) return '눈을 크게 떠 주세요'
    if ((frame.jawOpen ?? 0) > EXPRESSION.jawOpen || (frame.smile ?? 0) > EXPRESSION.smile) {
      return '입을 다물고 웃지 말고 무표정으로 있어 주세요'
    }
  }
  return null
}

/** The guide after a frame was kept: on to the next step. */
export const nextStep = (state: GuideState): GuideState => ({
  ...startGuide(state.step + 1),
  lastYaw: state.lastYaw,
})

/**
 * How sharp a grey image is over a box (x, y, width, height in pixels; the
 * part inside the image): the variance of its Laplacian, as a blurred frame
 * from a turning head has little.
 */
export function sharpness(
  gray: ArrayLike<number>,
  width: number,
  box: [number, number, number, number],
): number {
  const [bx, by, bw, bh] = box.map(Math.round) as [number, number, number, number]
  const height = Math.floor(gray.length / width)
  let sum = 0
  let sum2 = 0
  let count = 0
  for (let y = Math.max(1, by); y < Math.min(height - 1, by + bh - 1); y++) {
    for (let x = Math.max(1, bx); x < Math.min(width - 1, bx + bw - 1); x++) {
      const i = y * width + x
      const l = gray[i - 1]! + gray[i + 1]! + gray[i - width]! + gray[i + width]! - 4 * gray[i]!
      sum += l
      sum2 += l * l
      count++
    }
  }
  if (!count) return 0
  const mean = sum / count
  return sum2 / count - mean * mean
}
