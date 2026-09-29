'use client'

import { useItemScreens } from '@pascal-app/nodes'
import {
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { useEffect, useMemo } from 'react'
import { getFirebaseAuth, getFirebaseFirestore } from '@/lib/firebase-client'
import { downloadDeck, uploadDeck } from '@/lib/shared-decks'
import { applyWorldEntry, readWorld, sharedDecks } from '@/lib/world-state'
import { type WorldEntries, WorldSync } from '@/lib/world-sync'

/** How often this player's world is checked for changes to share. */
const TICK_MS = 250
/** Firestore takes about one write a second per document: changes are gathered up to this. */
const MIN_WRITE_GAP_MS = 700
/** A participant not seen for this long has left without saying so. */
const GONE_AFTER_MS = 90_000

/**
 * The first one in: the world the last visit left (doors open, a deck on the
 * TV) is cleared, so every visit starts from the scene as built.
 */
async function resetIfAlone(db: Firestore, sceneId: string, userId: string) {
  const participants = await getDocs(collection(db, 'runtimeSessions', sceneId, 'participants'))
  const others = participants.docs.filter((participant) => {
    const seen = participant.data().lastSeenAt?.toMillis?.() as number | undefined
    return participant.id !== userId && seen !== undefined && Date.now() - seen < GONE_AFTER_MS
  })
  if (others.length > 0) return
  const state = await getDocs(collection(db, 'runtimeSessions', sceneId, 'state'))
  await Promise.all(state.docs.map((entry) => deleteDoc(entry.ref)))
}

/**
 * Shares the game world between the session's players: the time and the
 * weather, doors, windows and cabinets, lamps and light switches, and what the
 * TVs show. Presentation pages are shared as a deck the others download.
 */
export function RuntimeWorldSync({ sceneId, enabled }: { sceneId: string; enabled: boolean }) {
  const auth = useMemo(() => getFirebaseAuth(), [])
  const db = useMemo(() => getFirebaseFirestore(), [])
  const user = auth?.currentUser ?? null

  useEffect(() => {
    if (!enabled || !db || !user) return
    const worldRef = doc(db, 'runtimeSessions', sceneId, 'state', 'world')
    const decks = new Map<string, Promise<string[]>>()
    const loadDeck = (deck: string, count: number) => {
      let pages = decks.get(deck)
      if (!pages) {
        pages = downloadDeck(db, sceneId, deck, count)
        decks.set(deck, pages)
        pages.catch(() => decks.delete(deck))
      }
      return pages
    }
    const sync = new WorldSync(readWorld, (key, value) => applyWorldEntry(key, value, loadDeck))
    const uploading = new WeakSet<readonly string[]>()
    let pending: WorldEntries = {}
    let lastWrite = 0
    let stopped = false
    let unsubscribe = () => {}

    // Slides put on a TV here are shared as a deck before their entry says which.
    const shareDecks = () => {
      for (const screen of Object.values(useItemScreens.getState().screens)) {
        const content = screen.content
        if (content.kind !== 'slides') continue
        const pages = content.pages
        if (sharedDecks.has(pages) || uploading.has(pages)) continue
        uploading.add(pages)
        uploadDeck(db, sceneId, pages).then(
          (deck) => sharedDecks.set(pages, deck),
          () => {},
        )
      }
    }

    const tick = window.setInterval(() => {
      shareDecks()
      Object.assign(pending, sync.tick())
      if (Object.keys(pending).length === 0 || Date.now() - lastWrite < MIN_WRITE_GAP_MS) return
      const entries = pending
      pending = {}
      lastWrite = Date.now()
      void setDoc(
        worldRef,
        { entries, updatedBy: user.uid, updatedAt: serverTimestamp() },
        { merge: true },
      )
    }, TICK_MS)

    resetIfAlone(db, sceneId, user.uid)
      .catch(() => {})
      .then(() => {
        if (stopped) return
        unsubscribe = onSnapshot(worldRef, (snapshot) => {
          sync.receive({ ...((snapshot.data()?.entries as WorldEntries | undefined) ?? {}) })
        })
      })

    return () => {
      stopped = true
      window.clearInterval(tick)
      unsubscribe()
    }
  }, [db, enabled, sceneId, user])

  return null
}
