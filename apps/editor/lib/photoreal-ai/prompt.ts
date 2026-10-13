import type { AiPersonAge, AiPersonChoices, AiPersonDetail, AiViewSlot } from './shared'

/**
 * The instructions the image model gets for an AI 인물 — its portrait, and
 * the portrait's turned views — built only here: fixed English templates
 * whose slots take fixed text for each choice. Nothing the user types
 * reaches them (there is no free text), so no name, likeness or other
 * request can. The photo is what a single-photo 3D avatar service needs:
 * frontal, level, neutral, mouth closed, eyes open, evenly lit, plain light
 * background, head and shoulders, nothing on the face. The safety rules close
 * every prompt.
 */

const AGE: Record<AiPersonAge, { text: string; min: number; max: number }> = {
  '20s': { text: 'in their mid-to-late twenties (about 26 years old)', min: 23, max: 29 },
  '30s': { text: 'in their thirties (about 35 years old)', min: 30, max: 39 },
  '40s': { text: 'in their forties (about 45 years old)', min: 40, max: 49 },
  '50s': { text: 'in their fifties (about 55 years old)', min: 50, max: 59 },
  '60s': { text: 'in their sixties (about 65 years old)', min: 60, max: 69 },
}

const IMPRESSION: Record<AiPersonChoices['impression'], string> = {
  soft: 'a soft, gentle, kind look with relaxed features',
  sharp: 'a crisp look with clear, well-defined features',
  calm: 'a calm, composed, quiet look',
  bright: 'a bright, open, approachable look',
  smart: 'a thoughtful, intelligent look',
  strong: 'a strong, sturdy look with firm features',
}

const FACE_SHAPE: Record<AiPersonChoices['faceShape'], string> = {
  oval: 'an oval face',
  round: 'a round face with full cheeks',
  square: 'a squarish face with a defined jaw',
  slim: 'a slim face with a narrow, tapered jaw and chin',
  long: 'a long face',
}

const SKIN: Record<AiPersonChoices['skinTone'], string> = {
  fair: 'very fair skin',
  light: 'light skin',
  medium: 'medium, lightly tanned skin',
  olive: 'olive skin',
  brown: 'brown skin',
  deep: 'deep brown skin',
}

const HERITAGE: Record<AiPersonChoices['heritage'], string> = {
  eastAsian: ' of East Asian descent',
  southeastAsian: ' of Southeast Asian descent',
  southAsian: ' of South Asian descent',
  european: ' of European descent',
  african: ' of African descent',
  latin: ' of Latin American descent',
  middleEastern: ' of Middle Eastern descent',
  any: '',
}

const HAIR_STYLE: Record<AiPersonChoices['hairStyle'], string> = {
  crop: 'short cropped hair',
  twoBlock: 'a short two-block cut, the sides clipped short and the top swept up and back',
  dandy: 'a neat short cut with a light fringe that ends above the eyebrows',
  bob: 'a chin-length bob tucked behind the ears',
  shoulder: 'shoulder-length hair tucked behind the ears',
  longStraight: 'long straight hair tucked behind the ears and falling behind the shoulders',
  longWavy: 'long, loosely wavy hair tucked behind the ears and falling behind the shoulders',
  ponytail: 'hair pulled back neatly into a low ponytail',
  slickBack: 'hair combed neatly straight back',
  buzz: 'a very short buzz cut',
  shaved: 'a cleanly shaved head',
  shortCurly: 'short natural curls',
}

const HAIR_COLOUR: Record<AiPersonChoices['hairColour'], string> = {
  black: 'black',
  darkBrown: 'dark brown',
  brown: 'medium brown',
  lightBrown: 'light brown',
  blonde: 'blonde',
  auburn: 'auburn',
  grey: 'grey',
  white: 'silver-white',
}

const FACIAL_HAIR: Record<AiPersonChoices['facialHair'], string> = {
  none: 'Clean-shaven.',
  stubble: 'Light, even stubble.',
  shortBeard: 'A short, neatly trimmed beard that follows the jawline, the lips left clear.',
}

/** Each garment with its colour in place. */
const OUTFIT: Record<AiPersonChoices['outfit'], (colour: string) => string> = {
  tshirt: (colour) => `a plain ${colour} crew-neck T-shirt`,
  knit: (colour) => `a plain ${colour} fine-knit crew-neck sweater`,
  shirt: (colour) => `a plain ${colour} collared button-up shirt with only the top button open`,
  suit: (colour) => `a plain ${colour} suit jacket over a plain white collared shirt`,
  blouse: (colour) => `a plain ${colour} round-neck blouse`,
  hoodie: (colour) => `a plain ${colour} hoodie with the hood down`,
  sport: (colour) => `a plain ${colour} zip-up track jacket, zipped up`,
  workwear: (colour) => `a plain ${colour} sturdy work jacket over a plain T-shirt`,
}

const OUTFIT_COLOUR: Record<AiPersonChoices['outfitColour'], string> = {
  white: 'white',
  black: 'black',
  grey: 'mid grey',
  navy: 'navy',
  beige: 'beige',
  khaki: 'khaki',
  burgundy: 'burgundy',
  skyBlue: 'light sky blue',
}

const DETAIL: Record<AiPersonDetail, string> = {
  thickBrows: 'thick, dark eyebrows',
  fineBrows: 'fine, light eyebrows',
  doubleEyelids: 'double eyelids',
  monolids: 'monolid eyes',
  freckles: 'a light scattering of freckles across the nose and cheeks',
  cheekMole: 'a small mole on one cheek',
  dimples: 'cheek dimples',
  highNoseBridge: 'a high nose bridge',
  fullLips: 'full lips',
  thinLips: 'thin lips',
  angularJaw: 'an angular jawline',
  highCheekbones: 'high cheekbones',
}

