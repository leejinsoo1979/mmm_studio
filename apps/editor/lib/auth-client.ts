import type { User as FirebaseUser } from 'firebase/auth'
import {
  getFirebaseAuth,
  isFirebaseConfigured,
  observeFirebaseUser,
  signInWithFirebaseProvider,
  signOutFirebase,
} from './firebase-client'

export type StudioAuthProvider = 'google' | 'github' | 'kakao' | 'apple' | 'email'

export type StudioUser = {
  id: string
  name: string
  email: string
  provider: StudioAuthProvider
  avatarInitials: string
  workspaceName: string
  source: 'firebase' | 'local'
  createdAt: string
  lastSeenAt: string
}

const AUTH_KEY = 'mmm-studio.auth.user.v1'

function fallbackId(): string {
  return `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const initials = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : name.slice(0, 2)
  return initials.toUpperCase()
}

function providerName(provider: StudioAuthProvider): string {
  switch (provider) {
    case 'google':
      return 'Google'
    case 'github':
      return 'GitHub'
    case 'kakao':
      return 'Kakao'
    case 'apple':
      return 'Apple'
    case 'email':
      return 'Email'
  }
}

function providerFromFirebaseId(providerId?: string | null): StudioAuthProvider {
  switch (providerId) {
    case 'google.com':
      return 'google'
    case 'github.com':
      return 'github'
    case 'apple.com':
      return 'apple'
    case 'oidc.kakao':
      return 'kakao'
    default:
      return 'email'
  }
}

export function studioUserFromFirebaseUser(user: FirebaseUser): StudioUser {
  const provider = providerFromFirebaseId(user.providerData[0]?.providerId)
  const name =
    user.displayName ||
    user.email
      ?.split('@')[0]
      ?.replace(/[._-]+/g, ' ')
      ?.replace(/\b\w/g, (char) => char.toUpperCase()) ||
    `${providerName(provider)} Member`
  const now = new Date().toISOString()
  return {
    id: user.uid,
    name,
    email: user.email ?? `${user.uid}@firebase.local`,
    provider,
    avatarInitials: initialsFromName(name),
    workspaceName: `${name.split(' ')[0]}'s workspace`,
    source: 'firebase',
    createdAt: user.metadata.creationTime
      ? new Date(user.metadata.creationTime).toISOString()
      : now,
    lastSeenAt: now,
  }
}

export function getStudioUser(): StudioUser | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(AUTH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StudioUser>
    if (!parsed.id || !parsed.email || !parsed.name || !parsed.provider) return null
    return parsed as StudioUser
  } catch {
    return null
  }
}

export function createStudioUser(provider: StudioAuthProvider, email?: string): StudioUser {
  const now = new Date().toISOString()
  const safeEmail =
    email?.trim() || `${provider === 'email' ? 'member' : provider}@mmm-studio.local`.toLowerCase()
  const name =
    provider === 'email'
      ? safeEmail
          .split('@')[0]!
          .replace(/[._-]+/g, ' ')
          .replace(/\b\w/g, (char) => char.toUpperCase())
      : `${providerName(provider)} Member`

  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : fallbackId(),
    name,
    email: safeEmail,
    provider,
    avatarInitials: initialsFromName(name),
    workspaceName: `${name.split(' ')[0]}'s workspace`,
    source: 'local',
    createdAt: now,
    lastSeenAt: now,
  }
}

export function saveStudioUser(user: StudioUser): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({
      ...user,
      lastSeenAt: new Date().toISOString(),
    }),
  )
}

export function clearStudioUser(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(AUTH_KEY)
}

export async function getStudioAuthHeaders(): Promise<Record<string, string>> {
  const firebaseUser = getFirebaseAuth()?.currentUser
  if (firebaseUser) {
    return {
      authorization: `Bearer ${await firebaseUser.getIdToken()}`,
      'x-mmm-auth-source': 'firebase',
      'x-mmm-user-id': firebaseUser.uid,
    }
  }

  const localUser = getStudioUser()
  if (!localUser) return {}
  return {
    'x-mmm-auth-source': localUser.source,
    'x-mmm-user-id': localUser.id,
  }
}

export function hasFirebaseAuthConfig(): boolean {
  return isFirebaseConfigured()
}

export async function signInStudioWithProvider(
  provider: Exclude<StudioAuthProvider, 'email'>,
): Promise<StudioUser> {
  const firebaseUser = await signInWithFirebaseProvider(provider)
  const studioUser = firebaseUser
    ? studioUserFromFirebaseUser(firebaseUser)
    : createStudioUser(provider)
  saveStudioUser(studioUser)
  return studioUser
}

export async function signInStudioWithEmail(email: string): Promise<StudioUser> {
  const studioUser = createStudioUser('email', email)
  saveStudioUser(studioUser)
  return studioUser
}

export async function signOutStudio(): Promise<void> {
  await signOutFirebase()
  clearStudioUser()
}

export function observeStudioUser(callback: (user: StudioUser | null) => void): () => void {
  const localUser = getStudioUser()
  if (localUser) callback(localUser)

  return observeFirebaseUser((firebaseUser) => {
    if (!firebaseUser) {
      callback(getStudioUser())
      return
    }
    const studioUser = studioUserFromFirebaseUser(firebaseUser)
    saveStudioUser(studioUser)
    callback(studioUser)
  })
}
