'use client'

import { Copy, Download, ExternalLink, Globe2, Laptop, Loader2, MonitorUp, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { getStudioAuthHeaders } from '@/lib/auth-client'

type PublishResult = { playUrl: string; version: number }

export function ExportCenter({ sceneId, sceneName }: { sceneId: string; sceneName: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'web' | 'mac' | 'windows' | null>(null)
  const [published, setPublished] = useState<PublishResult | null>(null)
  const [buildMessage, setBuildMessage] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  const waitForBuild = async (platform: 'macos' | 'windows', jobId: string) => {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 5000))
      const response = await fetch(
        `/api/scenes/${sceneId}/runtime-build?platform=${platform}&jobId=${encodeURIComponent(jobId)}`,
        { cache: 'no-store', headers: await getStudioAuthHeaders() },
      )
      const result = (await response.json()) as {
        status?: string
        downloadUrl?: string
        error?: string
      }
      if (result.status === 'complete' && result.downloadUrl) {
        setDownloadUrl(result.downloadUrl)
        setBuildMessage(`${platform === 'macos' ? 'macOS' : 'Windows'} 빌드 완료`)
        return
      }
      if (result.status === 'failed') {
        setBuildMessage(result.error ?? '실행 파일 빌드에 실패했습니다.')
        return
      }
      setBuildMessage(
        `${platform === 'macos' ? 'macOS' : 'Windows'} 빌드 ${result.status === 'running' ? '진행 중' : '대기 중'}…`,
      )
    }
    setBuildMessage('빌드가 아직 진행 중입니다. 이 창을 열어 두면 계속 확인합니다.')
  }

  const publishWeb = async () => {
    setBusy('web')
    try {
      const response = await fetch(`/api/scenes/${sceneId}/publish`, {
        method: 'POST',
        headers: await getStudioAuthHeaders(),
      })
      if (!response.ok) throw new Error('웹 게시에 실패했습니다')
      setPublished((await response.json()) as PublishResult)
    } finally {
      setBusy(null)
    }
  }

  const buildRuntime = async (platform: 'macos' | 'windows') => {
    setBusy(platform === 'macos' ? 'mac' : 'windows')
    setBuildMessage(null)
    setDownloadUrl(null)
    try {
      const response = await fetch(`/api/scenes/${sceneId}/runtime-build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getStudioAuthHeaders()) },
        body: JSON.stringify({ platform, quality: 'ultra' }),
      })
      const result = (await response.json()) as {
        error?: string
        message?: string
        jobId?: string
        downloadUrl?: string
      }
      setDownloadUrl(result.downloadUrl ?? null)
      setBuildMessage(
        response.ok
          ? `${platform === 'macos' ? 'macOS' : 'Windows'} 빌드 대기 중${result.jobId ? ` · ${result.jobId}` : ''}`
          : (result.message ??
              (result.error === 'forbidden'
                ? '이 프로젝트의 소유자 계정으로 다시 로그인하세요.'
                : result.error === 'builder_not_configured'
                  ? `${platform} 빌드 서비스가 설정되지 않았습니다.`
                  : `실행 파일 빌드 실패: ${result.error ?? response.status}`)),
      )
      if (response.ok && result.jobId && !result.downloadUrl) {
        await waitForBuild(platform, result.jobId)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <button
        aria-label="내보내기"
        className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-[#f5f5f5]/95 text-[#6b6b6b] shadow-[0_2px_8px_rgba(0,0,0,0.15)] backdrop-blur-md transition-colors hover:bg-white hover:text-[#333] dark:bg-neutral-900/90 dark:text-neutral-300 dark:hover:bg-neutral-800"
        onClick={() => setOpen(true)}
        title="내보내기"
        type="button"
      >
        <Download className="size-5" strokeWidth={1.5} />
      </button>
      {/* Portaled: the trigger sits in the top-right cluster's stacking
          context, under the tool bar and the build panel. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-foreground/10 bg-sidebar text-foreground shadow-2xl">
              <header className="flex items-start justify-between border-foreground/8 border-b px-6 py-5">
                <div>
                  <p className="text-foreground/45 text-[10px] uppercase tracking-[0.18em]">
                    플레이 내보내기
                  </p>
                  <h2 className="mt-1 font-semibold text-xl">{sceneName} 게시</h2>
                  <p className="mt-1 text-foreground/55 text-sm">
                    편집 도구는 어떤 결과물에도 포함되지 않습니다.
                  </p>
                </div>
                <button
                  aria-label="닫기"
                  className="rounded-lg p-2 text-foreground/55 hover:bg-foreground/8 hover:text-foreground"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="grid gap-4 p-6 md:grid-cols-3">
                <section className="rounded-2xl border border-foreground/9 bg-foreground/[0.035] p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400/12 text-emerald-300">
                    <Globe2 className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-semibold text-lg">웹 게시</h3>
                  <p className="mt-2 min-h-12 text-foreground/55 text-sm leading-6">
                    구성 선택과 둘러보기가 가능한 공유용 플레이 링크를 만듭니다.
                  </p>
                  {published ? (
                    <div className="mt-5 rounded-xl bg-black/25 p-3">
                      <p className="truncate text-emerald-300 text-xs">{published.playUrl}</p>
                      <div className="mt-3 flex gap-2">
                        <button
                          className="flex items-center gap-1.5 rounded-lg bg-foreground/8 px-3 py-2 text-xs"
                          onClick={() => navigator.clipboard.writeText(published.playUrl)}
                          type="button"
                        >
                          <Copy className="h-3.5 w-3.5" /> 복사
                        </button>
                        <a
                          className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 font-semibold text-black text-xs dark:bg-neutral-900 dark:text-white"
                          href={published.playUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> 열기
                        </a>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 font-semibold text-[#102018] text-sm disabled:opacity-60"
                      disabled={busy !== null}
                      onClick={publishWeb}
                      type="button"
                    >
                      {busy === 'web' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Globe2 className="h-4 w-4" />
                      )}{' '}
                      웹에 게시
                    </button>
                  )}
                </section>
                <section className="rounded-2xl border border-foreground/9 bg-foreground/[0.035] p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-400/12 text-blue-300">
                    <MonitorUp className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-semibold text-lg">macOS 실행 파일</h3>
                  <p className="mt-2 min-h-12 text-foreground/55 text-sm leading-6">
                    장면과 프로젝트 에셋을 담은 오프라인 플레이 앱을 빌드합니다.
                  </p>
                  <button
                    className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-400 font-semibold text-[#101820] text-sm disabled:opacity-60"
                    disabled={busy !== null}
                    onClick={() => buildRuntime('macos')}
                    type="button"
                  >
                    {busy === 'mac' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MonitorUp className="h-4 w-4" />
                    )}{' '}
                    macOS 앱 빌드
                  </button>
                  {buildMessage && (
                    <p className="mt-3 text-amber-200/80 text-xs leading-5">{buildMessage}</p>
                  )}
                </section>
                <section className="rounded-2xl border border-foreground/9 bg-foreground/[0.035] p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-400/12 text-violet-300">
                    <Laptop className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-semibold text-lg">Windows 실행 파일</h3>
                  <p className="mt-2 min-h-12 text-foreground/55 text-sm leading-6">
                    같은 구성 선택 런타임으로 독립 실행형 Windows 플레이 파일을 빌드합니다.
                  </p>
                  <button
                    className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-400 font-semibold text-[#171020] text-sm disabled:opacity-60"
                    disabled={busy !== null}
                    onClick={() => buildRuntime('windows')}
                    type="button"
                  >
                    {busy === 'windows' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Laptop className="h-4 w-4" />
                    )}
                    Windows 앱 빌드
                  </button>
                </section>
              </div>
              {downloadUrl ? (
                <div className="px-6 pb-6">
                  <a
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white font-semibold text-black text-sm dark:bg-neutral-900 dark:text-white"
                    href={downloadUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="h-4 w-4" />
                    실행 파일 내려받기
                  </a>
                </div>
              ) : null}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