/** The safety rules, word for word; every prompt ends with them. */
export const AI_PORTRAIT_SAFETY_RULES = [
  'Safety rules (always apply and override everything above):',
  '- This person is invented. Do not make them resemble any celebrity, public figure or other real person.',
  '- The person is fully clothed as described, in an ordinary, wholesome, non-sexual portrait. Do not sexualise the person or emphasise any body part.',
  '- No violence, injuries, blood, weapons or anything disturbing.',
] as const

/** The route has checked `details` (distinct, capped, no contradicting pair). */
export function buildAiPortraitPrompt(choices: AiPersonChoices): string {
  const woman = choices.sex === 'female'
  const age = AGE[choices.age]
  const hair =
    choices.hairStyle === 'shaved'
      ? `${HAIR_STYLE.shaved}.`
      : `${HAIR_STYLE[choices.hairStyle]}, ${HAIR_COLOUR[choices.hairColour]}.`
  const details = choices.details.map((detail) => DETAIL[detail])
  const [title, invented, clothed, peaceful] = AI_PORTRAIT_SAFETY_RULES
  return [
    `A photorealistic, ID-style studio portrait photograph of one fictional adult ${woman ? 'woman' : 'man'}${HERITAGE[choices.heritage]}, ${age.text}. This person is invented and is not anyone real.`,
    '',
    'The person:',
    `- Face: ${FACE_SHAPE[choices.faceShape]} with ${IMPRESSION[choices.impression]}. Natural, realistic adult proportions and an ordinary, everyday look.`,
    ...(details.length ? [`- Features: ${details.join(', ')}.`] : []),
    `- Skin: ${SKIN[choices.skinTone]} with natural texture, pores and subtle variation${age.min >= 40 ? ', and the natural lines of their age' : ''}. No makeup look, or only very light natural makeup.${woman ? '' : ` ${FACIAL_HAIR[choices.facialHair]}`}`,
    `- Hair: ${hair} The hair is kept off the face: the forehead, both eyebrows, both eyes and both ears are clearly visible.`,
    `- Clothing: ${OUTFIT[choices.outfit](OUTFIT_COLOUR[choices.outfitColour])}, with no text, logos, patterns or badges.`,
    '',
    'Pose and expression (needed to turn the photo into a 3D avatar):',
    '- Head and shoulders, facing the camera straight on: the head level, not turned or tilted, looking straight into the lens.',
    '- A neutral, relaxed expression: mouth closed with the lips together, no smile, both eyes fully open.',
    '- Both shoulders visible and level; the arms down and out of the frame.',
    '',
    'Photography:',
    '- Even, soft, diffuse front lighting from both sides: no harsh or hard shadows, no shadow across the face, no rim light, no colour cast, natural skin colour.',
    '- A plain, evenly lit, light-grey seamless background with nothing else in it.',
    '- Sharp focus over the whole face, shot at eye level with an 85 mm portrait lens, high resolution, true-to-life colour.',
    '- Framing: the head centred left to right; the top of the hair a little below the top edge; the head (chin to the top of the hair) about half the height of the image; the shoulders along the bottom of the frame.',
    '- Nothing on the face or head: no glasses or sunglasses, hat, headband, hair accessories, mask, headphones, earrings, piercings, jewellery, tattoos or face paint. No hands in the frame.',
    '- One person only. No text, captions, logos, watermarks, borders or frames. No beauty retouching or filters; not a fashion or glamour photo.',
    '',
    title,
    `- The person is clearly an adult aged ${age.min} to ${age.max}. Never make them look younger than ${age.min}.`,
    invented,
    clothed,
    peaceful,
  ].join('\n')
}

/**
 * The instruction for one turned view of the same fictional person, made
 * from their portrait (the one image sent with it): the same person, light,
 * clothes and framing, the head turned. Turning to one's left shows the
 * camera one's right side and points the nose at the picture's right edge.
 */
export function buildAiViewPrompt(slot: AiViewSlot, age: AiPersonAge): string {
  const left = slot === 'left45' || slot === 'left90'
  const full = slot === 'left90' || slot === 'right90'
  const way = left ? 'left' : 'right'
  const seen = left ? 'right' : 'left'
  const nose = left ? 'right' : 'left'
  const { min, max } = AGE[age]
  const [title, invented, clothed, peaceful] = AI_PORTRAIT_SAFETY_RULES
  return [
    'Image 1 is a studio photograph of one fictional adult, made for a 3D avatar. Make a new photorealistic studio photograph of exactly the same person: the same face, identity, age, skin, hair, clothing, lighting, plain light-grey background, camera height, lens and distance, and the same neutral, relaxed expression with the mouth closed and both eyes open.',
    '',
    'Only the pose changes:',
    full
      ? `- The person has turned their head and shoulders a full 90 degrees to their ${way}: a true side profile. The camera sees only the ${seen} side of the face, the nose points straight at the ${nose} edge of the image, and the profile of the forehead, nose, lips and chin stands clear against the background.`
      : `- The person has turned their head and shoulders 45 degrees to their ${way}: a three-quarter view. The camera sees mostly the ${seen} side of the face, and the nose points toward the ${nose} side of the image.`,
    '- The head is level, not tilted or nodding; the eyes look straight ahead the way the head points, not at the camera.',
    '- The whole head, from the top of the hair to below the chin, and the neck stay in the frame, the head in the middle. Nothing covers the face, the ears or the profile: no hand, no hair across the face.',
    '- One person only. No text, logos, watermarks or borders.',
    '',
    title,
    `- The person is clearly an adult aged ${min} to ${max}. Never make them look younger than ${min}.`,
    invented,
    clothed,
    peaceful,
  ].join('\n')
}
