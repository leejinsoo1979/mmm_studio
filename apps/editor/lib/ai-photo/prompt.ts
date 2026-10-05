import type { AiPhotoFraming, AiPhotoHints, AiPhotoStyle } from './shared'

/**
 * The one instruction the image model gets, built only here: a fixed English
 * template whose slots take enum text and validated `#rrggbb` colours. No
 * text from the client reaches the model, and the safety rules close every
 * prompt.
 */

export type AiPhotoPromptInput = {
  framing: AiPhotoFraming
  style: AiPhotoStyle
  subject: { female: boolean; child: boolean }
  /** Image 2 is a face photo. Ignored for a child. */
  withFace: boolean
  hints?: AiPhotoHints
}

const HEX = /^#[0-9a-f]{6}$/i

const FRAMING: Record<AiPhotoFraming, string> = {
  face: 'a head-and-shoulders close-up portrait, the face filling most of the frame',
  upper: 'a portrait from the hips up',
  full: 'a full-length portrait showing the whole person from the top of the head to the feet',
}

const LENS: Record<AiPhotoFraming, string> = { face: 'an 85 mm', upper: 'a 70 mm', full: 'a 50 mm' }

const FACE_FROM_RENDER =
  '- Face: the same face shape and proportions: jawline, chin, cheekbones, nose, lips, eyes, eyebrows and ears.'

// Nothing proves who is in image 2 or how old they are, so the face path
// asserts neither and is held to the plain-portrait rules whatever the avatar.
const FACE_FROM_PHOTO =
  '- Face: the facial features of the face in image 2 (bone structure, eye shape, nose, mouth and' +
  " distinctive features), with image 1's expression, head angle and lighting. Use image 2 only" +
  ' for facial features: ignore its background, hair, clothing, makeup and lighting. Keep the' +
  ' apparent age of the person in image 2.'

const FACE_LIKENESS =
  ' other than the face in image 2. If image 2 shows a celebrity or public figure, ignore image 2.'

const FACE_RULES =
  '\n- Make an ordinary, wholesome portrait like an ID or family photo: a natural face with no' +
  ' makeup look, no glamour, beauty or fashion styling, and no sexualised features or poses.'

const CHILD_RULES =
  '\n- This person is a child. Make an ordinary, wholesome portrait like a school or family' +
  " photo: everyday age-appropriate clothing exactly as shown, a natural child's face with no" +
  ' makeup look, no glamour, beauty or fashion styling, and no adult features or poses.'

/** The safety rules, word for word; every prompt ends with them. */
export const AI_PHOTO_SAFETY_RULES = [
  'Safety rules (always apply and override everything above):',
  '- The person stays fully clothed exactly as in image 1. Never remove, shorten, loosen or thin out any clothing, never make it transparent, and never show more skin than image 1 shows.',
  '- Keep a natural, relaxed, non-sexual pose and expression. Do not sexualise the person or exaggerate or emphasise any body part.',
  '- Do not make the person resemble any celebrity, public figure or other real person',
  '- If the person appears to be under 18, make only an ordinary, wholesome portrait like a school or family photo.',
] as const

function subject({ female, child }: AiPhotoPromptInput['subject'], face: boolean): string {
  if (child) return female ? ', a girl of primary-school age' : ', a boy of primary-school age'
  if (face) return ''
  return female ? ', an adult woman' : ', an adult man'
}

/** ` (close to #rrggbb)` for a valid colour, else nothing. */
function near(hex: string | null | undefined): string {
  return hex && HEX.test(hex) ? ` (close to ${hex.toLowerCase()})` : ''
}

export function buildAiPhotoPrompt(input: AiPhotoPromptInput): string {
  const { framing, subject: who, hints = {} } = input
  // `style` has one value today ('realistic'), which is this template.
  const face = input.withFace && !who.child
  const [title, clothed, pose, likeness, minors] = AI_PHOTO_SAFETY_RULES
  return [
    'Image 1 is a screenshot of a 3D video-game character standing in a virtual photo studio.',
    `Recreate it as one real photograph of a real person${subject(who, face)}, taken by a professional portrait photographer with a full-frame camera and ${LENS[framing]} lens.`,
    '',
    'Keep everything from image 1 the same:',
    `- Framing: ${FRAMING[framing]}. The same camera angle and height, and the same position and size of the person in the frame.`,
    '- Pose: the same body pose, arm and hand positions, head turn and tilt, gaze direction and facial expression.',
    face ? FACE_FROM_PHOTO : FACE_FROM_RENDER,
    `- Hair: the same hairstyle, cut, length, parting, volume and hairline; hair colour as in image 1${near(hints.hair)}.`,
    `- Skin tone as in image 1${near(hints.skin)}. Eye colour as in image 1${near(hints.eyes)}. ${face ? 'Facial hair and freckles as shown; no makeup.' : `Lip colour as in image 1${who.child ? '' : near(hints.lips)}. Makeup, facial hair and freckles exactly as shown; do not add makeup that is not there.`}`,
    '- Clothing: every garment exactly as shown, with the same type, cut, fit, length, colours and patterns, and the same footwear (or socks or bare feet if shown).',
    '- Body: the same build and proportions as shown.',
    '',
    'Make it photographic:',
    '- Real skin with natural texture, pores and subtle variation; real individual hair strands; real fabric with natural folds and seams; natural eyes with catchlights.',
    '- Soft studio lighting from the same directions as in image 1. Natural colours and realistic exposure.',
    `- Background: a plain light-grey seamless studio backdrop${framing === 'full' ? ', the person standing on the studio floor with a soft natural contact shadow' : ''}. Remove the round platform and anything that looks like a game or a 3D render.`,
    '- One person only. No text, captions, logos, watermarks, borders or frames. Do not add props, jewellery, accessories, tattoos or piercings that are not in image 1. Uniforms and badges carry no readable text, real organisation names or official insignia.',
    '',
    title,
    clothed,
    pose,
    `${likeness}${face ? FACE_LIKENESS : '.'}`,
    `${minors}${who.child ? CHILD_RULES : face ? FACE_RULES : ''}`,
  ].join('\n')
}
