import type {
  AvatarGender,
  BeardStyle,
  BodySliderGroup,
  BodySliderId,
  EmoteId,
  FaceSliderGroup,
  FaceSliderId,
  HairStyleEntry,
} from '@pascal-app/editor'
import {
  Angry,
  Brain,
  Camera,
  CircleHelp,
  Coffee,
  DoorClosed,
  Eye,
  Frown,
  Hand,
  HandMetal,
  Heart,
  Laugh,
  type LucideIcon,
  MessagesSquare,
  Moon,
  Music,
  Music2,
  Music3,
  Music4,
  PartyPopper,
  Presentation,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trophy,
} from 'lucide-react'

export type Swatch = { hex: string; name: string }

/** Sock colours: the plain default is the original (no swatch picked). */
export const SOCK_SWATCHES: Swatch[] = [
  { hex: '#1f1f22', name: '검정' },
  { hex: '#7c7f86', name: '회색' },
  { hex: '#1f2f55', name: '네이비' },
  { hex: '#b9a68a', name: '베이지' },
  { hex: '#a8323e', name: '빨강' },
  { hex: '#e8a7b8', name: '분홍' },
  { hex: '#4f7a4a', name: '초록' },
  { hex: '#e5c34b', name: '노랑' },
  { hex: '#6aa3d8', name: '하늘' },
  { hex: '#6b4a8c', name: '보라' },
  { hex: '#7a5232', name: '갈색' },
]

/** Natural hair shades, darkest first: what a random look mostly dyes to. */
export const NATURAL_HAIR_SWATCHES: Swatch[] = [
  { hex: '#1B1918', name: '자연 흑발' },
  { hex: '#1D2433', name: '블루 블랙' },
  { hex: '#3A2A22', name: '흑갈색' },
  { hex: '#4F3426', name: '다크 브라운' },
  { hex: '#6B4331', name: '초코 브라운' },
  { hex: '#8A5F43', name: '밀크 브라운' },
  { hex: '#7A6A5E', name: '애쉬 브라운' },
  { hex: '#A06F3C', name: '골드 브라운' },
  { hex: '#A4532A', name: '오렌지 브라운' },
  { hex: '#C89B5D', name: '허니 블론드' },
]

/** Hair dyes, natural shades first, then fashion colours. */
export const HAIR_SWATCHES: Swatch[] = [
  ...NATURAL_HAIR_SWATCHES,
  { hex: '#E3D3B0', name: '플래티넘' },
  { hex: '#9A9A98', name: '애쉬 그레이' },
  { hex: '#C9CBCF', name: '실버' },
  { hex: '#5E1F2A', name: '버건디' },
  { hex: '#8C2436', name: '와인 레드' },
  { hex: '#D88AA6', name: '핑크' },
  { hex: '#9D8AC7', name: '라벤더' },
  { hex: '#2A3A63', name: '네이비' },
  { hex: '#3F7FBF', name: '블루' },
  { hex: '#7FC4B0', name: '민트' },
]

/** Skin tones, fairest first. */
export const SKIN_SWATCHES: Swatch[] = [
  { hex: '#F3D9C8', name: '아주 밝은' },
  { hex: '#EDC9AE', name: '밝은 핑크' },
  { hex: '#EAC3A6', name: '밝은' },
  { hex: '#E2B38E', name: '밝은 웜' },
  { hex: '#D9A77F', name: '자연' },
  { hex: '#D4A07A', name: '웜 베이지' },
  { hex: '#C68D63', name: '허니' },
  { hex: '#B07650', name: '탠' },
  { hex: '#9A6240', name: '브론즈' },
  { hex: '#8A5638', name: '카라멜' },
  { hex: '#6E432B', name: '브라운' },
  { hex: '#553320', name: '딥 브라운' },
  { hex: '#3F2519', name: '에스프레소' },
]

export const EMOTE_ICONS: Record<EmoteId, LucideIcon> = {
  wave: Hand,
  waveBig: HandMetal,
  clap: Heart,
  cheer: PartyPopper,
  hooray: Trophy,
  nod: ThumbsUp,
  headShake: ThumbsDown,
  danceCool: Music,
  danceGroove: Music2,
  danceSilly: Music3,
  danceHard: Music4,
  laugh: Laugh,
  shrug: CircleHelp,
  think: Brain,
  angry: Angry,
  sad: Frown,
  yawn: Moon,
  present: Presentation,
  talk: MessagesSquare,
  stretch: Sparkles,
  lookAround: Eye,
  scratchHead: CircleHelp,
  photo: Camera,
  knock: DoorClosed,
  drink: Coffee,
}

