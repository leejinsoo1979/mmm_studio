'use client'

import { useSyncExternalStore } from 'react'
import {
  AVATAR_JOB_STORAGE_KEY,
  type AvatarJob,
  type AvatarJobTracker,
  createAvatarJobTracker,
} from '@/lib/photoreal-ai/avatar-job'
import { photorealAiClient } from '@/lib/photoreal-ai/client'

/**
 * The page's one AI 인물 3D job, followed whether or not the studio is open
 * (the app's layout picks a kept one up on any page, see client-bootstrap).
 * Kept free of the editor package so that pick-up costs every page little.
 */

const finishedListeners = new Set<(job: AvatarJob) => void>()
let tracker: AvatarJobTracker | null = null

export function avatarJobs(): AvatarJobTracker {
  if (!tracker) {
    const client = photorealAiClient()
    tracker = createAvatarJobTracker({
      start: (image, token) => client.startAvatar(image, token),
      poll: (jobId) => client.avatarJob(jobId),
      storage: {
        read: () => window.localStorage.getItem(AVATAR_JOB_STORAGE_KEY),
        write: (value) =>
          value === null
            ? window.localStorage.removeItem(AVATAR_JOB_STORAGE_KEY)
            : window.localStorage.setItem(AVATAR_JOB_STORAGE_KEY, value),
      },
      onFinished: (job) => {
        for (const listener of finishedListeners) listener(job)
      },
    })
  }
  return tracker
}

/** Hears each job end (a new AI 인물 is listed now, or it failed). */
export function onAvatarJobFinished(listener: (job: AvatarJob) => void): () => void {
  finishedListeners.add(listener)
  return () => {
    finishedListeners.delete(listener)
  }
}

const serverJob = () => null

/** The job as it stands (null when there is none). */
export function useAvatarJob(): AvatarJob | null {
  const jobs = avatarJobs()
  return useSyncExternalStore(jobs.subscribe, jobs.get, serverJob)
}
