import { ALL_AVATARS, type AvatarGender, avatarGender, findAvatar } from '@pascal-app/editor'

const SEX: Record<AvatarGender, string> = { male: 'Male', female: 'Female' }

export const isChild = (id: string) => findAvatar(id).group === 'Children'

/** The number an avatar id ends in (Business_Male_03 is 3). */
const numberOf = (id: string) => Number(id.slice(id.lastIndexOf('_') + 1)) || 0

/**
 * The avatar of a line (Business_Female, Male_Child, …) nearest to `number`
 * from below, so a line shorter than the one left keeps the last it has;
 * its first when all its numbers are higher, and null when it has none.
 */
function inLine(line: string, number: number): string | null {
  const members = ALL_AVATARS.filter((avatar) => avatar.id.startsWith(`${line}_`))
    .map((avatar) => avatar.id)
    .sort((a, b) => numberOf(a) - numberOf(b))
  return members.filter((id) => numberOf(id) <= number).at(-1) ?? members[0] ?? null
}

/**
 * The avatar most like `id` in the other sex or age, so switching them
 * keeps the character as close as the library allows: the same line and
 * number (Male_Adult_07 ↔ Female_Adult_07, Business_Male_03 ↔
 * Business_Female_03), the plain adults where a job or party line has no
 * one of that sex, and the children's line for any child (there are no
 * child jobs).
 */
export function counterpartAvatar(id: string, gender: AvatarGender, child: boolean): string {
  if (avatarGender(id) === gender && isChild(id) === child) return id
  const sex = SEX[gender]
  const [first, kind] = id.split('_')
  const plain = first === 'Male' || first === 'Female'
  const lines = child
    ? [`${sex}_Child`]
    : [plain ? `${sex}_${kind === 'Child' ? 'Adult' : kind}` : `${first}_${sex}`, `${sex}_Adult`]
  for (const line of lines) {
    const found = inLine(line, numberOf(id))
    if (found) return found
  }
  return id
}
