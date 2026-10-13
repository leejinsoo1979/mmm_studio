import {
  CAPTURE_STEPS,
  type CaptureStep,
  type GuideState,
  guide,
  nextStep,
} from '@pascal-app/editor'
import { readGuideFrame } from './photo-capture'

/**
 * The 3D face capture's frame picker: the camera's video read a few times a
 * second, the pose told to the person, and each pose's sharpest steady
 * frame taken once it is held (capture-guide.ts decides; this runs it on a
 * live video). The studio's capture runs it, and so does the photo avatar
 * bench on a recorded clip.
 */

/** A full-size copy of a camera frame, as it is now. */
export function copyFrame(video: HTMLVideoElement, into?: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = into ?? document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d')!.drawImage(video, 0, 0)
  return canvas
}

export type GuidedCaptureEvents = {
  /** After each frame read: what to tell the person, and whether they are in position. */
  onAdvice: (message: string, ready: boolean) => void
  /** A pose was taken: its frame (a copy the caller keeps). */
  onShot: (step: CaptureStep, frame: HTMLCanvasElement) => void
  /** The guide's state after a frame (the next pose's once one is taken). */
  onState: (state: GuideState) => void
  /** A frame could not be read. */
  onError: () => void
}

/** How often (ms) a frame is read, after the last one was. */
const FRAME_GAP = 120

/**
 * Runs the frame picker on `video()` until the returned function is called.
 * `state` is shared with the caller, who may move it to another pose.
 */
export function runGuidedCapture(
  video: () => HTMLVideoElement | null,
  state: { current: GuideState },
  events: GuidedCaptureEvents,
): () => void {
  let stopped = false
  let timer = 0
  const frame = document.createElement('canvas')
  const best = document.createElement('canvas')
  const loop = async () => {
    const playing = video()
    const step = CAPTURE_STEPS[state.current.step]
    if (stopped) return
    // Every pose taken: wait, still looking, in case one is picked to be taken again.
    if (step && playing?.videoWidth) {
      try {
        copyFrame(playing, frame)
        const read = await readGuideFrame(frame, performance.now(), Math.abs(step.yaw) === 90)
        if (stopped) return
        const advice = guide(state.current, read)
        if (advice.state.best?.time === read.time) copyFrame(playing, best)
        events.onAdvice(advice.message, advice.ready)
        if (advice.take) {
          const taken = document.createElement('canvas')
          taken.width = best.width
          taken.height = best.height
          taken.getContext('2d')!.drawImage(best, 0, 0)
          events.onShot(step, taken)
          state.current = nextStep(advice.state)
        } else {
          state.current = advice.state
        }
        events.onState(state.current)
      } catch {
        events.onError()
      }
    }
    timer = window.setTimeout(() => void loop(), FRAME_GAP)
  }
  void loop()
  return () => {
    stopped = true
    window.clearTimeout(timer)
  }
}
