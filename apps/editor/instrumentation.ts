export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // The Node-only modules are imported lazily so the Edge build of this file never sees them.
  if (process.env.NODE_ENV === 'development') {
    const { startDevHeapWatchdog } = await import('./lib/dev-heap-watchdog')
    startDevHeapWatchdog()
  }
  // AI 인물 builds left running by the last server are carried on from the start.
  const { startPhotorealAiSweep } = await import('./lib/photoreal-ai/handlers')
  startPhotorealAiSweep()
}
