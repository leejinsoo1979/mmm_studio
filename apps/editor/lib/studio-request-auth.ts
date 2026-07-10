const USER_ID_HEADER = 'x-mmm-user-id'

export function getRequestStudioUserId(request: Request): string | null {
  const raw = request.headers.get(USER_ID_HEADER)?.trim()
  if (!raw) return null
  if (raw.length > 128) return null
  if (!/^[A-Za-z0-9:_@./-]+$/.test(raw)) return null
  return raw
}

export function canAccessOwnedResource(ownerId: string | null, userId: string | null): boolean {
  if (!ownerId) return true
  return ownerId === userId
}
