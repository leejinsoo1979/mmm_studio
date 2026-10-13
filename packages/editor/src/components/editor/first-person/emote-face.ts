import {
  type AnimationClip,
  type Interpolant,
  LinearInterpolant,
  Matrix3,
  type Object3D,
  Quaternion,
  QuaternionLinearInterpolant,
  Vector3,
} from 'three'

/**
 * The face an emote clip makes, as a 실사 body's blend shapes (ARKit's
 * names) can show it. The emotes are Rocketbox motion capture, and their
 * faces move the Rocketbox head's face bones (the jaw, the lips' corners,
 * the brows, the lids…), which a 실사 body doesn't have: each bone's move
 * off its rest, in millimetres along the face (x the subject's left, y up,
 * z forward), is read as the blend shapes that make the same move.
 */

const PREFIX = 'Bip01_'
const HEAD = `${PREFIX}Head`
/** The jaw; the bottom lip hangs off it, every other face bone off the head. */
const JAW = 'MJaw'
const BONES = [
  JAW,
  'MBottomLip',
  'MUpperLip',
  'MNose',
  'MMiddleEyebrow',
  'LMouthCorner',
  'RMouthCorner',
  'LInnerEyebrow',
  'RInnerEyebrow',
  'LOuterEyebrow',
  'ROuterEyebrow',
  'LEyeBlinkTop',
  'REyeBlinkTop',
  'LEyeBlinkBottom',
  'REyeBlinkBottom',
] as const
type FaceBone = (typeof BONES)[number]

/** The blend shapes an emote's face is shown with. */
export const EMOTE_FACE_SHAPES = [
  'jawOpen',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthPucker',
  'mouthFunnel',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'browInnerUp',
  'browDownLeft',
  'browDownRight',
  'browOuterUpLeft',
  'browOuterUpRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'noseSneerLeft',
  'noseSneerRight',
] as const
export type EmoteFaceShape = (typeof EMOTE_FACE_SHAPES)[number]
export type FaceWeights = Record<EmoteFaceShape, number>

/**
 * How far (mm) each move goes for its blend shape at full: the bottom lip
 * dropping (the jaw opening: MakeHuman's open mouth drops the chin 34 mm),
 * a lip corner lifting (a smile) or sinking (a frown), the brows, the
 * upper lid closing on the lower, the lower lid rising (a squint)…
 */
const FULL = {
  jaw: 24,
  smile: 7,
  frown: 3,
  pucker: 5,
  upperLip: 6,
  innerBrow: 5,
  browDown: 2.5,
  browKnit: 4,
  outerBrow: 5,
  blink: 10,
  squint: 9,
  sneer: 3,
}
/** Moves smaller than this (mm) are the capture's noise. */
const STILL = { upperLip: 1, sneer: 1, knit: 1 }

/** The rig's face at rest: each face bone's place and turn under its parent, and the head's axes. */
export type FaceRest = {
  /** Head-local offsets to millimetres along the face (the head's world turn and scale at rest). */
  toFace: Matrix3
  bones: Map<FaceBone, { position: Vector3; quaternion: Quaternion }>
}

