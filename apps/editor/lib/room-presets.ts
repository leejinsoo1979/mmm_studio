/**
 * inZOI's click-to-place 방 / 플랫폼 presets. Each outline is a closed polygon
 * normalised to the unit box [-0.5, 0.5]² (x → right, z → toward the viewer);
 * the tool scales it by `size` (m) and the placed outline is the walls'
 * centerline (방) or the slab edge (플랫폼).
 */
export type RoomPresetShapeId =
  | 'square'
  | 'diamond'
  | 'home-plate'
  | 'hexagon'
  | 'octagon'
  | 'l-shape'
  | 'u-shape'
  | 't-shape'

export type RoomPresetShape = {
  id: RoomPresetShapeId
  label: string
  outline: [number, number][]
  /** Default footprint (width, depth) in metres, on the 0.5 m grid. */
  size: [number, number]
}

const THIRD = 1 / 6
const OCTAGON_CUT = 0.25

export const ROOM_PRESET_SHAPES: RoomPresetShape[] = [
  {
    id: 'square',
    label: '정사각',
    size: [4, 4],
    outline: [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
  },
  {
    id: 'diamond',
    label: '마름모',
    size: [6, 6],
    outline: [
      [0, -0.5],
      [0.5, 0],
      [0, 0.5],
      [-0.5, 0],
    ],
  },
  {
    id: 'home-plate',
    label: '오각',
    size: [4, 5],
    outline: [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.1],
      [0, 0.5],
      [-0.5, 0.1],
    ],
  },
  {
    id: 'hexagon',
    label: '육각',
    size: [4, 4],
    outline: [
      [0, -0.5],
      [0.5, -0.25],
      [0.5, 0.25],
      [0, 0.5],
      [-0.5, 0.25],
      [-0.5, -0.25],
    ],
  },
  {
    id: 'octagon',
    label: '팔각',
    size: [4, 4],
    outline: [
      [-0.5 + OCTAGON_CUT, -0.5],
      [0.5 - OCTAGON_CUT, -0.5],
      [0.5, -0.5 + OCTAGON_CUT],
      [0.5, 0.5 - OCTAGON_CUT],
      [0.5 - OCTAGON_CUT, 0.5],
      [-0.5 + OCTAGON_CUT, 0.5],
      [-0.5, 0.5 - OCTAGON_CUT],
      [-0.5, -0.5 + OCTAGON_CUT],
    ],
  },
  {
    // ㄱ: the top bar and the right leg.
    id: 'l-shape',
    label: 'ㄱ자',
    size: [6, 6],
    outline: [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [THIRD, 0.5],
      [THIRD, -THIRD],
      [-0.5, -THIRD],
    ],
  },
  {
    // ㄷ: top, left and bottom bars, open to the right.
    id: 'u-shape',
    label: 'ㄷ자',
    size: [6, 6],
    outline: [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, -THIRD],
      [-THIRD, -THIRD],
      [-THIRD, THIRD],
      [0.5, THIRD],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
  },
  {
    id: 't-shape',
    label: 'T자',
    size: [6, 6],
    outline: [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, -THIRD],
      [THIRD, -THIRD],
      [THIRD, 0.5],
      [-THIRD, 0.5],
      [-THIRD, -THIRD],
      [-0.5, -THIRD],
    ],
  },
]

/** Floor area of a shape at its default size, m². */
export function roomPresetArea(shape: RoomPresetShape): number {
  const [w, d] = shape.size
  let twice = 0
  shape.outline.forEach(([x, z], index) => {
    const [nx, nz] = shape.outline[(index + 1) % shape.outline.length]!
    twice += x * w * nz * d - nx * w * z * d
  })
  return Math.abs(twice) / 2
}
