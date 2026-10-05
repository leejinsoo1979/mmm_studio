import {
  AI_PHOTO_ERROR_TEXT,
  type AiPhotoClientStatus,
  type AiPhotoFraming,
  type AiPhotoResult,
  aiPhotoErrorText,
} from '@/lib/ai-photo/client'
import type { CameraFocus } from './stage-contract'

/**
 * The AI 실사 사진 dialog's pure parts: which state it shows, its copy, its
 * progress, the file names, and the "AI 생성 이미지" label burned into every
 * photo it hands out (the owner's chosen disclosure: the re-encode drops the
 * provider's metadata, so the label is what tells a viewer).
 */

export const AI_LABEL_TEXT = 'AI 생성 이미지'

const LABEL_FONT = 'Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'

/** The label's width in ems when it can't be measured: 2 Latin letters, 2 spaces, 5 Hangul. */
const LABEL_EMS = 6.4

export type LabelBox = {
  x: number
  y: number
  width: number
  height: number
  radius: number
  fontSize: number
  /** Where the text starts and its baseline's middle (draw it with textBaseline 'middle'). */
  textX: number
  textY: number
}

/** The label pill at the bottom-left of a `width`×`height` image. */
export function labelBox(width: number, height: number, textWidth?: number): LabelBox {
  const short = Math.min(width, height)
  const inset = Math.round(short * 0.03)
  const fontSize = Math.max(14, Math.round(short * 0.028))
  const padding = Math.round(fontSize * 0.6)
  const boxHeight = Math.round(fontSize * 1.8)
  const boxWidth = Math.ceil(textWidth ?? fontSize * LABEL_EMS) + padding * 2
  const y = height - inset - boxHeight
  return {
    x: inset,
    y,
    width: boxWidth,
    height: boxHeight,
    radius: boxHeight / 2,
    fontSize,
    textX: inset + padding,
    textY: y + boxHeight / 2,
  }
}

/** The photo with the label drawn in, as a JPEG (browser only). */
export async function labelImage(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d context')
    context.drawImage(bitmap, 0, 0)
    const font = (size: number) => `600 ${size}px ${LABEL_FONT}`
    const guess = labelBox(canvas.width, canvas.height)
    context.font = font(guess.fontSize)
    const box = labelBox(canvas.width, canvas.height, context.measureText(AI_LABEL_TEXT).width)
    context.fillStyle = 'rgba(0,0,0,0.55)'
    context.beginPath()
    context.roundRect(box.x, box.y, box.width, box.height, box.radius)
    context.fill()
    context.fillStyle = '#ffffff'
    context.textBaseline = 'middle'
    context.fillText(AI_LABEL_TEXT, box.textX, box.textY)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(new Error('could not encode'))),
        'image/jpeg',
        0.92,
      ),
    )
  } finally {
    bitmap.close()
  }
}

const two = (value: number) => String(value).padStart(2, '0')

/** `prefix-YYYYMMDD-HHmmss.ext`, in local time. */
export function stampedName(prefix: string, extension: string, date = new Date()): string {
  const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`
  const time = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  return `${prefix}-${day}-${time}.${extension}`
}

/** Saves a blob under a name, through an object URL let go a second later. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The framing the dialog opens on: the face where the camera was on it, the whole body for 전신. */
export function defaultFraming(focus: CameraFocus): AiPhotoFraming {
  if (focus === 'face' || focus === 'hair') return 'face'
  return focus === 'full' ? 'full' : 'upper'
}

export const FRAMING_LABELS: Record<AiPhotoFraming, string> = {
  face: '얼굴',
  upper: '상반신',
  full: '전신',
}

/** Whether to offer sending the face photo: allowed, there is one, the character takes it, a player's own. */
export function showsConsent({
  status,
  hasFacePhoto,
  takesFace,
  npc,
}: {
  status: AiPhotoClientStatus | null
  hasFacePhoto: boolean
  takesFace: boolean
  npc: boolean
}): boolean {
  return Boolean(status?.available && status.faceAllowed && hasFacePhoto && takesFace && !npc)
}

/** How far the bar is after `seconds`: eases towards 90% (most answers take 15–90 s). */
export const progressAt = (seconds: number) => 0.9 * (1 - Math.exp(-Math.max(0, seconds) / 35))

export const progressText = (seconds: number) =>
  seconds < 2 ? '캐릭터를 찍고 있어요…' : 'AI가 실사 사진으로 만들고 있어요… 보통 15~90초 걸려요'

/** A run of copy: plain text, or an environment variable's name (set in code type). */
export type CopyPart = { text: string } | { code: string }

const t = (text: string): CopyPart => ({ text })
const c = (code: string): CopyPart => ({ code })

export type UnavailableReason =
  | 'disabled'
  | 'not_configured'
  | 'no_api_key'
  | 'moderation_required'
  | 'network'

/** Why AI photos are off, with what to set up where that's the reason. */
export function unavailableCopy(reason: UnavailableReason): CopyPart[] {
  switch (reason) {
    case 'disabled':
      return [t('관리자가 AI 실사 사진을 꺼 두었어요.')]
    case 'not_configured':
    case 'no_api_key':
      return [
        t('AI 실사 사진은 서버 설정이 필요해요. 서버 환경 변수 '),
        c('AI_PHOTO_PROVIDER'),
        t('(openai 또는 gemini), '),
        c('AI_PHOTO_MODEL'),
        t(', '),
        c('AI_PHOTO_API_KEY'),
        t('를 넣고 다시 시작해 주세요. 자세한 설명은 '),
        c('.env.example'),
        t('에 있어요.'),
      ]
    case 'moderation_required':
      return [
        t('이 설정에서는 이미지 검사 모델('),
        c('AI_PHOTO_MODERATION_MODEL'),
        t(')이 함께 필요해요.'),
      ]
    case 'network':
      return [t('AI 사진 서버에 연결하지 못했어요.')]
  }
}

/** Where a request stands: none yet, on its way, or answered. */
export type AiPhotoRequestState =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'done'; result: AiPhotoResult }

export type AiPhotoView =
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: UnavailableReason; retry: boolean }
  | { kind: 'blocked'; message: string }
  | { kind: 'ready' }
  | { kind: 'generating' }
  | { kind: 'result'; remainingToday: number | null }
  | { kind: 'error'; message: string; retryAfter: number | null }

/** What the dialog shows, from the route's status (null while asking) and the request. */
export function aiPhotoView(
  status: AiPhotoClientStatus | null,
  context: { child: boolean; request: AiPhotoRequestState },
): AiPhotoView {
  if (!status) return { kind: 'loading' }
  if (!status.available) {
    return { kind: 'unavailable', reason: status.reason, retry: status.reason === 'network' }
  }
  if (status.signInRequired && !status.signedIn) {
    return { kind: 'blocked', message: AI_PHOTO_ERROR_TEXT.sign_in_required }
  }
  if (context.child && !status.childAllowed) {
    return { kind: 'blocked', message: AI_PHOTO_ERROR_TEXT.child_not_allowed }
  }
  const { request } = context
  if (request.kind === 'generating') return { kind: 'generating' }
  if (request.kind === 'done') {
    const { result } = request
    if (result.ok) return { kind: 'result', remainingToday: result.remainingToday }
    return {
      kind: 'error',
      message: aiPhotoErrorText(result),
      retryAfter: result.code === 'rate_limited' ? (result.retryAfter ?? null) : null,
    }
  }
  return { kind: 'ready' }
}
