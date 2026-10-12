import { describe, expect, test } from 'bun:test'
import { parseExtraParams } from '../ai-photo/config'
import { sniffImage } from '../ai-photo/image-header'
import { readAiPhotoResponse } from '../ai-photo/provider'
import { base64Of, jpeg, png, webp } from '../ai-photo/test-images'
import { mockPortraitPng } from './mock-portrait'
import { checkNotes } from './notes-check'
import { portraitImage } from './portrait'
import { aiPortraitRequest } from './portrait-provider'
import { portraitSha, signPortrait, verifyPortrait } from './portrait-token'
import { AI_PORTRAIT_SAFETY_RULES, buildAiPortraitPrompt } from './prompt'
import {
  AI_PERSON_AGES,
  AI_PERSON_DEFAULTS,
  AI_PERSON_HAIR_STYLES,
  AI_PERSON_LABELS,
  AI_PERSON_SEXES,
  AVATAR_JOB_ERROR_TEXT,
  AVATAR_JOB_STAGE_TEXT,
  PHOTOREAL_AI_ERROR_TEXT,
  photorealAiErrorText,
} from './shared'

describe('buildAiPortraitPrompt', () => {
  test('every sex × age × hair names a fictional adult and ends with the safety rules', () => {
    for (const sex of AI_PERSON_SEXES) {
      for (const age of AI_PERSON_AGES) {
        for (const hairStyle of AI_PERSON_HAIR_STYLES) {
          const prompt = buildAiPortraitPrompt({ ...AI_PERSON_DEFAULTS, sex, age, hairStyle })
          expect(prompt).toContain(`fictional adult ${sex === 'female' ? 'woman' : 'man'}`)
          expect(prompt).toContain('mouth closed with the lips together')
          expect(prompt).toContain('no glasses')
          const rules = prompt.slice(prompt.indexOf(AI_PORTRAIT_SAFETY_RULES[0]))
          expect(rules).toContain('clearly an adult aged')
          for (const rule of AI_PORTRAIT_SAFETY_RULES) expect(rules).toContain(rule)
          expect(prompt).not.toContain('<notes>')
          expect(prompt).not.toContain('undefined')
        }
      }
    }
  })

  test('20대 is held to 23 and over', () => {
    expect(buildAiPortraitPrompt({ ...AI_PERSON_DEFAULTS, age: '20s' })).toContain(
      'Never make them look younger than 23.',
    )
  })

  test('checked notes go in their fence, before the safety rules', () => {
    const notes = checkNotes('왼쪽 눈 밑에 작은 점')
    if (!notes.ok) throw new Error('refused')
    const prompt = buildAiPortraitPrompt({ ...AI_PERSON_DEFAULTS, notes: notes.notes })
    expect(prompt).toContain('<notes>왼쪽 눈 밑에 작은 점</notes>')
    expect(prompt.indexOf('<notes>')).toBeLessThan(prompt.indexOf(AI_PORTRAIT_SAFETY_RULES[0]))
  })

  test('facial hair only for men; a shaved head has no colour', () => {
    const woman = buildAiPortraitPrompt({ ...AI_PERSON_DEFAULTS, facialHair: 'shortBeard' })
    expect(woman).not.toContain('beard')
    const man = buildAiPortraitPrompt({
      ...AI_PERSON_DEFAULTS,
      sex: 'male',
      facialHair: 'shortBeard',
      hairStyle: 'shaved',
    })
    expect(man).toContain('neatly trimmed beard')
    expect(man).toContain('- Hair: a cleanly shaved head. The hair')
  })
})

describe('Korean copy', () => {
  test('every choice, error, stage and job error has Korean text', () => {
    const texts = [
      ...Object.values(AI_PERSON_LABELS).flatMap((labels) => Object.values(labels)),
      ...Object.values(PHOTOREAL_AI_ERROR_TEXT),
      ...Object.values(AVATAR_JOB_ERROR_TEXT),
      ...Object.values(AVATAR_JOB_STAGE_TEXT),
    ]
    for (const text of texts) expect(text).toMatch(/[가-힣]/)
  })

  test('a spent daily allowance reads by step', () => {
    expect(photorealAiErrorText('rate_limited', { scope: 'daily', step: 'avatar' })).toContain(
      '3D 아바타',
    )
    expect(photorealAiErrorText('rate_limited', { scope: 'burst' })).toBe(
      PHOTOREAL_AI_ERROR_TEXT.rate_limited,
    )
  })
})

