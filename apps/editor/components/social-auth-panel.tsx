'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { StudioAuthProvider } from '@/lib/auth-client'
import {
  hasFirebaseAuthConfig,
  signInStudioWithEmail,
  signInStudioWithProvider,
} from '@/lib/auth-client'

function safeNextPath(nextPath: string): string {
  if (!nextPath.startsWith('/') || nextPath.startsWith('//')) return '/dashboard'
  return nextPath
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px]" viewBox="0 0 24 24">
      <path
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.35Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.98-.9 6.63-2.42l-3.24-2.51c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.39 13.9A6 6 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.49l3.35-2.59Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.97c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z"
        fill="#EA4335"
      />
    </svg>
  )
}

export function SocialAuthPanel({ nextPath = '/dashboard' }: { nextPath?: string }) {
  const router = useRouter()
  const [busyProvider, setBusyProvider] = useState<StudioAuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)
  const targetPath = useMemo(() => safeNextPath(nextPath), [nextPath])
  const firebaseConfigured = hasFirebaseAuthConfig()

  const signIn = async (provider: StudioAuthProvider) => {
    setBusyProvider(provider)
    setError(null)
    try {
      if (provider === 'email') {
        await signInStudioWithEmail('member@mmm-studio.local')
      } else {
        await signInStudioWithProvider(provider)
      }
      router.push(targetPath)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusyProvider(null)
    }
  }

  return (
    <section className="flex min-h-screen items-center justify-center bg-[#050505] px-5 py-10 text-white">
      <div className="w-full max-w-[400px]">
        <Link className="mb-9 flex items-center justify-center gap-3.5" href="/">
          <Image
            alt=""
            aria-hidden="true"
            className="h-[13px] w-auto invert"
            height={23}
            priority
            src="/mmmlogo.svg"
            width={71}
          />
          <span className="font-[family-name:var(--font-barlow)] text-[22px] tracking-[0.09em]">
            mmm studio
          </span>
        </Link>

        <div className="rounded-[20px] border border-white/10 bg-[#101010] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-8">
          <div className="mb-8 text-center">
            <h1 className="font-medium text-[26px] tracking-[-0.035em]">Welcome back</h1>
            <p className="mt-2 text-[#8e8e8e] text-sm">Sign in to continue</p>
            {!firebaseConfigured && (
              <p className="mt-5 rounded-lg border border-amber-400/15 bg-amber-300/5 px-3 py-2 text-amber-200/70 text-xs leading-5">
                Firebase config is not set yet. Buttons will use a local demo session until the
                Firebase web app values are added.
              </p>
            )}
          </div>

          <button
            className="flex h-[52px] w-full items-center justify-center gap-3 rounded-xl bg-white px-4 font-medium text-[#181818] text-sm transition hover:bg-[#eeeeee] active:scale-[0.99] disabled:opacity-60"
            disabled={busyProvider !== null}
            onClick={() => signIn('google')}
            type="button"
          >
            <GoogleIcon />
            {busyProvider === 'google' ? 'Connecting...' : 'Continue with Google'}
          </button>

          {error && (
            <p className="mt-4 rounded-lg border border-red-400/20 bg-red-400/8 px-3 py-2 text-red-300 text-xs leading-5">
              {error}
            </p>
          )}

          <p className="mt-6 text-center text-[#666] text-[11px] leading-5">
            By continuing, you agree to the{' '}
            <Link className="text-[#999] transition hover:text-white" href="/terms">
              Terms
            </Link>{' '}
            and{' '}
            <Link className="text-[#999] transition hover:text-white" href="/privacy">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  )
}
