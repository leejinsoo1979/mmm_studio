import type { AvatarLook, EmoteCue, FaceHandleId, FacePin, FaceRegion } from '@pascal-app/editor'
import type { Ref } from 'react'
import type { AiPhotoFraming } from '@/lib/ai-photo/client'

/**
 * What the camera frames: the whole body, the upper body, the head with its
 * hair, the face; or, closer, the eyes and brows, the nose and mouth, the
 * hips to the feet, the shins and feet.
 */
export type CameraFocus = 'full' | 'upper' | 'hair' | 'face' | 'eyes' | 'mouth' | 'legs' | 'feet'

/** The turntable's preset angles; 'free' once turned off them. */
export type StageView = 'front' | 'angle' | 'side' | 'free'

/** 'still': a held neutral pose, the head towards the camera when seen from the front. 'live': idle and emotes. */
export type StagePose = 'still' | 'live'

/** Looks for the studio canvas and its snapshots only: never saved, never sent to the AI. */
export const STUDIO_FILTERS = [
  { id: 'realistic', label: '사실적' },
  { id: 'mono', label: '흑백 필름' },
  { id: 'sunset', label: '선셋' },
  { id: 'vintage', label: '빈티지' },
  { id: 'cinema', label: '시네마' },
  { id: 'crush', label: '크러시' },
] as const
export type StudioFilterId = (typeof STUDIO_FILTERS)[number]['id']

/** CSS px the studio's chrome covers along each edge of the full-bleed stage. */
export type StageInsets = { top: number; right: number; bottom: number; left: number }

export type SculptSettings = {
  symmetric: boolean
  /** Multiplies each handle's own radius: 0.5–2. */
  radiusScale: number
  /** Vertical drags push and pull (towards or away from the camera) instead of moving up and down. */
  depth: boolean
  /** Its handles are emphasised and the rest dimmed; null: all alike. */
  region: FaceRegion | null
}

/** A handle's drag. `delta` is the total since `start`, in front-view fractions (FacePin: dx right, dy down, dz towards the viewer). */
export type SculptEvent =
  | { phase: 'start'; handle: FaceHandleId }
  | { phase: 'move'; handle: FaceHandleId; delta: FacePin }
  | { phase: 'end'; handle: FaceHandleId; delta: FacePin }
  | { phase: 'cancel'; handle: FaceHandleId }

export type StageCapture =
  /** What the free rect shows, at 2× its CSS size, with the filter: PNG. */
  | { kind: 'snapshot'; filter: StudioFilterId }
  /** A clean JPEG at AI_PHOTO_SHOTS[framing]: no filter, no platform, light-grey backdrop. */
  | { kind: 'ai'; framing: AiPhotoFraming }

export type StudioStageApi = {
  /** Turns to a preset angle; 'angle' and 'side' flip sides when asked again. */
  setView: (view: Exclude<StageView, 'free'>) => void
  /** Zoom back to 1 for the current focus. */
  frame: () => void
  capture: (request: StageCapture) => Promise<Blob>
}

export type StudioStageProps = {
  ref?: Ref<StudioStageApi>
  avatarId: string
  /** The look to show (already throttled by the UI). */
  look: AvatarLook
  focus: CameraFocus
  insets: StageInsets
  pose: StagePose
  /** Plays only while `pose` is 'live'. */
  cue: EmoteCue | null
  onCueEnd: () => void
  filter: StudioFilterId
  /** Null: no handles (another tab, handles hidden, UI hidden, no landmarks). */
  sculpt: SculptSettings | null
  onSculpt: (event: SculptEvent) => void
  onHandleHover: (handle: FaceHandleId | null) => void
  onViewChange: (view: StageView) => void
}
