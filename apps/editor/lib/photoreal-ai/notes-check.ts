import { AI_PERSON_NOTES_MAX, type AiPersonNotesError } from './shared'

/**
 * The 자유 설명 (free appearance notes) gate, run in the browser as the user
 * types and again on the server: a length cap, a narrow character set (Hangul,
 * digits, basic punctuation, and a single Latin letter only directly before
 * Hangul, as in V넥 or T셔츠), then word lists for minors, sexual and violent
 * content, real people (likeness cues, relatives, titles, and Korean
 * surname + given-name shapes), things that hide the face, and attempts to
 * steer the model. It is the cheap first layer: the prompt tells the model to
 * ignore anything but appearance, and the provider's own filters and the
 * optional moderation pass run after it.
 */

export type NotesCheck = { ok: true; notes: string } | { ok: false; code: AiPersonNotesError }

/** NFKC (full-width letters and digits to ASCII), one space between words, trimmed. */
export function normaliseNotes(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

const ALLOWED = /^[가-힣0-9 .,·~()/:%!?'"-]*$/
/** One Latin letter right before Hangul (V넥, T셔츠, A라인); any other Latin is refused. */
const LATIN_PREFIX = /(?<![A-Za-z])[A-Za-z](?=[가-힣])/g

const CASE_PARTICLES = new Set(['이', '가', '은', '는', '을', '를', '의', '도', '와', '과', '랑'])

/** Endings stripped once from a word before it is compared with a word list. */
const PARTICLE = /(처럼|같이|같은|느낌의?|스타일의?|이랑|으로|이|가|은|는|을|를|의|도|와|과|랑|로)$/

// `*_PARTS` are looked for inside each word (and inside letters spelt out with
// spaces); those of three or more syllables also across two neighbouring words.
// `*_WORDS` must be a whole word, after one particle is stripped.
const MINOR_PARTS = [
  '어린이',
  '아동',
  '유아',
  '유치원',
  '미성년',
  '초등',
  '중학',
  '고등학',
  '여고생',
  '남고생',
  '여중생',
  '남중생',
  '초딩',
  '중딩',
  '고딩',
  '청소년',
  '십대',
  '10대',
  '교복',
  '앳된',
  '베이비페이스',
  '어려보',
  '어리게',
  '애기같',
  '아기같',
  '아이같',
  '소년',
  '소녀',
  '틴에이저',
  '로리타',
]
// Too short to match inside other words.
const MINOR_WORDS = new Set([
  '아이',
  '애',
  '아기',
  '애기',
  '아가',
  '꼬마',
  '학생',
  '어린',
  '어린애',
  '동안',
  '로리',
  '쇼타',
])
/** Under 20 in digits or in native Korean numbers (열일곱 살, 세 살). */
const MINOR_AGE = [
  /(?<!\d)(?:1?\d)\s*(?:살|세)/,
  /(?:^|[^가-힣])(?:열\s*)?(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)\s*살/,
  /(?:^|[^가-힣])열\s*살/,
]

const SEXUAL_PARTS = [
  '섹시',
  '섹스',
  '섹슈얼',
  '선정적',
  '야한',
  '야하게',
  '야릇',
  '노출',
  '누드',
  '나체',
  '알몸',
  '벗은',
  '벗고',
  '탈의',
  '속옷',
  '란제리',
  '브래지어',
  '팬티',
  '비키니',
  '수영복',
  '가슴',
  '엉덩이',
  '글래머',
  '볼륨감',
  '몸매',
  '성적매력',
  '성인물',
  '19금',
  '에로',
  '야동',
  '유혹',
  '관능',
  '요염',
  '육감',
  '망사',
  '시스루',
]
const SEXUAL_WORDS = new Set(['브라'])

const VIOLENT_PARTS = [
  '피투성이',
  '피범벅',
  '피묻',
  '피흘',
  '핏자국',
  '유혈',
  '출혈',
  '상처',
  '멍든',
  '멍자국',
  '흉기',
  '살인',
  '시체',
  '좀비',
  '고어',
  '폭력',
  '잔인',
  '해골',
  '총상',
  '칼자국',
  '붕대',
  '부상',
  '괴물',
  '악마',
  '귀신',
]
const VIOLENT_WORDS = new Set(['칼', '총', '피', '멍', '무기'])

/** Pointers at a particular person: likeness, fame, relatives, someone the user knows. */
const PERSON_PARTS = [
  '닮',
  '판박이',
  '도플갱어',
  '연예인',
  '아이돌',
  '배우',
  '가수',
  '탤런트',
  '유튜버',
  '스트리머',
  '인플루언서',
  '방송인',
  '개그맨',
  '개그우먼',
  '코미디언',
  '아나운서',
  '정치인',
  '대통령',
  '국회의원',
  '장관',
  '총리',
  '선수',
  '셀럽',
  '셀러브리티',
  '유명인',
  '유명한',
  '실존',
  '실제인물',
  '실제사람',
  '이름',
  '내얼굴',
  '제얼굴',
  '나처럼',
  '나랑',
  '저처럼',
  '저랑',
  '친구',
  '여친',
  '남친',
  '엄마',
  '아빠',
  '어머니',
  '아버지',
  '남편',
  '와이프',
  '동생',
  '언니',
  '오빠',
  '누나',
  '형님',
  '할머니',
  '할아버지',
  '이모',
  '삼촌',
  '고모',
  '사촌',
  '조카',
  '선생님',
  '교수님',
  '사장님',
  '부장님',
  '팀장님',
  '대표님',
  '회장님',
]
const PERSON_WORDS = new Set(['딸', '형', '왕', '여왕', '본인', '아내', '아들', '부인'])
/** Words ending in 씨 or 님 that are not a person's name or title. */
const NOT_A_NAME = new Set([
  '솜씨',
  '마음씨',
  '맘씨',
  '말씨',
  '글씨',
  '날씨',
  '맵씨',
  '불씨',
  '꽃씨',
  '아저씨',
  '아가씨',
  '손님',
  '하느님',
  '하나님',
])

/** Things that hide the face or head, or jewellery: the 3D service needs a clear face. */
const COVER_PARTS = [
  '안경',
  '선글라스',
  '썬글라스',
  '고글',
  '모자쓴',
  '야구모자',
  '털모자',
  '밀짚모자',
  '중절모',
  '비니',
  '베레모',
  '두건',
  '마스크',
  '가면',
  '복면',
  '헤어밴드',
  '머리띠',
  '귀걸이',
  '귀고리',
  '피어싱',
  '이어폰',
  '헤드폰',
  '헤드셋',
  '목걸이',
  '눈을가리',
  '얼굴을가리',
  '눈가리',
]
const COVER_WORDS = new Set(['캡', '모자'])

/** Steering the model instead of describing a face. */
const STEER_PARTS = [
  '무시',
  '프롬프트',
  '지시',
  '명령',
  '시스템',
  '영어로',
  '번역',
  '글자',
  '로고',
  '워터마크',
  '그림체',
  '만화',
  '애니메이션',
  '일러스트',
  '렌더',
  '카툰',
]

const STEER_WORDS = new Set(['애니', '문구'])

// The commonest Korean surnames (about nine in ten people), the two-syllable
// ones, and syllables common in given names. A three-syllable word made of
// one surname and two such syllables reads as a name.
const SURNAMES = new Set(
  '김이박최정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구민류나진지엄채원천방공현'.split(
    '',
  ),
)
const COMPOUND_SURNAMES = new Set(['남궁', '황보', '제갈', '선우', '독고', '사공', '서문'])
const GIVEN = new Set(
  '민준서지현우연수영진호은윤하예성재희혜경정동승태원용석철훈혁빈아나유주채다소미선순숙자옥명기남규환범건도시율린별솔람결온담인찬완웅욱길광근일보슬비리란봄애분녀'.split(
    '',
  ),
)
/** Ordinary words that have a name's shape. */
const NAME_SHAPED_WORDS = new Set([
  '강아지',
  '정수리',
  '지성미',
  '남성미',
  '성숙미',
  '차도남',
  '고성능',
  '이국미',
  '이미지',
  '이정도',
])

export function looksLikeName(word: string): boolean {
  const syllables = [...word]
  if (syllables.length === 4 && COMPOUND_SURNAMES.has(syllables.slice(0, 2).join(''))) {
    return GIVEN.has(syllables[2]!) && GIVEN.has(syllables[3]!)
  }
  if (syllables.length !== 3 || NAME_SHAPED_WORDS.has(word)) return false
  const [surname, middle, last] = syllables as [string, string, string]
  // Verb and adjective endings: 나온다, 진하지, 강하다.
  if (last === '다' || (middle === '하' && last === '지')) return false
  return SURNAMES.has(surname) && GIVEN.has(middle) && GIVEN.has(last)
}

/** A word ending in 씨 or 님 after a stem of two or more syllables: 민준씨, 지은님. */
function isAddressed(word: string): boolean {
  return /^[가-힣]{2,}[씨님]$/.test(word) && !NOT_A_NAME.has(word)
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^가-힣0-9a-z]+/)
    .filter(Boolean)
}

