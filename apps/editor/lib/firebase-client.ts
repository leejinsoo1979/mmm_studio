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

const defaultFirebaseConfig = {
  apiKey: 'AIzaSyA-lpDfDYDUbjKHnmabVwjICN33eMB-PNI',
  authDomain: 'mmm-studio-7a14c.firebaseapp.com',
  projectId: 'mmm-studio-7a14c',
  storageBucket: 'mmm-studio-7a14c.firebasestorage.app',
  messagingSenderId: '864501140667',
  appId: '1:864501140667:web:9d28b3a785cb0cd44c2d9e',
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? defaultFirebaseConfig.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? defaultFirebaseConfig.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? defaultFirebaseConfig.projectId,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? defaultFirebaseConfig.storageBucket,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??
    defaultFirebaseConfig.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? defaultFirebaseConfig.appId,
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
