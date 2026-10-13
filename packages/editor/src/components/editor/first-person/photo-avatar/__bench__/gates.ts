import type { GeometryReport } from './measure'

/**
 * The photo avatar's acceptance gates, as numbers: one place for the bench
 * (scripts/photo-avatar), its gate table and the fixture tests. Lengths in
 * mm, scale and width as fractions, colours as CIEDE2000.
 */
export const GATES = {
  /** Five photos (0, ±45, ±90), clean. */
  G1: { point: 2.0, profileMean: 1.5, profileMax: 4.0, outline45: 2.0, scale: 0.03 },
  /** Five photos taken like a webcam or phone would, under a hard side light. */
  G2: { point: 3.0, profileMean: 2.0, scale: 0.04 },
  /** The webcam path: every pose found, and within this of G2's errors for the head (mm). */
  G3: { slack: 0.5 },
  /** Three photos (0, ±45); one photo. */
  G4: { threePoint: 3.0, singlePoint: 4.0, singleWidth: 0.04 },
  /** Likeness, the avatar drawn through each photo's solved camera against the photo. */
  G5: { nme: 0.025, iou: 0.95, width: 0.03 },
  /** Skin: cheeks under the same camera and light; face, neck and body; left against right. */
  G6: { cheek: 6, tone: 5, seam: 5, balance: [0.9, 1.1] as const },
  /** Hair colour, and holes (share of the scalp's pixels showing skin or background). */
  G7: { colour: 10, holes: 0.002 },
  /** Iris colour. */
  G8: { iris: 10 },
  /** A five-photo build (s) and its file (bytes). */
  G9: { seconds: 60, bytes: 4 * 1024 * 1024 },
} as const

/** The profile's points every geometry gate holds to its point limit. */
export const GATE_POINTS = [
  'glabella',
  'nasion',
  'midBridge',
  'pronasale',
  'noseProjection',
  'subnasale',
  'upperLip',
  'lowerLip',
  'pogonion',
  'menton',
  'submental',
] as const

export type Check = {
  gate: string
  name: string
  /** The measured value (mm, or a fraction for scale and width). */
  value: number
  /** What it is held to, as written in the table. */
  limit: string
  /** null where the gate does not apply (a truth whose size is not real) or needs a person's eye. */
  pass: boolean | null
  /** What the value stands for, where a number alone doesn't say (the classes compared, the morphs found). */
  note?: string
}

const within = (value: number, limit: number) => Number.isFinite(value) && Math.abs(value) <= limit

function pointChecks(gate: string, report: GeometryReport, limit: number): Check[] {
  return GATE_POINTS.map((name) => ({
    gate,
    name,
    value: report.points[name],
    limit: `|e| ≤ ${limit} mm`,
    pass: within(report.points[name], limit),
  }))
}

function scaleCheck(gate: string, report: GeometryReport, limit: number, real: boolean): Check {
  return {
    gate,
    name: 'scale',
    value: report.alignment.scaleError,
    limit: `|e| ≤ ${limit * 100} %`,
    pass: real ? within(report.alignment.scaleError, limit) : null,
  }
}

/** G1: five clean photos. */
export function g1Checks(report: GeometryReport, absoluteScale: boolean): Check[] {
  const g = GATES.G1
  return [
    ...pointChecks('G1', report, g.point),
    {
      gate: 'G1',
      name: 'profileMean',
      value: report.profile.mean,
      limit: `≤ ${g.profileMean} mm`,
      pass: within(report.profile.mean, g.profileMean),
    },
    {
      gate: 'G1',
      name: 'profileMax',
      value: report.profile.max,
      limit: `≤ ${g.profileMax} mm`,
      pass: within(report.profile.max, g.profileMax),
    },
    {
      gate: 'G1',
      name: 'outline45',
      value: report.outline45.mean,
      limit: `≤ ${g.outline45} mm`,
      pass: within(report.outline45.mean, g.outline45),
    },
    scaleCheck('G1', report, g.scale, absoluteScale),
  ]
}

/** G2: five photos perturbed like a webcam or phone, hard side light. */
export function g2Checks(report: GeometryReport, absoluteScale: boolean): Check[] {
  const g = GATES.G2
  return [
    ...pointChecks('G2', report, g.point),
    {
      gate: 'G2',
      name: 'profileMean',
      value: report.profile.mean,
      limit: `≤ ${g.profileMean} mm`,
      pass: within(report.profile.mean, g.profileMean),
    },
    scaleCheck('G2', report, g.scale, absoluteScale),
  ]
}

/** G4, three photos. */
export function g4ThreeChecks(report: GeometryReport): Check[] {
  return pointChecks('G4-three', report, GATES.G4.threePoint)
}

/**
 * G4, one photo: nose projection, nasion and chin each better than the
 * untouched base head and within the limit; the face's width (cheeks and
 * jaw, absolute) within its limit.
 */
export function g4SingleChecks(report: GeometryReport, base: GeometryReport): Check[] {
  const g = GATES.G4
  const checks: Check[] = []
  for (const name of ['noseProjection', 'nasion', 'pogonion'] as const) {
    const value = report.points[name]
    checks.push({
      gate: 'G4-single',
      name,
      value,
      limit: `|e| ≤ ${g.singlePoint} mm and < base ${Math.abs(base.points[name]).toFixed(2)}`,
      pass: within(value, g.singlePoint) && Math.abs(value) < Math.abs(base.points[name]),
    })
  }
  for (const name of ['cheek', 'jaw'] as const) {
    const value = report.width[name]
    checks.push({
      gate: 'G4-single',
      name: `${name}Width`,
      value,
      limit: `|e| ≤ ${g.singleWidth * 100} %`,
      pass: within(value, g.singleWidth),
    })
  }
  return checks
}
