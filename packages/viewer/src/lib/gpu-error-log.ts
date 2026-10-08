// A rejected draw is rejected again on every frame, and the Next dev server
// forwards the browser console to its terminal, so logging each WebGPU
// uncaptured error floods both (a long session ran the dev server out of
// heap). Each distinct message is logged in full once; repeats are counted
// and summarised at most once per interval while they keep coming.

export const GPU_ERROR_SUMMARY_INTERVAL_MS = 10_000

const MAX_DISTINCT_MESSAGES = 50
const MAX_SUMMARY_LINES = 5

export interface GpuErrorReporter {
  report(error: { message?: string } | null | undefined): void
  /** Prints the repeats counted so far and stops the pending summary. */
  dispose(): void
}

export function createGpuErrorReporter(
  print: (...args: unknown[]) => void,
  schedule: (run: () => void, ms: number) => () => void,
  intervalMs = GPU_ERROR_SUMMARY_INTERVAL_MS,
): GpuErrorReporter {
  const logged = new Set<string>()
  const repeats = new Map<string, number>()
  let cancel: (() => void) | null = null

  const summarise = () => {
    cancel = null
    if (repeats.size === 0) return
    print(formatRepeatSummary(repeats, intervalMs))
    repeats.clear()
  }

  return {
    report(error) {
      const message = error?.message || 'unknown error'
      if (!logged.has(message) && logged.size < MAX_DISTINCT_MESSAGES) {
        logged.add(message)
        print('[viewer] WebGPU uncaptured error:', message, error)
        return
      }
      repeats.set(message, (repeats.get(message) ?? 0) + 1)
      cancel ??= schedule(summarise, intervalMs)
    },
    dispose() {
      cancel?.()
      summarise()
    },
  }
}

export function formatRepeatSummary(repeats: Map<string, number>, intervalMs: number): string {
  const lines = [...repeats]
    .sort((a, b) => b[1] - a[1])
    .map(([message, count]) => `  ${count}× ${message.split('\n')[0]}`)
  const shown = lines.slice(0, MAX_SUMMARY_LINES)
  if (lines.length > shown.length) shown.push(`  …and ${lines.length - shown.length} more messages`)
  const seconds = Math.round(intervalMs / 1000)
  return `[viewer] WebGPU uncaptured errors still occurring (repeats within ${seconds} s, each logged in full once):\n${shown.join('\n')}`
}
