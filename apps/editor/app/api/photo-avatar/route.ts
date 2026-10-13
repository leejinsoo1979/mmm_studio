import { photoAvatarStatus } from '@/lib/photo-avatar-policy'

/**
 * Photo avatars: `GET` says whether real people's photos may be used. The
 * avatar itself is made and kept in the browser; no photo comes here.
 */

export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(photoAvatarStatus(), { headers: { 'Cache-Control': 'no-store' } })
}
