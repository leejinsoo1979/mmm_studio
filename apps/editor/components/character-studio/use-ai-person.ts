'use client'

import { aiCharacters, type PhotorealCharacter } from '@pascal-app/editor'
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  type AvatarJob,
  type AvatarJobTracker,
  createAvatarJobTracker,
} from '@/lib/photoreal-ai/avatar-job'
import { photorealAiClient } from '@/lib/photoreal-ai/client'

/**
 * The page's AI 인물 state, outliving the dialog and the studio: the one 3D
 * job being built (kept in browser storage, so a reload finds it again) and
 * the user's finished AI 인물 as 실사 characters.
 */

/** Browser storage key of the 3D job. */
const JOB_KEY = 'mmm-ai-person-job'

let listing: Promise<PhotorealCharacter[]> | null = null
const listingReaders = new Set<() => void>()

function loadAiPeople(): Promise<PhotorealCharacter[]> {
  listing ??= photorealAiClient()
    .avatars()
    .then((avatars) => aiCharacters(avatars))
  return listing
}

/** Lists the AI 인물 again (one was added or deleted), for every gallery showing them. */
export function reloadAiPeople(): Promise<PhotorealCharacter[]> {
  listing = null
  const next = loadAiPeople()
  for (const read of listingReaders) read()
  return next
}

/** The user's AI 인물 (none when signed out), null while the list first loads. */
export function useAiPeople(): PhotorealCharacter[] | null {
  const [people, setPeople] = useState<PhotorealCharacter[] | null>(null)
  useEffect(() => {
    let current = true
    const read = () => {
      const asked = loadAiPeople()
      asked.then((found) => {
        // An older list answering late is not shown over a newer one.
        if (current && asked === listing) setPeople(found)
      })
    }
    read()
    listingReaders.add(read)
    return () => {
      current = false
      listingReaders.delete(read)
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

let tracker: AvatarJobTracker | null = null

/** The page's one AI 인물 3D job, followed whether or not the studio is open. */
export function avatarJobs(): AvatarJobTracker {
  if (!tracker) {
    const client = photorealAiClient()
    tracker = createAvatarJobTracker({
      start: (image, token) => client.startAvatar(image, token),
      poll: (jobId) => client.avatarJob(jobId),
      storage: {
        read: () => window.localStorage.getItem(JOB_KEY),
        write: (value) =>
          value === null
            ? window.localStorage.removeItem(JOB_KEY)
            : window.localStorage.setItem(JOB_KEY, value),
      },
      // A finished avatar is in the user's list now.
      onFinished: (job) => {
        if (job.state === 'done') void reloadAiPeople()
      },
    })
  }
  return tracker
}

const serverJob = () => null

/** The job as it stands (null when there is none). */
export function useAvatarJob(): AvatarJob | null {
  const jobs = avatarJobs()
  return useSyncExternalStore(jobs.subscribe, jobs.get, serverJob)
}
