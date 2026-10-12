'use client'

import { aiCharacters, type PhotorealCharacter } from '@pascal-app/editor'
import { useEffect, useState } from 'react'
import { observeFirebaseUser } from '@/lib/firebase-client'
import { photorealAiClient } from '@/lib/photoreal-ai/client'
import { onAvatarJobFinished } from './ai-person-jobs'

/**
 * The user's finished AI 인물 as 실사 characters, listed once for every
 * gallery on the page and listed again when one is added or deleted or the
 * signed-in user changes. A listing that could not be had (signed out yet,
 * refused, offline) shows none and is not kept: the next gallery asks again.
 */

let listing: Promise<PhotorealCharacter[]> | null = null
const listingReaders = new Set<() => void>()

function loadAiPeople(): Promise<PhotorealCharacter[]> {
  if (listing) return listing
  const asked: Promise<PhotorealCharacter[]> = photorealAiClient()
    .avatars()
    .then((avatars) => {
      if (avatars === null && listing === asked) listing = null
      return aiCharacters(avatars ?? [])
    })
  listing = asked
  return asked
}

/** Lists the AI 인물 again (one was added or deleted, or the user changed), for every gallery showing them. */
export function reloadAiPeople(): Promise<PhotorealCharacter[]> {
  listing = null
  const next = loadAiPeople()
  for (const read of listingReaders) read()
  return next
}

onAvatarJobFinished((job) => {
  if (job.state === 'done') void reloadAiPeople()
})

/** The user's AI 인물 (none when signed out), null while the list first loads. */
export function useAiPeople(): PhotorealCharacter[] | null {
  const [people, setPeople] = useState<PhotorealCharacter[] | null>(null)
  useEffect(() => {
    let current = true
    const read = () => {
      const asked = loadAiPeople()
      asked.then((found) => {
        // An older list answering late is not shown over a newer one.
        if (current && (asked === listing || listing === null)) setPeople(found)
      })
    }
    read()
    listingReaders.add(read)
    // Signing in or out (or Firebase restoring the user after a reload) changes whose list it is.
    let first = true
    const stop = observeFirebaseUser(() => {
      if (first) {
        first = false
        return
      }
      void reloadAiPeople()
    })
    return () => {
      current = false
      listingReaders.delete(read)
      stop()
    }
  }, [])
  return people
}

/** Deletes one of the user's AI 인물; whether it is gone. */
export async function deleteAiPerson(avatarId: string): Promise<boolean> {
  const deleted = await photorealAiClient().deleteAvatar(avatarId)
  if (deleted) void reloadAiPeople()
  return deleted
}
