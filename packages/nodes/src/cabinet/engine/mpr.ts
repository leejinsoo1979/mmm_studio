import type { Boring, PanelBoringData } from './boring'

/**
 * imos / woodWOP MPR, ported from mmmcraft `domain/boring/exporters/mprExporter`
 * (its preview output). Every drilling and groove macro is disabled with
 * `??="0"` and notch milling is only described in a comment: real
 * production files need the factory's machine profile (tool numbers, feeds),
 * which mmmcraft keeps per manufacturing partner.
 */

/** Quotes and control characters would break a KM="…" line. */
const safeMprText = (text: string) =>
  Array.from(text, (c) => (c === '"' || c.charCodeAt(0) < 0x20 ? ' ' : c)).join('')
const f4 = (value: number) => value.toFixed(4)

function header(): string {
  return `[H
VERSION="4.0"
OP="2"
INCH="0"

`
}

function variables(panel: PanelBoringData): string {
  return `[001
l="${f4(panel.width)}"
KM="length"
w="${f4(panel.height)}"
KM="width"
t="${f4(panel.thickness)}"
KM="thickness"
L="l"
KM="length"
B="w"
KM="width"
D="t"
KM="thickness"


`
}

function workpiece(): string {
  return `
<100 \\Werkstck\\
LA="l"
BR="w"
DI="t"
AX="0.0000"
AY="0.0000"
FNX="0.0000"
FNY="0.0000"

`
}

function comment(panel: PanelBoringData, projectName: string, now: Date): string {
  const dateStr = now.toISOString().replace('T', ' ').slice(0, 19)
  return `<101 \\Kommentar\\
KM="오더:   ${safeMprText(projectName)}"
KM="조각:   ${safeMprText(panel.panelName)}"
KM="측정 단위:   mm"
KM="마감 치수:   ${panel.width} x ${panel.height} x ${panel.thickness}"
KM="자재:   ${safeMprText(panel.material || 'PB_18T')}"
KM="바코드:   ${safeMprText(panel.panelId)}"
KM="생성 시간:   ${dateStr}"
KAT="Kommentar"
MNM="파트 정보"
ORI=""

`
}

function verticalBoring(boring: Boring, panel: PanelBoringData): string {
  const through = boring.note === 'fixed-panel-through'
  const ti = through ? panel.thickness : boring.depth
  const du = through ? 6 : boring.diameter
  return `<102 \\BohrVert\\
XA="${f4(boring.x)}"
YA="${f4(boring.y)}"
TI="${f4(ti)}"
DU="${f4(du)}"
BM="${ti >= panel.thickness ? 'LSL' : 'LS'}"
F_="STANDARD"
AN="1"


`
}

function horizontalBoring(boring: Boring, panel: PanelBoringData): string {
  const right = boring.face === 'right'
  return `<103 \\BohrHoriz\\
XA="${f4(boring.x)}"
YA="${f4(boring.y)}"
ZA="${f4(panel.thickness / 2)}"
TI="${f4(boring.depth)}"
DU="${f4(boring.diameter)}"
BM="${right ? 'XM' : 'XP'}"
BM2="STD"
F_="STANDARD"
AN="1"
WI="${f4(right ? 180 : 0)}"

`
}

const isSide = (panel: PanelBoringData) =>
  panel.panelType === 'side-left' || panel.panelType === 'side-right'
const isRightSide = (panel: PanelBoringData) => panel.panelType === 'side-right'

/** Back groove centre line along the side's height. The left side has its
 *  back edge at Y = height, the right side at Y = 0. */
export function backGrooveLine(panel: PanelBoringData) {
  const groove = panel.backPanelGroove
  if (!isSide(panel) || !groove || panel.height <= 26 || panel.width <= 0) return null
  const startY = isRightSide(panel) ? groove.offset : panel.height - groove.offset - groove.width
  const y = startY + groove.width / 2
  return { x1: 0, y1: y, x2: panel.width, y2: y, width: groove.width, depth: groove.depth }
}