/** A −1–1 slider's name, and what its two ends do. */
export type SliderText = { label: string; low: string; high: string }

export const FACE_GROUP_LABELS: Record<FaceSliderGroup, string> = {
  face: '얼굴형',
  eyes: '눈',
  brows: '눈썹',
  nose: '코',
  mouth: '입',
  ears: '귀',
}

export const FACE_SLIDER_TEXT: Record<FaceSliderId, SliderText> = {
  faceWidth: { label: '얼굴 너비', low: '좁게', high: '넓게' },
  faceLength: { label: '얼굴 길이', low: '짧게', high: '길게' },
  jawWidth: { label: '턱선 너비', low: '갸름하게', high: '각지게' },
  chinWidth: { label: '턱끝 너비', low: '뾰족하게', high: '넓게' },
  chinLength: { label: '턱끝 길이', low: '짧게', high: '길게' },
  chinDepth: { label: '턱끝 돌출', low: '들어가게', high: '나오게' },
  cheekbones: { label: '광대', low: '낮게', high: '도드라지게' },
  cheeks: { label: '볼살', low: '홀쭉하게', high: '통통하게' },
  forehead: { label: '이마', low: '평평하게', high: '볼록하게' },
  jawAngle: { label: '턱 각', low: 'V라인', high: '각지게' },
  eyeSize: { label: '눈 크기', low: '작게', high: '크게' },
  eyeWidth: { label: '눈 길이', low: '짧게', high: '길게' },
  eyeOpen: { label: '눈 세로 폭', low: '가늘게', high: '또렷하게' },
  eyeSpacing: { label: '눈 사이', low: '좁게', high: '넓게' },
  eyeHeight: { label: '눈 높이', low: '아래로', high: '위로' },
  eyeTilt: { label: '눈꼬리', low: '처지게', high: '올라가게' },
  eyeDepth: { label: '눈 깊이', low: '나오게', high: '깊게' },
  browHeight: { label: '눈썹 높이', low: '아래로', high: '위로' },
  browTilt: { label: '눈썹 꼬리', low: '처지게', high: '올라가게' },
  browSpacing: { label: '눈썹 사이', low: '좁게', high: '넓게' },
  browArch: { label: '눈썹 모양', low: '일자로', high: '아치형으로' },
  noseWidth: { label: '콧볼 너비', low: '좁게', high: '넓게' },
  noseBridge: { label: '콧대 너비', low: '가늘게', high: '넓게' },
  noseLength: { label: '코 길이', low: '짧게', high: '길게' },
  noseHeight: { label: '콧대 높이', low: '낮게', high: '높게' },
  noseTip: { label: '코끝', low: '내려가게', high: '들리게' },
  mouthWidth: { label: '입 너비', low: '좁게', high: '넓게' },
  mouthHeight: { label: '입 위치', low: '아래로', high: '위로' },
  lipFullness: { label: '입술 두께', low: '얇게', high: '도톰하게' },
  upperLip: { label: '윗입술', low: '얇게', high: '도톰하게' },
  lowerLip: { label: '아랫입술', low: '얇게', high: '도톰하게' },
  philtrum: { label: '인중 길이', low: '짧게', high: '길게' },
  mouthDepth: { label: '입 돌출', low: '들어가게', high: '나오게' },
  mouthCorners: { label: '입꼬리', low: '내려가게', high: '올라가게' },
  earSize: { label: '귀 크기', low: '작게', high: '크게' },
  earAngle: { label: '귀 각도', low: '붙게', high: '벌어지게' },
  earHeight: { label: '귀 높이', low: '아래로', high: '위로' },
  earPoint: { label: '귀 끝', low: '둥글게', high: '뾰족하게' },
}

export const BODY_GROUP_LABELS: Record<BodySliderGroup, string> = {
  build: '체격',
  torso: '상체',
  limbs: '팔다리',
}

export const HEIGHT_TEXT: SliderText = { label: '키', low: '작게', high: '크게' }

