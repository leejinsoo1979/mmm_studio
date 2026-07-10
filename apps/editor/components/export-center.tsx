'use client'

import { Copy, ExternalLink, Globe2, Laptop, Loader2, MonitorUp, X } from 'lucide-react'
import { useState } from 'react'
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
        setBuildMessage(`${platform === 'macos' ? 'macOS' : 'Windows'} build complete`)
        return
      }
      if (result.status === 'failed') {
        setBuildMessage(result.error ?? 'Runtime build failed.')
        return
      }
      setBuildMessage(
        `${platform === 'macos' ? 'macOS' : 'Windows'} build ${result.status ?? 'queued'}…`,
      )
    }
    setBuildMessage(
      'Build is still running. You can keep this window open to continue tracking it.',
    )
  }

  const publishWeb = async () => {
    setBusy('web')
    try {
      const response = await fetch(`/api/scenes/${sceneId}/publish`, {
        method: 'POST',
        headers: await getStudioAuthHeaders(),
      })
      if (!response.ok) throw new Error('Web publishing failed')
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
        message?: string
        jobId?: string
        downloadUrl?: string
      }
      setDownloadUrl(result.downloadUrl ?? null)
      setBuildMessage(
        response.ok
          ? `${platform === 'macos' ? 'macOS' : 'Windows'} build queued${result.jobId ? ` · ${result.jobId}` : ''}`
          : (result.message ?? `${platform} build service is not configured.`),
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
        className="rounded-md bg-foreground px-3 py-1.5 font-semibold text-background text-xs hover:opacity-85"
        onClick={() => setOpen(true)}
        type="button"
      >
        Publish & Build
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#171a18] text-white shadow-2xl">
            <header className="flex items-start justify-between border-white/8 border-b px-6 py-5">
              <div>
                <p className="text-white/45 text-[10px] uppercase tracking-[0.18em]">Play export</p>
                <h2 className="mt-1 font-semibold text-xl">Publish {sceneName}</h2>
                <p className="mt-1 text-white/55 text-sm">
                  Editor tools are excluded from every output.
                </p>
              </div>
              <button
                className="rounded-lg p-2 text-white/55 hover:bg-white/8 hover:text-white"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="grid gap-4 p-6 md:grid-cols-3">
              <section className="rounded-2xl border border-white/9 bg-white/[0.035] p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400/12 text-emerald-300">
                  <Globe2 className="h-5 w-5" />
                </span>
                <h3 className="mt-5 font-semibold text-lg">Web Publish</h3>
                <p className="mt-2 min-h-12 text-white/55 text-sm leading-6">
                  Create a shareable Play link with configurator and walkthrough controls.
                </p>
                {published ? (
                  <div className="mt-5 rounded-xl bg-black/25 p-3">
                    <p className="truncate text-emerald-300 text-xs">{published.playUrl}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-2 text-xs"
                        onClick={() => navigator.clipboard.writeText(published.playUrl)}
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </button>
                      <a
                        className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 font-semibold text-black text-xs"
                        href={published.playUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Open
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
                    Publish to web
                  </button>
                )}
              </section>
              <section className="rounded-2xl border border-white/9 bg-white/[0.035] p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-400/12 text-blue-300">
                  <MonitorUp className="h-5 w-5" />
                </span>
                <h3 className="mt-5 font-semibold text-lg">macOS Runtime</h3>
                <p className="mt-2 min-h-12 text-white/55 text-sm leading-6">
                  Build an offline Play application containing the scene and project assets.
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
                  Build macOS app
                </button>
                {buildMessage && (
                  <p className="mt-3 text-amber-200/80 text-xs leading-5">{buildMessage}</p>
                )}
              </section>
              <section className="rounded-2xl border border-white/9 bg-white/[0.035] p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-400/12 text-violet-300">
                  <Laptop className="h-5 w-5" />
                </span>
                <h3 className="mt-5 font-semibold text-lg">Windows Runtime</h3>
                <p className="mt-2 min-h-12 text-white/55 text-sm leading-6">
                  Build a standalone Windows Play executable with the same configurator runtime.
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
                  Build Windows app
                </button>
              </section>
            </div>
            {downloadUrl ? (
              <div className="px-6 pb-6">
                <a
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white font-semibold text-black text-sm"
                  href={downloadUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="h-4 w-4" />
                  Download runtime
                </a>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
