/**
 * Environment variable validation for the editor app.
 *
 * This file validates environment variables used by the standalone editor app.
 * Values are loaded from the repo root .env.local by package scripts.
 *
 * @see https://env.t3.gg/docs/nextjs
 */
import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  /**
   * Server-side environment variables (not exposed to client)
   */
  server: {
    // NPC AI chat (lib/npc-ai/config.ts). The model is the owner's choice, set here only.
    NPC_AI_PROVIDER: z.enum(['openai', 'anthropic']).optional(),
    NPC_AI_BASE_URL: z.url().optional(),
    NPC_AI_API_KEY: z.string().optional(),
    NPC_AI_MODEL: z.string().optional(),
    NPC_AI_ENABLED: z.enum(['true', 'false']).optional(),
    NPC_AI_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
    NPC_AI_REPLY_SECRET: z.string().optional(),
    // NPC server voice: an OpenAI-compatible /audio/speech endpoint.
    NPC_TTS_BASE_URL: z.url().optional(),
    NPC_TTS_API_KEY: z.string().optional(),
    NPC_TTS_MODEL: z.string().optional(),
    NPC_TTS_VOICE: z.string().optional(),
  },

  /**
   * Client-side environment variables (exposed to browser via NEXT_PUBLIC_)
   */
  client: {
    NEXT_PUBLIC_ASSETS_CDN_URL: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_API_KEY: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
    NEXT_PUBLIC_FIREBASE_APP_ID: z.string().optional(),
  },

  /**
   * Runtime values - pulls from process.env
   */
  runtimeEnv: {
    NPC_AI_PROVIDER: process.env.NPC_AI_PROVIDER,
    NPC_AI_BASE_URL: process.env.NPC_AI_BASE_URL,
    NPC_AI_API_KEY: process.env.NPC_AI_API_KEY,
    NPC_AI_MODEL: process.env.NPC_AI_MODEL,
    NPC_AI_ENABLED: process.env.NPC_AI_ENABLED,
    NPC_AI_DAILY_LIMIT: process.env.NPC_AI_DAILY_LIMIT,
    NPC_AI_REPLY_SECRET: process.env.NPC_AI_REPLY_SECRET,
    NPC_TTS_BASE_URL: process.env.NPC_TTS_BASE_URL,
    NPC_TTS_API_KEY: process.env.NPC_TTS_API_KEY,
    NPC_TTS_MODEL: process.env.NPC_TTS_MODEL,
    NPC_TTS_VOICE: process.env.NPC_TTS_VOICE,
    NEXT_PUBLIC_ASSETS_CDN_URL:
      process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? process.env.NEXT_PUBLIC_EDITOR_ASSETS_CDN_URL,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  },

  /**
   * Skip validation during build (env vars come from Vercel at runtime)
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,

  /**
   * .env.example lists the optional variables with empty values.
   */
  emptyStringAsUndefined: true,
})