/** Runs of one-syllable words joined up, so a word spelt out with spaces (섹 시) is still read. */
function spacedRuns(list: string[]): string[] {
  const runs: string[] = []
  let run = ''
  for (const word of [...list, '']) {
    if ([...word].length === 1) {
      run += word
      continue
    }
    if ([...run].length > 1) runs.push(run)
    run = ''
  }
  return runs
}

/** The word as typed and with one particle off (김민준은 → 김민준, 민준씨처럼 → 민준씨). */
function forms(word: string): string[] {
  const match = PARTICLE.exec(word)
  if (!match || match.index === 0) return [word]
  const stripped = word.slice(0, match.index)
  // A one-syllable stem only before a case particle (피가 → 피), so 피로 stays 피로.
  if ([...stripped].length === 1 && !CASE_PARTICLES.has(match[0])) return [word]
  return [word, stripped]
}

export function checkNotes(raw: string): NotesCheck {
  const notes = normaliseNotes(raw)
  if (notes.length === 0) return { ok: true, notes }
  if ([...notes].length > AI_PERSON_NOTES_MAX) return { ok: false, code: 'notes_too_long' }
  if (!ALLOWED.test(notes.replace(LATIN_PREFIX, ''))) return { ok: false, code: 'notes_invalid' }

  const typed = words(notes)
  const texts = [...typed, ...spacedRuns(typed)]
  // Two words run together: only parts of three or more syllables are looked for across a
  // space, so a short part can't match the end of one word and the start of the next.
  const pairs = typed.slice(1).map((word, i) => typed[i] + word)
  const all = texts.flatMap(forms)
  const has = (parts: string[], set: Set<string>) =>
    parts.some(
      (part) =>
        texts.some((text) => text.includes(part)) ||
        ([...part].length >= 3 && pairs.some((pair) => pair.includes(part))),
    ) || all.some((word) => set.has(word))

  if (has(MINOR_PARTS, MINOR_WORDS) || MINOR_AGE.some((pattern) => pattern.test(notes))) {
    return { ok: false, code: 'minor_not_allowed' }
  }
  if (has(SEXUAL_PARTS, SEXUAL_WORDS) || has(VIOLENT_PARTS, VIOLENT_WORDS)) {
    return { ok: false, code: 'unsafe_text' }
  }
  if (has(PERSON_PARTS, PERSON_WORDS) || all.some((w) => isAddressed(w) || looksLikeName(w))) {
    return { ok: false, code: 'name_not_allowed' }
  }
  if (has(COVER_PARTS, COVER_WORDS)) return { ok: false, code: 'face_covered' }
  if (has(STEER_PARTS, STEER_WORDS)) return { ok: false, code: 'notes_off_topic' }
  return { ok: true, notes }
}