describe('aiPortraitRequest', () => {
  const base = { apiKey: 'sk-test', model: 'image-model' }

  test('openai: JSON to /images/generations, square, never a moderation field', () => {
    const extra = parseExtraParams('{"quality":"high","output_format":"jpeg"}')
    if (!extra) throw new Error('bad params')
    const { url, init } = aiPortraitRequest(
      { ...base, provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
      { prompt: 'P', extraParams: extra, user: 'tag' },
    )
    expect(url).toBe('https://api.openai.com/v1/images/generations')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body as string)).toEqual({
      quality: 'high',
      output_format: 'jpeg',
      model: 'image-model',
      prompt: 'P',
      n: 1,
      size: '1024x1024',
      user: 'tag',
    })
  })

  test('the extra params can not lower moderation or change the size', () => {
    expect(parseExtraParams('{"moderation":"low"}')).toBeNull()
    expect(parseExtraParams('{"size":"256x256"}')).toBeNull()
    expect(parseExtraParams('{"aspectRatio":"16:9"}')).toBeNull()
    expect(parseExtraParams('{"personGeneration":"ALLOW_ALL"}')).toBeNull()
  })

  test('gemini: text only, square, the AI 실사 사진 safety settings', () => {
    const { url, init } = aiPortraitRequest(
      { ...base, provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
      { prompt: 'P', extraParams: { imageSize: '1K' }, user: 'ignored' },
    )
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/image-model:generateContent',
    )
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'P' }] }])
    expect(body.generationConfig.imageConfig).toEqual({ imageSize: '1K', aspectRatio: '1:1' })
    expect(body.safetySettings).toHaveLength(4)
    expect(JSON.stringify(body)).not.toContain('ignored')
  })

  test('the existing reader takes generation answers', async () => {
    const image = jpeg(1024, 1024)
    const ok = new Response(JSON.stringify({ created: 1, data: [{ b64_json: base64Of(image) }] }))
    expect(await readAiPhotoResponse('openai', ok)).toMatchObject({ ok: true, type: 'image/jpeg' })
    const refused = new Response(
      JSON.stringify({
        error: { code: 'moderation_blocked', type: 'image_generation_user_error' },
      }),
      { status: 400 },
    )
    expect(await readAiPhotoResponse('openai', refused)).toMatchObject({
      ok: false,
      code: 'blocked',
    })
    const textOnly = new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'I can not.' }] }, finishReason: 'STOP' }],
      }),
    )
    expect(await readAiPhotoResponse('gemini', textOnly)).toMatchObject({
      ok: false,
      code: 'blocked',
    })
  })
})

describe('portraitImage', () => {
  test('JPEG or PNG, big enough, under the cap', () => {
    expect(portraitImage(jpeg(1024, 1024))).toMatchObject({
      ok: true,
      image: { type: 'image/jpeg' },
    })
    expect(portraitImage(png(768, 1024))).toMatchObject({ ok: true, image: { type: 'image/png' } })
    expect(portraitImage(jpeg(700, 1024))).toEqual({ ok: false, detail: 'too_small' })
    expect(portraitImage(webp(1024, 1024))).toEqual({ ok: false, detail: 'webp' })
    expect(portraitImage(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, detail: 'not_an_image' })
    expect(portraitImage(jpeg(1024, 1024, { pad: 4_000_001 }))).toEqual({
      ok: false,
      detail: 'too_large',
    })
  })
})

describe('portrait token', () => {
  const env = { AI_AVATAR_SECRET: 'test-secret' }
  const bytes = jpeg(1024, 1024)
  const claim = {
    sha: portraitSha(bytes),
    sex: 'female',
    age: '30s',
    hairStyle: 'bob',
    hairColour: 'darkBrown',
    outfit: 'knit',
    outfitColour: 'beige',
  } as const

  test('verifies for the same bytes and user', () => {
    const token = signPortrait(claim, 'uid-1', { env, now: 1000 })
    expect(verifyPortrait(token, bytes, 'uid-1', { env, now: 2000 })).toEqual({
      ok: true,
      claim,
      expires: 1000 + 30 * 60_000,
    })
  })

  test('refuses other bytes, another user, a changed claim, late, or another secret', () => {
    const token = signPortrait(claim, 'uid-1', { env, now: 1000 })
    expect(verifyPortrait(token, jpeg(1024, 1023), 'uid-1', { env, now: 2000 })).toEqual({
      ok: false,
      code: 'mismatch',
    })
    expect(verifyPortrait(token, bytes, 'uid-2', { env, now: 2000 })).toEqual({
      ok: false,
      code: 'invalid',
    })
    expect(verifyPortrait(token, bytes, 'uid-1', { env, now: 1000 + 31 * 60_000 })).toEqual({
      ok: false,
      code: 'expired',
    })
    const [, expires, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...claim, sex: 'male' })).toString('base64url')
    expect(verifyPortrait(`${forged}.${expires}.${mac}`, bytes, 'uid-1', { env }).ok).toBe(false)
    expect(
      verifyPortrait(token, bytes, 'uid-1', { env: { AI_AVATAR_SECRET: 'other' }, now: 2000 }).ok,
    ).toBe(false)
    expect(verifyPortrait('a.b', bytes, 'uid-1', { env }).ok).toBe(false)
    expect(verifyPortrait('x'.repeat(2000), bytes, 'uid-1', { env }).ok).toBe(false)
  })
})

describe('mockPortraitPng', () => {
  test('a real 1024² PNG, small, different per choice', () => {
    const a = mockPortraitPng(AI_PERSON_DEFAULTS)
    const b = mockPortraitPng({ ...AI_PERSON_DEFAULTS, skinTone: 'deep' })
    expect(sniffImage(a)).toEqual({ type: 'image/png', width: 1024, height: 1024 })
    expect(a.byteLength).toBeLessThan(100_000)
    expect(base64Of(a)).not.toBe(base64Of(b))
    expect(portraitImage(a).ok).toBe(true)
  })
})
