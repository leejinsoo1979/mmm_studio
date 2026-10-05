import { describe, expect, test } from 'bun:test'
import type { AiPhotoClientStatus } from '@/lib/ai-photo/client'
import {
  aiPhotoView,
  defaultFraming,
  labelBox,
  progressAt,
  progressText,
  showsConsent,
  stampedName,
  unavailableCopy,
} from './ai-photo-label'

const READY: AiPhotoClientStatus = {
  available: true,
  signInRequired: true,
  signedIn: true,
  remainingToday: 4,
  maxImageBytes: 2 * 1024 * 1024,
  faceAllowed: true,
  childAllowed: false,
}

const idle = { kind: 'idle' } as const

describe('the label pill', () => {
  test('sits 3% of the short side in from the bottom-left', () => {
    const box = labelBox(1024, 1536, 100)
    expect(box.x).toBe(31)
    expect(box.y + box.height).toBe(1536 - 31)
    expect(box.fontSize).toBe(29)
    expect(box.radius).toBe(box.height / 2)
    expect(box.width).toBe(100 + 2 * Math.round(29 * 0.6))
    expect(box.textY).toBe(box.y + box.height / 2)
  })

  test('the font never drops under 14 px', () => {
    expect(labelBox(256, 256).fontSize).toBe(14)
    expect(labelBox(1024, 1024).fontSize).toBe(29)
  })

  test('guesses the text width when it can’t be measured', () => {
    const box = labelBox(1024, 1024)
    expect(box.width).toBeGreaterThan(box.fontSize * 6)
    expect(box.x + box.width).toBeLessThan(1024 / 2)
  })
})

describe('file names', () => {
  test('are stamped with the local date and time', () => {
    const date = new Date(2026, 9, 5, 9, 4, 7)
    expect(stampedName('mmm-ai-photo', 'jpg', date)).toBe('mmm-ai-photo-20261005-090407.jpg')
    expect(stampedName('mmm-studio', 'png', date)).toBe('mmm-studio-20261005-090407.png')
  })
})

describe('the dialog’s state', () => {
  test('loading until the status answers', () => {
    expect(aiPhotoView(null, { child: false, request: idle })).toEqual({ kind: 'loading' })
  })

  test('unavailable, with a retry only for the network', () => {
    expect(
      aiPhotoView({ available: false, reason: 'no_api_key' }, { child: false, request: idle }),
    ).toEqual({
      kind: 'unavailable',
      reason: 'no_api_key',
      retry: false,
    })
    expect(
      aiPhotoView({ available: false, reason: 'network' }, { child: false, request: idle }),
    ).toEqual({
      kind: 'unavailable',
      reason: 'network',
      retry: true,
    })
  })

  test('blocked when signed out where sign-in is needed, or for a child', () => {
    const signedOut = { ...READY, signedIn: false }
    expect(aiPhotoView(signedOut, { child: false, request: idle })).toEqual({
      kind: 'blocked',
      message: '로그인하면 AI 실사 사진을 만들 수 있어요.',
    })
    expect(
      aiPhotoView({ ...signedOut, signInRequired: false }, { child: false, request: idle }).kind,
    ).toBe('ready')
    expect(aiPhotoView(READY, { child: true, request: idle }).kind).toBe('blocked')
    expect(aiPhotoView({ ...READY, childAllowed: true }, { child: true, request: idle }).kind).toBe(
      'ready',
    )
  })

  test('generating, then the result or the error', () => {
    expect(aiPhotoView(READY, { child: false, request: { kind: 'generating' } })).toEqual({
      kind: 'generating',
    })
    const image = new Blob([])
    expect(
      aiPhotoView(READY, {
        child: false,
        request: { kind: 'done', result: { ok: true, image, remainingToday: 3 } },
      }),
    ).toEqual({ kind: 'result', remainingToday: 3 })
    expect(
      aiPhotoView(READY, {
        child: false,
        request: { kind: 'done', result: { ok: false, code: 'aborted' } },
      }),
    ).toEqual({ kind: 'error', message: '사진 만들기를 취소했어요.', retryAfter: null })
    expect(
      aiPhotoView(READY, {
        child: false,
        request: {
          kind: 'done',
          result: { ok: false, code: 'rate_limited', retryAfter: 30, scope: 'burst' },
        },
      }),
    ).toEqual({ kind: 'error', message: '잠시 뒤에 다시 만들어 주세요.', retryAfter: 30 })
  })
})

describe('the consent box', () => {
  const base = { status: READY, hasFacePhoto: true, takesFace: true, npc: false }
  test('shows only when every condition holds', () => {
    expect(showsConsent(base)).toBe(true)
    expect(showsConsent({ ...base, status: { ...READY, faceAllowed: false } })).toBe(false)
    expect(showsConsent({ ...base, status: { available: false, reason: 'disabled' } })).toBe(false)
    expect(showsConsent({ ...base, status: null })).toBe(false)
    expect(showsConsent({ ...base, hasFacePhoto: false })).toBe(false)
    expect(showsConsent({ ...base, takesFace: false })).toBe(false)
    expect(showsConsent({ ...base, npc: true })).toBe(false)
  })
})

describe('copy and progress', () => {
  test('the setup copy names the environment variables as code', () => {
    const parts = unavailableCopy('not_configured')
    const codes = parts.flatMap((part) => ('code' in part ? [part.code] : []))
    expect(codes).toEqual([
      'AI_PHOTO_PROVIDER',
      'AI_PHOTO_MODEL',
      'AI_PHOTO_API_KEY',
      '.env.example',
    ])
    expect(unavailableCopy('no_api_key')).toEqual(parts)
    expect(unavailableCopy('disabled')).toEqual([{ text: '관리자가 AI 실사 사진을 꺼 두었어요.' }])
  })

  test('the bar eases towards 90% and the text changes after two seconds', () => {
    expect(progressAt(0)).toBe(0)
    expect(progressAt(35)).toBeCloseTo(0.9 * (1 - Math.exp(-1)), 6)
    expect(progressAt(10_000)).toBeLessThanOrEqual(0.9)
    expect(progressText(1)).toBe('캐릭터를 찍고 있어요…')
    expect(progressText(3)).toContain('보통 15~90초')
  })

  test('the framing follows the camera', () => {
    expect(defaultFraming('face')).toBe('face')
    expect(defaultFraming('hair')).toBe('face')
    expect(defaultFraming('full')).toBe('full')
    expect(defaultFraming('upper')).toBe('upper')
  })
})