/** Open contour of a 목찬넬 notch on a side panel (only the cut edges). */
export function sideNotchContour(
  panel: PanelBoringData,
  notch: { y: number; z: number; fromBottom: number },
): { x: number; y: number }[] {
  const depth = Math.max(0, Math.min(notch.z, panel.height))
  const height = Math.max(0, Math.min(notch.y, panel.width))
  if (depth <= 0 || height <= 0) return []
  const right = isRightSide(panel)
  const frontEdgeY = right ? panel.height : 0
  const innerY = right ? panel.height - depth : depth
  const bottomX = panel.width - notch.fromBottom
  const topX = panel.width - notch.fromBottom - height
  const onTop = Math.abs(notch.fromBottom + notch.y - panel.width) < 0.0001
  const onBottom = Math.abs(notch.fromBottom) < 0.0001
  if (onTop && onBottom)
    return [
      { x: topX, y: innerY },
      { x: bottomX, y: innerY },
    ]
  if (onBottom)
    return [
      { x: topX, y: frontEdgeY },
      { x: topX, y: innerY },
      { x: bottomX, y: innerY },
    ]
  if (onTop)
    return [
      { x: topX, y: innerY },
      { x: bottomX, y: innerY },
      { x: bottomX, y: frontEdgeY },
    ]
  return [
    { x: topX, y: frontEdgeY },
    { x: topX, y: innerY },
    { x: bottomX, y: innerY },
    { x: bottomX, y: frontEdgeY },
  ]
}

function contourBlock(block: number, name: string, points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''
  const [start, ...rest] = points
  if (!start) return ''
  const lines = rest
    .map(
      (point, index) => `$E${index + 1}
KL
X=${f4(point.x)}
Y=${f4(point.y)}
Z=${f4(0)}
`,
    )
    .join('\n')
  const startFields =
    name === 'NEST'
      ? `X=${f4(start.x)}
Y=${f4(start.y)}
Z=${f4(0)}
KO=00`
      : `KO=00
X=${f4(start.x)}
Y=${f4(start.y)}
Z=${f4(0)}`
  return `
]${block}
$E0
KP${name ? ` ${name}` : ''}
${startFields}

${lines}`
}

const notchBlockNumber = (panel: PanelBoringData, index: number) =>
  (backGrooveLine(panel) ? 3 : 2) + index

function displayGeometry(panel: PanelBoringData): string {
  const notches = panel.sideNotches ?? []
  const groove = backGrooveLine(panel)
  if (notches.length === 0 && !groove) return ''
  let out = contourBlock(1, 'NEST', [
    { x: 0, y: 0 },
    { x: panel.width, y: 0 },
    { x: panel.width, y: panel.height },
    { x: 0, y: panel.height },
    { x: 0, y: 0 },
  ])
  if (groove) {
    out += contourBlock(2, '', [
      { x: groove.x1, y: groove.y1 },
      { x: groove.x2, y: groove.y2 },
    ])
  }
  notches.forEach((notch, index) => {
    out += contourBlock(notchBlockNumber(panel, index), '', sideNotchContour(panel, notch))
  })
  return out
}

function grooveMacro(panel: PanelBoringData): string {
  const g = backGrooveLine(panel)
  if (!g) return ''
  return `<109 \\Nuten\\
XA="${f4(-1)}"
YA="${f4(g.y1)}"
XE="${f4(panel.width + 1)}"
YE="${f4(g.y2)}"
AN="0"
NB="${f4(g.width)}"
RK="NOWRK"
EM="MOD0"
TI="${f4(g.depth)}"
T_="PREVIEW_TOOL"
XY="50.0000"
F_="STANDARD"
KO="00"

`
}

function notchMilling(
  panel: PanelBoringData,
  notch: { y: number; z: number; fromBottom: number },
  index: number,
): string {
  const points = sideNotchContour(panel, notch)
  if (points.length < 2) return ''
  const block = notchBlockNumber(panel, index)
  return `<101 \\Kommentar\\
KM="PREVIEW MILLING EA=${block}:0 EE=${block}:${points.length - 1} RK=${isRightSide(panel) ? 'WRKL' : 'WRKR'}"

`
}

/** One MPR program per panel. */
export function panelMpr(panel: PanelBoringData, projectName = '', now = new Date()): string {
  let mpr = header()
  mpr += variables(panel)
  mpr += displayGeometry(panel)
  mpr += workpiece()
  mpr += comment(panel, projectName, now)
  mpr +=
    '<101 \\Kommentar\\\nKM="PREVIEW ONLY - 가공 비활성 미리보기. 생산 파일은 제조 파트너 내보내기를 사용하세요."\n\n'
  for (const boring of panel.borings) {
    mpr += boring.face === 'top' ? verticalBoring(boring, panel) : horizontalBoring(boring, panel)
  }
  mpr += grooveMacro(panel)
  // Drill and groove first; separating the notch material comes last.
  panel.sideNotches?.forEach((notch, index) => {
    mpr += notchMilling(panel, notch, index)
  })
  mpr += '!\n'
  return mpr.replace(/(<(?:102|103|109) [^\n]+\n)/g, '$1??="0"\n')
}
