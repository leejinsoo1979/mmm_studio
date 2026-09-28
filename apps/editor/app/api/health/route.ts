import { getSceneStore, getSceneStoreStatus } from '@/lib/scene-store-server'

export async function GET() {
  let storeError: string | null = null
  try {
    await getSceneStore()
  } catch (error) {
    storeError = error instanceof Error ? error.message : String(error)
  }
  const { store, reason } = getSceneStoreStatus()
  return Response.json({
    status: storeError ? 'degraded' : 'ok',
    app: 'editor',
    store: storeError ? 'unavailable' : store,
    reason: storeError ?? reason,
    timestamp: new Date().toISOString(),
  })
}
