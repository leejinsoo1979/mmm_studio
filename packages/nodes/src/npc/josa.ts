/**
 * Korean particles (조사) that change with the word before them: 이/가, 은/는,
 * 을/를, 과/와, 으로/로, 이에요/예요, 아/야 … Pure; used for NPC names, room
 * names and dialogue templates like `{npc:이/가}`.
 */

const SYLLABLE_FIRST = 0xac00
const SYLLABLE_LAST = 0xd7a3
/** Final-consonant (받침) index of ㄹ. */
const RIEUL = 8
/** The final consonant of each digit as read: 영 일 이 삼 사 오 육 칠 팔 구. */
const DIGIT_FINALS = [21, RIEUL, 0, 16, 0, 0, 1, RIEUL, RIEUL, 0]
/** The form used after a final consonant starts with one of these (이/가, 으로/로, 과/와, 아/야). */
const AFTER_CONSONANT = /^[이으은을과아]/

/** Index of the word's final consonant (0 = ends in a vowel). Trailing symbols are skipped;
 *  Latin letters count as vowels. */
function finalConsonant(word: string): number {
  for (let i = word.length - 1; i >= 0; i--) {
    const code = word.charCodeAt(i)
    if (code >= SYLLABLE_FIRST && code <= SYLLABLE_LAST) return (code - SYLLABLE_FIRST) % 28
    if (code >= 0x30 && code <= 0x39) return DIGIT_FINALS[code - 0x30] ?? 0
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return 0
  }
  return 0
}

/** The particle of the pair `a`/`b` (either order) that follows `word`. */
export function josa(word: string, a: string, b: string): string {
  const [afterConsonant, afterVowel] =
    AFTER_CONSONANT.test(b) && !AFTER_CONSONANT.test(a) ? [b, a] : [a, b]
  const final = finalConsonant(word)
  if (final === 0) return afterVowel
  // 으로 drops its 으 after ㄹ too: 거실로, 서울로.
  if (final === RIEUL && afterConsonant.startsWith('으')) return afterVowel
  return afterConsonant
}

/** `word` with its particle: withJosa('지아', '와', '과') → '지아와'. */
export function withJosa(word: string, a: string, b: string): string {
  return word + josa(word, a, b)
}
