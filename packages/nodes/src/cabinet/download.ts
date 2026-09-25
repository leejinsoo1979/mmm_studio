import { cabinetsDxf, cabinetsMprZip, type LabeledCabinet } from './engine/export'

/** Save a blob as a file. The link must be in the document for the browser
 *  to honour its `download` name (otherwise the file is saved as "download"). */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadTextFile(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type }))
}

/** One MPR per panel (CP949, mmmcraft preview output), zipped. */
export function downloadCabinetsMpr(name: string, cabinets: LabeledCabinet[]) {
  downloadBlob(`${name}-MPR.zip`, new Blob([cabinetsMprZip(cabinets)], { type: 'application/zip' }))
}

/** All panels with their borings in one DXF drawing. */
export function downloadCabinetsDxf(name: string, cabinets: LabeledCabinet[]) {
  downloadTextFile(`${name}-보링.dxf`, cabinetsDxf(cabinets), 'application/dxf')
}
