import type { CabinetNode } from '../schema'
import { cabinetBoringPanels } from './boring'
import { encodeCp949 } from './cp949'
import { panelsDxf } from './dxf'
import { panelMpr } from './mpr'
import { zipStored } from './zip'

export type LabeledCabinet = { node: CabinetNode; label: string }

/** MPR text as the CNC reads it: CRLF line ends, CP949 bytes. */
export function encodeMpr(content: string): Uint8Array {
  return encodeCp949(content.replace(/\r?\n/g, '\r\n'))
}

/** mmmcraft's MPR file naming: characters CP949 cannot hold, path and
 *  Windows-reserved characters become '_', and repeats get _2, _3, … */
function mprFileNamer() {
  const used = new Set<string>()
  return (name: string) => {
    const safe = [...name.normalize('NFC')]
      .map((char) => {
        const bytes = encodeCp949(char)
        return bytes.length === 1 && bytes[0] === 0x3f ? '_' : char
      })
      .join('')
      .replace(/[/\\:*?"<>|]/g, '_')
    const base =
      Array.from(safe, (c) => (c.charCodeAt(0) < 0x20 ? '_' : c))
        .join('')
        .replace(/[. ]+$/g, '')
        .slice(0, 80) || 'panel'
    const stem = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(base) ? `_${base}` : base
    let filename = `${stem}.mpr`
    let suffix = 2
    while (used.has(filename.toLowerCase())) filename = `${stem}_${suffix++}.mpr`
    used.add(filename.toLowerCase())
    return filename
  }
}

/** One MPR per panel, zipped, file names in CP949. */
export function cabinetsMprZip(
  cabinets: LabeledCabinet[],
  now = new Date(),
): Uint8Array<ArrayBuffer> {
  const name = mprFileNamer()
  const entries = cabinets.flatMap(({ node, label }) =>
    cabinetBoringPanels(node, label).map((panel) => ({
      name: encodeCp949(name(`${label}_${panel.panelName}`)),
      data: encodeMpr(panelMpr(panel, label, now)),
    })),
  )
  return zipStored(entries)
}

/** Every panel of the cabinets in one DXF drawing. */
export function cabinetsDxf(cabinets: LabeledCabinet[]): string {
  return panelsDxf(cabinets.flatMap(({ node, label }) => cabinetBoringPanels(node, label)))
}