export const BODY_SLIDER_TEXT: Record<BodySliderId, SliderText> = {
  weight: { label: '체중', low: '마름', high: '통통' },
  muscle: { label: '근육', low: '적게', high: '탄탄하게' },
  headSize: { label: '머리 크기', low: '작게', high: '크게' },
  shoulders: { label: '어깨 너비', low: '좁게', high: '넓게' },
  chest: { label: '가슴', low: '작게', high: '크게' },
  waist: { label: '허리', low: '잘록하게', high: '굵게' },
  belly: { label: '배', low: '납작하게', high: '나오게' },
  hips: { label: '골반', low: '좁게', high: '넓게' },
  neck: { label: '목 두께', low: '가늘게', high: '굵게' },
  arms: { label: '팔 두께', low: '가늘게', high: '굵게' },
  legs: { label: '다리 두께', low: '가늘게', high: '굵게' },
}

/** Iris colours, the commonest first. */
export const IRIS_SWATCHES: Swatch[] = [
  { hex: '#2E1E16', name: '흑갈색' },
  { hex: '#5A3A24', name: '갈색' },
  { hex: '#8A6236', name: '헤이즐' },
  { hex: '#A8782C', name: '호박색' },
  { hex: '#5B7A3E', name: '초록' },
  { hex: '#3F7F78', name: '청록' },
  { hex: '#3E6AA8', name: '파랑' },
  { hex: '#86A9CC', name: '하늘색' },
  { hex: '#7C8791', name: '회색' },
  { hex: '#6A5294', name: '보라' },
  { hex: '#9A2E34', name: '붉은색' },
]

/** Brow colours: the natural shades hair comes in. */
export const BROW_SWATCHES: Swatch[] = [
  { hex: '#161413', name: '흑색' },
  { hex: '#2E221C', name: '흑갈색' },
  { hex: '#4A3326', name: '다크 브라운' },
  { hex: '#6B4A35', name: '브라운' },
  { hex: '#6E625A', name: '애쉬 브라운' },
  { hex: '#8F6A45', name: '밝은 갈색' },
  { hex: '#B08D5E', name: '블론드' },
  { hex: '#8F3F24', name: '적갈색' },
  { hex: '#8C8A88', name: '회색' },
  { hex: '#CFCAC2', name: '백발' },
  { hex: '#E0D2B4', name: '탈색' },
]

export const LIP_SWATCHES: Swatch[] = [
  { hex: '#C98A7A', name: '누드' },
  { hex: '#E3927A', name: '피치' },
  { hex: '#E0705A', name: '코랄' },
  { hex: '#E4899F', name: '핑크' },
  { hex: '#C2566E', name: '로즈' },
  { hex: '#D8452E', name: '오렌지 레드' },
  { hex: '#B3202E', name: '레드' },
  { hex: '#8E1B2E', name: '체리' },
  { hex: '#6A1F2B', name: '버건디' },
  { hex: '#7A3450', name: '플럼' },
  { hex: '#8A4B3A', name: '브릭' },
]

export const BLUSH_SWATCHES: Swatch[] = [
  { hex: '#F2A385', name: '피치' },
  { hex: '#F08C7A', name: '코랄' },
  { hex: '#F29BB0', name: '핑크' },
  { hex: '#D9788C', name: '로즈' },
  { hex: '#C98272', name: '말린 장미' },
]

export const SHADOW_SWATCHES: Swatch[] = [
  { hex: '#8A6048', name: '브라운' },
  { hex: '#C2A06A', name: '샴페인 골드' },
  { hex: '#C98272', name: '로즈 골드' },
  { hex: '#D9829A', name: '핑크' },
  { hex: '#D9803E', name: '오렌지' },
  { hex: '#7A2E3E', name: '버건디' },
  { hex: '#6E4A8E', name: '퍼플' },
  { hex: '#2E4A7A', name: '네이비' },
  { hex: '#5E6A3A', name: '올리브' },
  { hex: '#4A4A52', name: '스모키' },
  { hex: '#1E1C1E', name: '블랙' },
]

export const BEARD_LABELS: Record<BeardStyle, string> = {
  none: '없음',
  stubble: '거뭇한 수염',
  mustache: '콧수염',
  goatee: '염소수염',
  full: '턱수염',
}

export const HAIR_LENGTH_LABELS: Record<HairStyleEntry['length'], string> = {
  short: '짧은 머리',
  medium: '중간 머리',
  long: '긴 머리',
}

export const GENDER_LABELS: Record<AvatarGender, string> = { male: '남성', female: '여성' }
