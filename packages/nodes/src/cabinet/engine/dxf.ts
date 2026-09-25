import type { Boring, BoringType, PanelBoringData } from './boring'

/**
 * AutoCAD DXF (AC1015) of panels and their borings, ported from mmmcraft
 * `domain/boring/exporters/dxfExporter`: the panel outline with its face
 * holes, then each edge face (left/right) drawn beside it with its bores.
 */

const LAYER_COLORS: Record<string, number> = {
  '0_OUTLINE': 7,
  '1_HINGE_CUP': 1,
  '2_HINGE_SCREW': 1,
  '3_CAM_HOUSING': 5,
  '4_CAM_BOLT': 5,
  '5_SHELF_PIN': 2,
  '6_DRAWER_RAIL': 3,
  '7_ADJUSTABLE_FOOT': 7,
  '8_DRAWER_CONNECTOR': 3,
  '9_DIMENSIONS': 4,
  '10_LABELS': 6,
}

const LAYER: Record<BoringType, string> = {
  'hinge-cup': '1_HINGE_CUP',
  'hinge-screw': '2_HINGE_SCREW',
  'shelf-pin': '5_SHELF_PIN',
}

const f4 = (value: number) => value.toFixed(4)

function header(): string {
  return `0
SECTION
2
HEADER
9
$ACADVER
1
AC1015
9
$INSUNITS
70
4
0
ENDSEC
`
}

function tables(): string {
  let layers = ''
  for (const [name, color] of Object.entries(LAYER_COLORS)) {
    layers += `0
LAYER
2
${name}
70
0
62
${color}
6
CONTINUOUS
`
  }
  return `0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
${Object.keys(LAYER_COLORS).length}
${layers}0
ENDTAB
0
ENDSEC
`
}

function circle(x: number, y: number, radius: number, layer: string): string {
  return `0
CIRCLE
8
${layer}
10
${f4(x)}
20
${f4(y)}
30
0.0
40
${f4(radius)}
`
}

function rect(x: number, y: number, w: number, h: number): string {
  return `0
LWPOLYLINE
8
0_OUTLINE
90
4
70
1
10
${f4(x)}
20
${f4(y)}
10
${f4(x + w)}
20
${f4(y)}
10
${f4(x + w)}
20
${f4(y + h)}
10
${f4(x)}
20
${f4(y + h)}
`
}

function text(x: number, y: number, value: string, layer: string): string {
  return `0
TEXT
8
${layer}
10
${f4(x)}
20
${f4(y)}
30
0.0
40
3.0
1
${value}
`
}

const hole = (boring: Boring, x: number, y: number) =>
  circle(x, y, boring.diameter / 2, LAYER[boring.type])

function panelEntities(panel: PanelBoringData, offsetX: number): string {
  let out = rect(offsetX, 0, panel.width, panel.height)
  for (const boring of panel.borings) {
    if (boring.face === 'top') out += hole(boring, offsetX + boring.x, boring.y)
  }
  // Edge faces sit to the right of the panel, stacked upwards.
  const auxX = offsetX + panel.width + 40
  let auxY = 0
  for (const face of ['left', 'right'] as const) {
    const bores = panel.borings.filter((b) => b.face === face)
    if (bores.length === 0) continue
    out += rect(auxX, auxY, panel.height, panel.thickness)
    out += text(
      auxX + panel.height / 2,
      auxY + panel.thickness + 5,
      `FACE ${face.toUpperCase()}`,
      '10_LABELS',
    )
    for (const boring of bores) out += hole(boring, auxX + boring.y, auxY + panel.thickness / 2)
    auxY += panel.thickness + 25
  }
  out += text(offsetX + panel.width / 2, -5, `${panel.width}`, '9_DIMENSIONS')
  out += text(offsetX - 5, panel.height / 2, `${panel.height}`, '9_DIMENSIONS')
  out += text(offsetX + panel.width / 2, panel.height + 5, panel.panelName, '10_LABELS')
  return out
}

function layoutWidth(panel: PanelBoringData): number {
  const hasEdgeFace = panel.borings.some((b) => b.face !== 'top')
  return hasEdgeFace ? panel.width + 40 + Math.max(panel.width, panel.height) : panel.width
}

/** All panels in one drawing, side by side with a 50 mm gap. */
export function panelsDxf(panels: PanelBoringData[]): string {
  let entities = ''
  let offsetX = 0
  for (const panel of panels) {
    entities += panelEntities(panel, offsetX)
    offsetX += layoutWidth(panel) + 50
  }
  return `${header()}${tables()}0
SECTION
2
ENTITIES
${entities}0
ENDSEC
0
EOF
`
}
