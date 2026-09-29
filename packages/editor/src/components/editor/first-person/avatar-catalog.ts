import { ROCKETBOX_AVATARS, type RocketboxAvatar } from './rocketbox-catalog'

export type { RocketboxAvatar }

export type AvatarGender = 'male' | 'female'

/** The picker's tabs, in order. */
export const AVATAR_TABS = [
  { id: 'men', label: '남성' },
  { id: 'women', label: '여성' },
  { id: 'business', label: '정장' },
  { id: 'children', label: '어린이' },
  { id: 'jobs', label: '직업' },
] as const
export type AvatarTab = (typeof AVATAR_TABS)[number]['id']

export const DEFAULT_AVATAR_ID = 'Male_Adult_01'

/** Rocketbox's job prefixes (Business_Female_02, Fire_Male_05, …). */
const JOB_LABELS: Record<string, string> = {
  Business: '정장',
  Chef: '요리사',
  Construction: '시공',
  Delivery: '배달',
  Fire: '소방',
  Gardener: '정원사',
  Medical: '의료',
  Military: '군인',
  Pilot: '조종사',
  Police: '경찰',
  Security: '보안',
  Sports: '운동',
  Wood: '목수',
}

const avatarsById = new Map(ROCKETBOX_AVATARS.map((avatar) => [avatar.id, avatar]))

export const ALL_AVATARS = ROCKETBOX_AVATARS

/** The avatar, or the default one for an id that isn't in the library (an old save). */
export function findAvatar(id: string): RocketboxAvatar {
  return avatarsById.get(id) ?? avatarsById.get(DEFAULT_AVATAR_ID) ?? ROCKETBOX_AVATARS[0]!
}

export function avatarGender(id: string): AvatarGender {
  return /(^|_)Female(_|$)/.test(id) ? 'female' : 'male'
}

export function avatarTab(avatar: RocketboxAvatar): AvatarTab {
  if (avatar.group === 'Children') return 'children'
  if (avatar.group === 'Adults') return avatarGender(avatar.id) === 'female' ? 'women' : 'men'
  return avatar.id.startsWith('Business_') ? 'business' : 'jobs'
}

/** Korean label: "남 3", "여 파티 1", "정장 여 2", "남아 1", "소방 남 4". */
export function avatarLabel(id: string): string {
  const parts = id.split('_')
  const number = Number(parts[parts.length - 1])
  const sex = avatarGender(id) === 'female' ? '여' : '남'
  if (parts[1] === 'Child') return `${sex === '여' ? '여아' : '남아'} ${number}`
  if (parts[1] === 'Party') return `${sex} 파티 ${number}`
  if (parts[1] === 'Adult') return `${sex} ${number}`
  const job = JOB_LABELS[parts[0]!] ?? parts[0]
  return `${job} ${sex} ${number}`
}

const BASE = '/characters/rocketbox'
export const avatarUrl = (id: string) => `${BASE}/${id}.glb`
export const avatarThumbnailUrl = (id: string) => `${BASE}/thumbs/${id}.webp`
