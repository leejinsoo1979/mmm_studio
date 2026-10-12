import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const USER_ID_HEADER = 'x-mmm-user-id'

function adminAuth() {
  const app =
    getApps()[0] ??
    initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'mmm-studio-7a14c' })
  return getAuth(app)
}

/** The uid of a verified Firebase ID token, never the development user header. */
export async function getFirebaseVerifiedUserId(request: Request): Promise<string | null> {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null
  try {
    return (await adminAuth().verifyIdToken(token)).uid
  } catch {
    return null
  }
}

export async function getVerifiedRequestStudioUserId(request: Request): Promise<string | null> {
  if (/^Bearer\s+\S/i.test(request.headers.get('authorization') ?? '')) {
    return getFirebaseVerifiedUserId(request)
  }
  return process.env.NODE_ENV === 'production' ? null : getRequestStudioUserId(request)
}

export function getRequestStudioUserId(request: Request): string | null {
  const raw = request.headers.get(USER_ID_HEADER)?.trim()
  if (!raw) return null
  if (raw.length > 128) return null
  if (!/^[A-Za-z0-9:_@./-]+$/.test(raw)) return null
  return raw
}

export function canAccessOwnedResource(ownerId: string | null, userId: string | null): boolean {
  if (!ownerId) return true
  return ownerId === userId
}
