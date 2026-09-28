'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { getStudioAuthHeaders } from '@/lib/auth-client'
import { readSceneBackup, type SceneBackup } from '@/lib/scene-backup'

/**
 * The server has no scene with this id (a restart of an in-memory store, a
 * deleted row). The editor keeps a copy of every save in this browser, so
 * offer to put it back.
 */
export function SceneMissingCard({ sceneId }: { sceneId: string }) {
  const router = useRouter()
  const [backup, setBackup] = useState<SceneBackup | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setBackup(readSceneBackup(sceneId)), [sceneId])

  const restore = async () => {
    if (!backup) return
    setRestoring(true)
    setError(null)
    try {
      // PUT to a missing id recreates the scene under the same id.
      const response = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await getStudioAuthHeaders()) },
        body: JSON.stringify({ name: '복원한 장면', graph: backup.graph }),
      })
      if (!response.ok) throw new Error(String(response.status))
      router.refresh()
    } catch (reason) {
      setError(`복원하지 못했습니다 (${reason instanceof Error ? reason.message : reason}).`)
      setRestoring(false)
    }
  }

  const savedAt = backup ? new Date(backup.savedAt) : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#eaeaea] p-6">
      <div className="w-full max-w-md rounded-[14px] bg-[#f9f9f9] p-7 text-center shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
        <h1 className="font-semibold text-[#222] text-[18px]">장면을 찾을 수 없습니다</h1>
        <p className="mt-2 text-[#8a8a8a] text-[12px]">
          장면 ID <span className="font-mono">{sceneId}</span>
        </p>
        <p className="mt-3 text-[#555] text-[13px] leading-5">
          {backup
            ? '이 브라우저에 마지막으로 저장한 사본이 남아 있습니다.'
            : '이 브라우저에도 저장된 사본이 없습니다.'}
          {savedAt && !Number.isNaN(savedAt.getTime()) && (
            <span className="block text-[#8a8a8a] text-[12px] tabular-nums">
              {savedAt.toLocaleString('ko-KR')} 저장
            </span>
          )}
        </p>
        {error && <p className="mt-3 text-[#d63a3a] text-[12px]">{error}</p>}
        <div className="mt-6 flex flex-col items-center gap-2">
          {backup && (
            <button
              className="h-10 w-full rounded-full bg-[#3d8fe0] font-medium text-[14px] text-white transition-colors hover:bg-[#2f7fd0] disabled:opacity-60"
              disabled={restoring}
              onClick={() => void restore()}
              type="button"
            >
              {restoring ? '복원하는 중…' : '로컬 백업에서 복원'}
            </button>
          )}
          <div className="flex w-full gap-2">
            <Link
              className="flex h-10 flex-1 items-center justify-center rounded-full border border-[#d4d4d4] font-medium text-[#444] text-[13px] transition-colors hover:bg-white"
              href="/dashboard"
            >
              대시보드
            </Link>
            <Link
              className="flex h-10 flex-1 items-center justify-center rounded-full border border-[#d4d4d4] font-medium text-[#444] text-[13px] transition-colors hover:bg-white"
              href="/"
            >
              처음 화면
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
