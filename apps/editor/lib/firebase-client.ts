import { type FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app'
import {
  type Auth,
  GithubAuthProvider,
  GoogleAuthProvider,
  getAuth,
  OAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  )
}

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp()
  return app ? getAuth(app) : null
}

function providerForFirebase(provider: 'google' | 'github' | 'kakao' | 'apple') {
  switch (provider) {
    case 'google':
      return new GoogleAuthProvider()
    case 'github':
      return new GithubAuthProvider()
    case 'apple':
      return new OAuthProvider('apple.com')
    case 'kakao':
      return new OAuthProvider('oidc.kakao')
  }
}

export async function signInWithFirebaseProvider(
  provider: 'google' | 'github' | 'kakao' | 'apple',
): Promise<User | null> {
  const auth = getFirebaseAuth()
  if (!auth) return null
  const result = await signInWithPopup(auth, providerForFirebase(provider))
  return result.user
}

export async function signOutFirebase(): Promise<void> {
  const auth = getFirebaseAuth()
  if (!auth) return
  await signOut(auth)
}

export function observeFirebaseUser(callback: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth()
  if (!auth) {
    callback(null)
    return () => {}
  }
  return onAuthStateChanged(auth, callback)
}
