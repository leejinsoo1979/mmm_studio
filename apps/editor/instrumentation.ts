export async function register() {
  // The Node-only module is imported lazily so the Edge build of this file never sees node:v8.
  if (process.env.NODE_ENV === 'development' && process.env.NEXT_RUNTIME === 'nodejs') {
    const { startDevHeapWatchdog } = await import('./lib/dev-heap-watchdog')
    startDevHeapWatchdog()
  }
}