/** The face rig of a Rocketbox skeleton at rest (the emotes file's scene), or null without one. */
export function faceRest(scene: Object3D): FaceRest | null {
  scene.updateMatrixWorld(true)
  const head = scene.getObjectByName(HEAD)
  if (!head) return null
  const bones = new Map<FaceBone, { position: Vector3; quaternion: Quaternion }>()
  for (const name of BONES) {
    const bone = scene.getObjectByName(PREFIX + name)
    if (!bone) return null
    bones.set(name, { position: bone.position.clone(), quaternion: bone.quaternion.clone() })
  }
  const toFace = new Matrix3().setFromMatrix4(head.matrixWorld).multiplyScalar(1000)
  return { toFace, bones }
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** One emote clip's face over its time. */
export class EmoteFace {
  private readonly tracks = new Map<string, Interpolant>()
  private readonly local = new Map<FaceBone, Vector3>()
  private readonly jawTurn = new Quaternion()
  private readonly lip = new Vector3()
  private readonly lipRest = new Vector3()
  private readonly move = new Vector3()

  constructor(
    clip: AnimationClip,
    private readonly rest: FaceRest,
  ) {
    for (const track of clip.tracks) {
      const [node, property] = track.name.split('.')
      if (!node?.startsWith(PREFIX)) continue
      const bone = node.slice(PREFIX.length) as FaceBone
      if (!rest.bones.has(bone) || (property !== 'position' && property !== 'quaternion')) continue
      this.tracks.set(
        `${bone}.${property}`,
        property === 'quaternion'
          ? new QuaternionLinearInterpolant(track.times, track.values, 4)
          : new LinearInterpolant(track.times, track.values, 3),
      )
    }
    for (const name of BONES) this.local.set(name, new Vector3())
  }

  /** Whether the clip moves the face at all. */
  get moves(): boolean {
    return this.tracks.size > 0
  }

  private position(bone: FaceBone, time: number, out: Vector3): Vector3 {
    const track = this.tracks.get(`${bone}.position`)
    return track ? out.fromArray(track.evaluate(time)) : out.copy(this.rest.bones.get(bone)!.position)
  }

  /** A face bone's move off its rest (mm along the face) at `time`. */
  private moveOf(bone: FaceBone, time: number): Vector3 {
    const rest = this.rest.bones.get(bone)!
    if (bone === 'MBottomLip') {
      // On the jaw: where the jaw's turn and place put it, against where they put it at rest.
      const jaw = this.rest.bones.get(JAW)!
      const turn = this.tracks.get(`${JAW}.quaternion`)
      if (turn) this.jawTurn.fromArray(turn.evaluate(time))
      else this.jawTurn.copy(jaw.quaternion)
      this.position(bone, time, this.lip).applyQuaternion(this.jawTurn)
      this.lip.add(this.position(JAW, time, this.move))
      this.lipRest.copy(rest.position).applyQuaternion(jaw.quaternion).add(jaw.position)
      return this.local.get(bone)!.subVectors(this.lip, this.lipRest).applyMatrix3(this.rest.toFace)
    }
    return this.local
      .get(bone)!
      .subVectors(this.position(bone, time, this.move), rest.position)
      .applyMatrix3(this.rest.toFace)
  }

  /** The blend shapes' weights (0–1) that show the clip's face at `time` (s), into `out`. */
  sample(time: number, out: FaceWeights): FaceWeights {
    const lip = this.moveOf('MBottomLip', time)
    out.jawOpen = clamp(-lip.y / FULL.jaw)
    let inward = 0
    for (const [side, sign] of [
      ['Left', 1],
      ['Right', -1],
    ] as const) {
      const s = side[0] as 'L' | 'R'
      const corner = this.moveOf(`${s}MouthCorner`, time)
      const outward = sign * corner.x
      out[`mouthSmile${side}`] = clamp((corner.y + 0.5 * Math.max(0, outward)) / FULL.smile)
      out[`mouthFrown${side}`] = clamp(-corner.y / FULL.frown)
      inward += Math.max(0, -outward) / 2
      const inner = this.moveOf(`${s}InnerEyebrow`, time).y
      const outer = this.moveOf(`${s}OuterEyebrow`, time).y
      // Brows down, or knitted (the inner ends lower than the outer: anger).
      out[`browDown${side}`] = clamp(
        Math.max(0, -inner) / FULL.browDown + Math.max(0, outer - inner - STILL.knit) / FULL.browKnit,
      )
      out[`browOuterUp${side}`] = clamp(Math.min(outer, inner + 1) / FULL.outerBrow)
      out[`eyeBlink${side}`] = clamp(-this.moveOf(`${s}EyeBlinkTop`, time).y / FULL.blink)
      out[`eyeSquint${side}`] = clamp(this.moveOf(`${s}EyeBlinkBottom`, time).y / FULL.squint)
    }
    const innerUp =
      (this.moveOf('LInnerEyebrow', time).y + this.moveOf('RInnerEyebrow', time).y) / 2
    out.browInnerUp = clamp(
      Math.max(innerUp, 0.8 * this.moveOf('MMiddleEyebrow', time).y) / FULL.innerBrow,
    )
    const rounded = clamp(inward / FULL.pucker)
    out.mouthPucker = rounded * (1 - out.jawOpen)
    out.mouthFunnel = rounded * out.jawOpen
    const upper = clamp((this.moveOf('MUpperLip', time).y - STILL.upperLip) / FULL.upperLip)
    out.mouthUpperUpLeft = upper
    out.mouthUpperUpRight = upper
    const sneer = clamp((this.moveOf('MNose', time).y - STILL.sneer) / FULL.sneer)
    out.noseSneerLeft = sneer
    out.noseSneerRight = sneer
    return out
  }
}

/** A face with every shape at rest. */
export const restingFace = (): FaceWeights =>
  Object.fromEntries(EMOTE_FACE_SHAPES.map((name) => [name, 0])) as FaceWeights
